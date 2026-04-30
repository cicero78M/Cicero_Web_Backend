import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';
import redis from '../config/redis.js';
import { sendTelegramMessage, isTelegramAdmin } from '../service/telegramService.js';
import { requireSystemAdminRoles, verifySystemAdminToken } from '../middleware/systemAdminAuth.js';
import {
  ADMIN_SYSTEM_CONFIG_ALLOWLIST,
  analyzeAdminSystemConfig,
  getAdminSystemConfig,
  validateConfigKeyValue,
  isCriticalAdminSystemConfigKey,
} from '../config/adminSystemConfig.js';

const router = Router();

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');

async function persistEnvConfigValue(configKey, configValue) {
  const key = String(configKey || '').trim();
  const value = String(configValue ?? '');

  let existing = '';
  try {
    existing = await fs.readFile(ENV_FILE_PATH, 'utf8');
  } catch {
    existing = '';
  }

  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const nextLines = [];
  let replaced = false;

  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) {
      nextLines.push(line);
      continue;
    }
    const idx = line.indexOf('=');
    if (idx <= 0) {
      nextLines.push(line);
      continue;
    }
    const currentKey = line.slice(0, idx).trim();
    if (currentKey === key) {
      nextLines.push(`${key}=${value}`);
      replaced = true;
    } else {
      nextLines.push(line);
    }
  }

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${value}`);
  }

  await fs.writeFile(ENV_FILE_PATH, `${nextLines.join('\n')}\n`, 'utf8');
}

function isValidISODate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function parseDateRangeFilter(req, values, whereParts, fieldName = 'created_at') {
  const startDate = String(req.query.start_date || '').trim();
  const endDate = String(req.query.end_date || '').trim();

  if (startDate) {
    if (!isValidISODate(startDate)) {
      return { error: 'Format start_date harus YYYY-MM-DD' };
    }
    values.push(startDate);
    whereParts.push(`${fieldName} >= $${values.length}::date`);
  }
  if (endDate) {
    if (!isValidISODate(endDate)) {
      return { error: 'Format end_date harus YYYY-MM-DD' };
    }
    values.push(endDate);
    whereParts.push(`${fieldName} < ($${values.length}::date + INTERVAL '1 day')`);
  }

  if (startDate && endDate && startDate > endDate) {
    return { error: 'start_date tidak boleh lebih besar dari end_date' };
  }

  return { error: null };
}

const config = getAdminSystemConfig();
const OTP_TTL_SECONDS = config.otpTtlSeconds;
const ADMIN_SESSION_TTL_SECONDS = config.sessionTtlSeconds;

function buildAdminChatIds() {
  return config.adminChatIds;
}

function resolveAdminRole(chatId) {
  return config.roleMap[String(chatId)] || 'super_admin';
}

function isAllowedAdminChatId(chatId) {
  if (!chatId) return false;
  const id = String(chatId).trim();
  if (!id) return false;
  const envAllowed = buildAdminChatIds().includes(id);
  return envAllowed && isTelegramAdmin(id);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function mapAdminRoleToScope(adminRole) {
  if (adminRole === 'auditor') {
    return ['management:funds:read', 'management:audit:read'];
  }
  if (adminRole === 'finance_admin') {
    return ['management:funds:read', 'management:funds:write', 'management:requests:approve'];
  }
  return ['management:system', 'management:funds:read', 'management:funds:write', 'management:requests:approve', 'management:audit:read'];
}

async function insertFundAuditLog({ actionType, actorChatId, actorRole, entityType, entityId, notes, metadata }) {
  await query(
    `INSERT INTO system_management_fund_audit (
      audit_id, action_type, actor_telegram_chat_id, actor_admin_role, entity_type, entity_id, notes, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      crypto.randomUUID(),
      actionType,
      String(actorChatId),
      actorRole,
      entityType,
      entityId || null,
      notes || null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

router.post('/auth/telegram/request', async (req, res) => {
  const { telegram_chat_id } = req.body || {};
  const chatId = String(telegram_chat_id || '').trim();

  if (!isAllowedAdminChatId(chatId)) {
    return res.status(403).json({ success: false, message: 'Chat ID Telegram admin tidak diizinkan' });
  }

  const requestId = crypto.randomUUID();
  const otp = generateOtp();

  try {
    await redis.set(
      `admin_otp:${requestId}`,
      JSON.stringify({ code: otp, telegram_chat_id: chatId, failed_attempts: 0 }),
      { EX: OTP_TTL_SECONDS },
    );
  } catch (err) {
    console.error('[ADMIN AUTH] Failed to store OTP:', err);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  const message = [
    '🔐 *Kode Login Admin System*',
    '',
    `Kode OTP: *${otp}*`,
    `Request ID: \`${requestId}\``,
    '',
    'Kode berlaku 5 menit. Jangan bagikan ke siapa pun.',
  ].join('\n');

  const sent = await sendTelegramMessage(chatId, message);
  if (!sent) {
    return res.status(502).json({ success: false, message: 'Gagal mengirim OTP ke Telegram admin' });
  }

  return res.json({
    success: true,
    request_id: requestId,
    expires_in_seconds: OTP_TTL_SECONDS,
    message: 'OTP terkirim ke Telegram admin',
  });
});

router.post('/auth/telegram/verify', async (req, res) => {
  const { request_id, otp_code } = req.body || {};

  if (!request_id || !otp_code) {
    return res.status(400).json({ success: false, message: 'request_id dan otp_code wajib diisi' });
  }

  let raw;
  try {
    raw = await redis.get(`admin_otp:${request_id}`);
  } catch (err) {
    console.error('[ADMIN AUTH] Failed to read OTP:', err);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  if (!raw) {
    return res.status(401).json({ success: false, message: 'OTP tidak valid atau sudah kedaluwarsa' });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return res.status(401).json({ success: false, message: 'OTP tidak valid' });
  }

  const inputCode = String(otp_code).trim();
  if (payload.code !== inputCode) {
    const nextFailed = Number(payload.failed_attempts || 0) + 1;
    if (nextFailed >= 3) {
      await redis.del(`admin_otp:${request_id}`);
      return res.status(429).json({ success: false, message: 'OTP salah 3x, silakan request ulang' });
    }

    await redis.set(
      `admin_otp:${request_id}`,
      JSON.stringify({ ...payload, failed_attempts: nextFailed }),
      { EX: OTP_TTL_SECONDS },
    );

    return res.status(401).json({ success: false, message: 'OTP salah' });
  }

  await redis.del(`admin_otp:${request_id}`);

  const sessionId = crypto.randomUUID();
  const adminRole = resolveAdminRole(payload.telegram_chat_id);
  const scope = mapAdminRoleToScope(adminRole);
  const tokenPayload = {
    role: 'system_admin',
    admin_role: adminRole,
    telegram_chat_id: payload.telegram_chat_id,
    scope,
    session_id: sessionId,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '2h' });

  try {
    await redis.set(`login_token:${token}`, `admin:${payload.telegram_chat_id}`, {
      EX: ADMIN_SESSION_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[ADMIN AUTH] Failed to persist admin token:', err);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  return res.json({
    success: true,
    token,
    admin: {
      role: 'system_admin',
      admin_role: adminRole,
      telegram_chat_id: payload.telegram_chat_id,
      scope,
    },
  });
});

router.use(verifySystemAdminToken);

router.get('/management/config', async (_req, res) => {
  const cfg = getAdminSystemConfig();
  const analysis = analyzeAdminSystemConfig(cfg);

  return res.json({
    success: true,
    data: {
      config: {
        otp_ttl_seconds: cfg.otpTtlSeconds,
        session_ttl_seconds: cfg.sessionTtlSeconds,
        pagination_default_limit: cfg.paginationDefaultLimit,
        pagination_max_limit: cfg.paginationMaxLimit,
        timezone: cfg.timezone,
        total_admin_chat_ids: cfg.adminChatIds.length,
        total_role_mappings: Object.keys(cfg.roleMap || {}).length,
      },
      analysis,
    },
  });
});

router.post('/management/config/preview', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const { config_key, config_value } = req.body || {};

  const key = String(config_key || '').trim();
  const value = String(config_value ?? '').trim();

  if (!key) {
    return res.status(400).json({ success: false, message: 'config_key wajib diisi' });
  }

  const validation = validateConfigKeyValue(key, value);
  if (!validation.ok) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  const currentValue = process.env[key] ?? null;
  const nextEnv = { ...process.env, [key]: value };
  const previewCfg = getAdminSystemConfig({ env: nextEnv });
  const previewAnalysis = analyzeAdminSystemConfig(previewCfg);

  const isCritical = isCriticalAdminSystemConfigKey(key);
  let confirmationToken = null;

  if (isCritical) {
    confirmationToken = crypto.randomUUID();
    await redis.set(
      `admin_config_preview:${confirmationToken}`,
      JSON.stringify({ key, value, actor: req.systemAdmin.telegram_chat_id }),
      { EX: 600 },
    ).catch(() => null);
  }

  return res.json({
    success: true,
    data: {
      config_key: key,
      old_value: currentValue,
      new_value: value,
      would_change: String(currentValue ?? '') !== value,
      next_analysis: previewAnalysis,
      is_critical: isCritical,
      confirmation_token: confirmationToken,
      note: isCritical
        ? 'Perubahan critical memerlukan confirmation_token dari preview (berlaku 10 menit).'
        : 'Preview hanya simulasi runtime saat ini.',
    },
  });
});

router.post('/management/config/apply', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const { config_key, config_value, notes = null, confirmation_token = null, persist_to_env = true } = req.body || {};

  const key = String(config_key || '').trim();
  const value = String(config_value ?? '').trim();

  if (!key) {
    return res.status(400).json({ success: false, message: 'config_key wajib diisi' });
  }

  if (!ADMIN_SYSTEM_CONFIG_ALLOWLIST.has(key)) {
    return res.status(400).json({ success: false, message: 'config_key tidak diizinkan' });
  }

  const validation = validateConfigKeyValue(key, value);
  if (!validation.ok) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  if (isCriticalAdminSystemConfigKey(key)) {
    const token = String(confirmation_token || '').trim();
    if (!token) {
      return res.status(400).json({ success: false, message: 'confirmation_token wajib untuk config critical' });
    }

    const raw = await redis.get(`admin_config_preview:${token}`).catch(() => null);
    if (!raw) {
      return res.status(400).json({ success: false, message: 'confirmation_token tidak valid atau kedaluwarsa' });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (!payload || payload.key !== key || payload.value !== value || payload.actor !== req.systemAdmin.telegram_chat_id) {
      return res.status(400).json({ success: false, message: 'confirmation_token tidak cocok dengan payload apply' });
    }

    await redis.del(`admin_config_preview:${token}`).catch(() => null);
  }

  const oldValue = process.env[key] ?? null;
  process.env[key] = value;

  if (persist_to_env !== false) {
    await persistEnvConfigValue(key, value);
  }

  await query(
    `INSERT INTO system_management_config_audit (
      audit_id, actor_telegram_chat_id, action_type, config_key, old_value, new_value, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      crypto.randomUUID(),
      req.systemAdmin.telegram_chat_id,
      'config_apply',
      key,
      oldValue,
      value,
      notes,
    ],
  ).catch(err => {
    console.error('[ADMIN CONFIG] failed to insert config audit:', err);
  });

  return res.json({
    success: true,
    data: {
      config_key: key,
      old_value: oldValue,
      new_value: value,
      applied_runtime_only: false,
      persisted_to_env: persist_to_env !== false,
      message: 'Konfigurasi diterapkan dan dipersist ke .env',
    },
  });
});

router.post('/management/config/rollback', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const { config_key, target_audit_id = null, notes = null } = req.body || {};
  const key = String(config_key || '').trim();

  if (!key) {
    return res.status(400).json({ success: false, message: 'config_key wajib diisi' });
  }
  if (!ADMIN_SYSTEM_CONFIG_ALLOWLIST.has(key)) {
    return res.status(400).json({ success: false, message: 'config_key tidak diizinkan' });
  }

  const lookupSql = target_audit_id
    ? `SELECT audit_id, old_value, new_value
       FROM system_management_config_audit
       WHERE config_key = $1 AND audit_id = $2
       ORDER BY created_at DESC
       LIMIT 1`
    : `SELECT audit_id, old_value, new_value
       FROM system_management_config_audit
       WHERE config_key = $1
       ORDER BY created_at DESC
       LIMIT 1`;
  const lookupParams = target_audit_id ? [key, target_audit_id] : [key];
  const latest = await query(lookupSql, lookupParams).catch(() => ({ rows: [] }));

  if (!latest.rows[0]) {
    return res.status(404).json({ success: false, message: 'Tidak ada audit untuk config_key tersebut' });
  }

  const revertTo = latest.rows[0].old_value ?? '';
  const validation = validateConfigKeyValue(key, String(revertTo));
  if (!validation.ok) {
    return res.status(400).json({ success: false, message: `Rollback gagal: ${validation.message}` });
  }

  const oldValue = process.env[key] ?? null;
  process.env[key] = String(revertTo);
  await persistEnvConfigValue(key, String(revertTo));

  await query(
    `INSERT INTO system_management_config_audit (
      audit_id, actor_telegram_chat_id, action_type, config_key, old_value, new_value, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      crypto.randomUUID(),
      req.systemAdmin.telegram_chat_id,
      'config_rollback',
      key,
      oldValue,
      String(revertTo),
      notes,
    ],
  ).catch(() => null);

  return res.json({
    success: true,
    data: {
      config_key: key,
      reverted_from: oldValue,
      reverted_to: String(revertTo),
      source_audit_id: latest.rows[0].audit_id,
    },
  });
});

router.get('/management/config/audit', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS total FROM system_management_config_audit').catch(() => ({ rows: [{ total: 0 }] })),
    query(
      `SELECT audit_id, actor_telegram_chat_id, action_type, config_key, old_value, new_value, notes, created_at
       FROM system_management_config_audit
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ).catch(() => ({ rows: [] })),
  ]);

  return res.json({
    success: true,
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  });
});

router.get('/management/overview', async (_req, res) => {
  const [clientResult, dashboardUserResult, premiumRequestResult, pendingFundReqResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS total_clients FROM clients'),
    query('SELECT COUNT(*)::int AS total_dashboard_users FROM dashboard_user'),
    query("SELECT COUNT(*)::int AS total_pending_premium_requests FROM dashboard_premium_request WHERE status = 'pending'"),
    query("SELECT COUNT(*)::int AS total_pending_fund_requests FROM system_management_fund_request WHERE status = 'pending'")
      .catch(() => ({ rows: [{ total_pending_fund_requests: 0 }] })),
  ]);

  return res.json({
    success: true,
    data: {
      total_clients: clientResult.rows[0]?.total_clients || 0,
      total_dashboard_users: dashboardUserResult.rows[0]?.total_dashboard_users || 0,
      total_pending_premium_requests: premiumRequestResult.rows[0]?.total_pending_premium_requests || 0,
      total_pending_fund_requests: pendingFundReqResult.rows[0]?.total_pending_fund_requests || 0,
      note: 'Halaman admin system khusus manajemen global.',
    },
  });
});

router.get('/management/funds', async (req, res) => {
  const [transactionResult, requestResult, balanceResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS total_transactions FROM system_management_fund_transaction').catch(() => ({ rows: [{ total_transactions: 0 }] })),
    query("SELECT COUNT(*)::int AS total_pending_requests FROM system_management_fund_request WHERE status = 'pending'").catch(() => ({ rows: [{ total_pending_requests: 0 }] })),
    query(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0)::numeric AS total_inflow,
        COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0)::numeric AS total_outflow,
        (COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0))::numeric AS current_balance
       FROM system_management_fund_transaction`,
    ).catch(() => ({ rows: [{ total_inflow: 0, total_outflow: 0, current_balance: 0 }] })),
  ]);

  return res.json({
    success: true,
    data: {
      modules: [
        { key: 'fund_allocation', status: 'active' },
        { key: 'fund_request_approval', status: 'active' },
        { key: 'fund_audit_log', status: 'active' },
      ],
      stats: {
        total_transactions: transactionResult.rows[0]?.total_transactions || 0,
        total_pending_requests: requestResult.rows[0]?.total_pending_requests || 0,
        total_inflow: Number(balanceResult.rows[0]?.total_inflow || 0),
        total_outflow: Number(balanceResult.rows[0]?.total_outflow || 0),
        current_balance: Number(balanceResult.rows[0]?.current_balance || 0),
      },
      admin_role: req.systemAdmin.admin_role,
      message: 'Endpoint dana manajemen aktif dengan workflow request + approval + audit log.',
    },
  });
});

router.get('/management/funds/summary', async (req, res) => {
  const period = String(req.query.period || 'daily').trim().toLowerCase();
  const allowedPeriods = ['daily', 'weekly', 'monthly'];
  if (!allowedPeriods.includes(period)) {
    return res.status(400).json({ success: false, message: 'period harus daily|weekly|monthly' });
  }

  const dateFormat =
    period === 'daily'
      ? "YYYY-MM-DD"
      : period === 'weekly'
      ? "IYYY-\"W\"IW"
      : 'YYYY-MM';

  const result = await query(
    `SELECT
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', '${dateFormat}') AS bucket,
      COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0)::numeric AS inflow,
      COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0)::numeric AS outflow,
      (COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0))::numeric AS net
     FROM system_management_fund_transaction
     GROUP BY bucket
     ORDER BY bucket DESC
     LIMIT 24`,
  ).catch(() => ({ rows: [] }));

  return res.json({ success: true, data: result.rows, period });
});

router.get('/management/funds/transactions', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;
  const direction = String(req.query.direction || '').trim().toLowerCase();

  const whereParts = [];
  const values = [];
  if (direction && ['inflow', 'outflow'].includes(direction)) {
    values.push(direction);
    whereParts.push(`direction = $${values.length}`);
  }
  const txDateFilter = parseDateRangeFilter(req, values, whereParts, 'created_at');
  if (txDateFilter.error) {
    return res.status(400).json({ success: false, message: txDateFilter.error });
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS total FROM system_management_fund_transaction ${whereClause}`;
  const dataSql = `SELECT transaction_id, category, amount, direction, description, created_at, created_by_chat_id
     FROM system_management_fund_transaction
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

  const [countResult, result] = await Promise.all([
    query(countSql, values),
    query(dataSql, [...values, limit, offset]),
  ]);

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  });
});

router.post('/management/funds/transactions', requireSystemAdminRoles('super_admin', 'finance_admin'), async (req, res) => {
  const { category, amount, direction = 'outflow', description = null } = req.body || {};

  if (!category || !amount) {
    return res.status(400).json({ success: false, message: 'category dan amount wajib diisi' });
  }

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'amount harus angka positif' });
  }

  const normalizedDirection = String(direction).toLowerCase();
  if (!['inflow', 'outflow'].includes(normalizedDirection)) {
    return res.status(400).json({ success: false, message: 'direction harus inflow atau outflow' });
  }

  const transactionId = crypto.randomUUID();
  await query(
    `INSERT INTO system_management_fund_transaction (
      transaction_id, category, amount, direction, description, created_by_chat_id
    ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [transactionId, String(category).trim(), normalizedAmount, normalizedDirection, description, req.systemAdmin.telegram_chat_id],
  );

  await insertFundAuditLog({
    actionType: 'create_transaction',
    actorChatId: req.systemAdmin.telegram_chat_id,
    actorRole: req.systemAdmin.admin_role,
    entityType: 'transaction',
    entityId: transactionId,
    notes: 'Membuat transaksi dana manajemen',
    metadata: { category, amount: normalizedAmount, direction: normalizedDirection },
  });

  return res.status(201).json({ success: true, transaction_id: transactionId });
});

router.get('/management/funds/requests', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || '').trim().toLowerCase();

  const whereParts = [];
  const values = [];
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    values.push(status);
    whereParts.push(`status = $${values.length}`);
  }
  const reqDateFilter = parseDateRangeFilter(req, values, whereParts, 'created_at');
  if (reqDateFilter.error) {
    return res.status(400).json({ success: false, message: reqDateFilter.error });
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS total FROM system_management_fund_request ${whereClause}`;
  const dataSql = `SELECT request_id, title, requested_amount, requested_by_chat_id, status, note, approved_by_chat_id, approved_at, created_at
     FROM system_management_fund_request
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

  const [countResult, result] = await Promise.all([
    query(countSql, values),
    query(dataSql, [...values, limit, offset]),
  ]);

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  });
});

router.post('/management/funds/requests', requireSystemAdminRoles('super_admin', 'finance_admin'), async (req, res) => {
  const { title, requested_amount, note = null } = req.body || {};

  if (!title || !requested_amount) {
    return res.status(400).json({ success: false, message: 'title dan requested_amount wajib diisi' });
  }

  const requestedAmount = Number(requested_amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'requested_amount harus angka positif' });
  }

  const requestId = crypto.randomUUID();
  await query(
    `INSERT INTO system_management_fund_request (
      request_id, title, requested_amount, requested_by_chat_id, status, note
    ) VALUES ($1,$2,$3,$4,'pending',$5)`,
    [requestId, String(title).trim(), requestedAmount, req.systemAdmin.telegram_chat_id, note],
  );

  await insertFundAuditLog({
    actionType: 'create_request',
    actorChatId: req.systemAdmin.telegram_chat_id,
    actorRole: req.systemAdmin.admin_role,
    entityType: 'request',
    entityId: requestId,
    notes: 'Membuat permintaan dana manajemen',
    metadata: { title, requested_amount: requestedAmount },
  });

  return res.status(201).json({ success: true, request_id: requestId });
});

router.post('/management/funds/requests/:requestId/approve', requireSystemAdminRoles('super_admin', 'finance_admin'), async (req, res) => {
  const { requestId } = req.params;
  const { approval_note = null } = req.body || {};

  const existing = await query(
    'SELECT request_id, status FROM system_management_fund_request WHERE request_id = $1',
    [requestId],
  );

  if (!existing.rows[0]) {
    return res.status(404).json({ success: false, message: 'Request dana tidak ditemukan' });
  }
  if (existing.rows[0].status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Request sudah diproses' });
  }

  await query(
    `UPDATE system_management_fund_request
     SET status = 'approved', approved_by_chat_id = $2, approved_at = NOW(), note = COALESCE($3, note)
     WHERE request_id = $1`,
    [requestId, req.systemAdmin.telegram_chat_id, approval_note],
  );

  await insertFundAuditLog({
    actionType: 'approve_request',
    actorChatId: req.systemAdmin.telegram_chat_id,
    actorRole: req.systemAdmin.admin_role,
    entityType: 'request',
    entityId: requestId,
    notes: 'Menyetujui permintaan dana manajemen',
    metadata: { approval_note },
  });

  return res.json({ success: true, message: 'Request dana berhasil disetujui' });
});

router.post('/management/funds/requests/:requestId/reject', requireSystemAdminRoles('super_admin', 'finance_admin'), async (req, res) => {
  const { requestId } = req.params;
  const { rejection_reason } = req.body || {};

  if (!rejection_reason || !String(rejection_reason).trim()) {
    return res.status(400).json({ success: false, message: 'rejection_reason wajib diisi' });
  }

  const existing = await query(
    'SELECT request_id, status FROM system_management_fund_request WHERE request_id = $1',
    [requestId],
  );

  if (!existing.rows[0]) {
    return res.status(404).json({ success: false, message: 'Request dana tidak ditemukan' });
  }
  if (existing.rows[0].status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Request sudah diproses' });
  }

  await query(
    `UPDATE system_management_fund_request
     SET status = 'rejected', approved_by_chat_id = $2, approved_at = NOW(), note = $3
     WHERE request_id = $1`,
    [requestId, req.systemAdmin.telegram_chat_id, String(rejection_reason).trim()],
  );

  await insertFundAuditLog({
    actionType: 'reject_request',
    actorChatId: req.systemAdmin.telegram_chat_id,
    actorRole: req.systemAdmin.admin_role,
    entityType: 'request',
    entityId: requestId,
    notes: 'Menolak permintaan dana manajemen',
    metadata: { rejection_reason: String(rejection_reason).trim() },
  });

  return res.json({ success: true, message: 'Request dana berhasil ditolak' });
});

router.get('/management/funds/audit', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;
  const actionType = String(req.query.action_type || '').trim().toLowerCase();

  const whereParts = [];
  const values = [];
  if (actionType) {
    values.push(actionType);
    whereParts.push(`LOWER(action_type) = $${values.length}`);
  }
  const auditDateFilter = parseDateRangeFilter(req, values, whereParts, 'created_at');
  if (auditDateFilter.error) {
    return res.status(400).json({ success: false, message: auditDateFilter.error });
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS total FROM system_management_fund_audit ${whereClause}`;
  const dataSql = `SELECT audit_id, action_type, actor_telegram_chat_id, actor_admin_role, entity_type, entity_id, notes, metadata, created_at
     FROM system_management_fund_audit
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

  const [countResult, result] = await Promise.all([
    query(countSql, values),
    query(dataSql, [...values, limit, offset]),
  ]);

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  });
});

router.get('/management/funds/audit/export.csv', async (_req, res) => {
  const result = await query(
    `SELECT created_at, action_type, actor_telegram_chat_id, actor_admin_role, entity_type, entity_id, notes
     FROM system_management_fund_audit
     ORDER BY created_at DESC
     LIMIT 1000`,
  );

  const header = 'created_at,action_type,actor_telegram_chat_id,actor_admin_role,entity_type,entity_id,notes';
  const rows = result.rows.map((row) => {
    const values = [
      row.created_at,
      row.action_type,
      row.actor_telegram_chat_id,
      row.actor_admin_role,
      row.entity_type,
      row.entity_id,
      row.notes || '',
    ];
    return values
      .map(value => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(',');
  });

  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fund-audit-log.csv"');
  return res.send(csv);
});

export default router;
