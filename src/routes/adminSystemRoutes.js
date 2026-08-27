import { Router } from 'express';
import crypto from 'crypto';
import { sanitizeSpreadsheetCell } from '../utils/spreadsheet.js';
import { cookieOptions } from './auth/shared.js';
import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';
import redis from '../config/redis.js';
import { isTelegramAdmin, sendTelegramMessage } from '../service/telegramService.js';
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

function getRequiredWidgetUsername() {
  return String(process.env.ADMIN_SYSTEM_TELEGRAM_USERNAME || 'Cicero_Papiqo').trim();
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

function maskConfigValue(configKey, value) {
  const key = String(configKey || '').trim();
  if (value == null) return value;
  if (['JWT_SECRET'].includes(key)) {
    return '********';
  }
  if (key === 'ADMIN_SYSTEM_ROLE_MAP') {
    return '[masked-json]';
  }
  return value;
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
  const { telegram_username } = req.body || {};
  const requiredUsername = getRequiredWidgetUsername();
  const username = String(telegram_username || '').trim().replace(/^@/, '');

  if (!username) {
    return res.status(400).json({ success: false, message: 'telegram_username wajib diisi' });
  }
  if (username.toLowerCase() !== requiredUsername.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Akses hanya untuk @${requiredUsername}` });
  }

  const [adminChatId] = buildAdminChatIds();
  if (!adminChatId || !isAllowedAdminChatId(adminChatId)) {
    return res.status(403).json({ success: false, message: 'Chat ID Telegram admin tidak valid' });
  }

  const requestId = crypto.randomUUID();
  const otp = generateOtp();

  try {
    await redis.set(
      `admin_otp:${requestId}`,
      JSON.stringify({
        code: otp,
        telegram_chat_id: String(adminChatId),
        telegram_username: requiredUsername,
        failed_attempts: 0,
      }),
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

  const sent = await isTelegramAdmin(adminChatId) ? sendTelegramMessage(adminChatId, message) : null;
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
  const { request_id, otp_code, telegram_username } = req.body || {};

  if (!request_id || !otp_code || !telegram_username) {
    return res.status(400).json({ success: false, message: 'request_id, otp_code, telegram_username wajib diisi' });
  }

  const requiredUsername = getRequiredWidgetUsername();
  const username = String(telegram_username).trim().replace(/^@/, '');
  if (username.toLowerCase() !== requiredUsername.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Akses hanya untuk @${requiredUsername}` });
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

  if (String(payload.telegram_username || '').toLowerCase() !== requiredUsername.toLowerCase()) {
    return res.status(403).json({ success: false, message: 'Username Telegram tidak sesuai' });
  }

  if (String(payload.code) !== String(otp_code).trim()) {
    const nextFailed = Number(payload.failed_attempts || 0) + 1;
    if (nextFailed >= 3) {
      await redis.del(`admin_otp:${request_id}`);
      return res.status(429).json({ success: false, message: 'OTP salah 3x, silakan request ulang' });
    }
    await redis.set(`admin_otp:${request_id}`, JSON.stringify({ ...payload, failed_attempts: nextFailed }), {
      EX: OTP_TTL_SECONDS,
    });
    return res.status(401).json({ success: false, message: 'OTP salah' });
  }

  await redis.del(`admin_otp:${request_id}`);

  const sessionId = crypto.randomUUID();
  const adminRole = resolveAdminRole(payload.telegram_chat_id);
  const scope = mapAdminRoleToScope(adminRole);
  const tokenPayload = {
    role: 'system_admin',
    admin_role: adminRole,
    telegram_chat_id: String(payload.telegram_chat_id),
    username: requiredUsername,
    scope,
    session_id: sessionId,
    auth_source: 'telegram_otp',
  };

  const superAdminSessionTtl = Math.min(ADMIN_SESSION_TTL_SECONDS, 3600);
  const tokenTtlSeconds = adminRole === 'super_admin' ? superAdminSessionTtl : ADMIN_SESSION_TTL_SECONDS;
  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: tokenTtlSeconds });

  try {
    await redis.set(`login_token:${token}`, `admin:${payload.telegram_chat_id}`, { EX: tokenTtlSeconds });
  } catch (err) {
    console.error('[ADMIN AUTH] Failed to persist admin token:', err);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  res.cookie('admin_system_token', token, {
    ...cookieOptions,
    maxAge: tokenTtlSeconds * 1000,
  });

  return res.json({
    success: true,
    admin: {
      role: 'system_admin',
      admin_role: adminRole,
      telegram_chat_id: String(payload.telegram_chat_id),
      username: requiredUsername,
      scope,
      auth_source: 'telegram_otp',
    },
  });
});

router.post('/auth/telegram/widget-login', async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Telegram widget login dinonaktifkan. Gunakan login OTP.',
  });
});

router.get('/auth/telegram/widget-config', async (_req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Telegram widget login dinonaktifkan.',
  });
});

router.use(verifySystemAdminToken);

router.post('/auth/logout', async (req, res) => {
  const token = req.cookies?.admin_system_token;
  if (token) {
    await redis.del(`login_token:${token}`).catch((err) => {
      console.error('[ADMIN AUTH] Failed to revoke admin token:', err);
    });
  }
  res.clearCookie('admin_system_token', cookieOptions);
  return res.json({ success: true });
});

router.get('/auth/me', async (req, res) => {
  return res.json({
    success: true,
    data: {
      role: req.systemAdmin?.role,
      admin_role: req.systemAdmin?.admin_role,
      telegram_chat_id: req.systemAdmin?.telegram_chat_id,
      username: req.systemAdmin?.username,
      scope: req.systemAdmin?.scope || [],
      auth_source: req.systemAdmin?.auth_source,
      session_id: req.systemAdmin?.session_id,
    },
  });
});

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
      old_value: maskConfigValue(key, currentValue),
      new_value: maskConfigValue(key, value),
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
  if (!notes || !String(notes).trim()) {
    return res.status(400).json({ success: false, message: 'notes wajib diisi untuk perubahan konfigurasi' });
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
      String(notes).trim(),
    ],
  ).catch(err => {
    console.error('[ADMIN CONFIG] failed to insert config audit:', err);
  });

  return res.json({
    success: true,
    data: {
      config_key: key,
      old_value: maskConfigValue(key, oldValue),
      new_value: maskConfigValue(key, value),
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
  if (!notes || !String(notes).trim()) {
    return res.status(400).json({ success: false, message: 'notes wajib diisi untuk rollback' });
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
      String(notes).trim(),
    ],
  ).catch(() => null);

  return res.json({
    success: true,
    data: {
      config_key: key,
      reverted_from: maskConfigValue(key, oldValue),
      reverted_to: maskConfigValue(key, String(revertTo)),
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

  const sanitizedRows = (dataResult.rows || []).map(row => ({
    ...row,
    old_value: maskConfigValue(row.config_key, row.old_value),
    new_value: maskConfigValue(row.config_key, row.new_value),
  }));

  return res.json({
    success: true,
    data: sanitizedRows,
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

router.get('/management/clients/summary', async (_req, res) => {
  const [totals, byType, byStatus, hierarchy, topGroups] = await Promise.all([
    query('SELECT COUNT(*)::int AS total_clients FROM clients'),
    query(
      `SELECT COALESCE(client_type, 'UNKNOWN') AS client_type, COUNT(*)::int AS total
       FROM clients
       GROUP BY COALESCE(client_type, 'UNKNOWN')
       ORDER BY total DESC`,
    ),
    query(
      `SELECT
        COUNT(*) FILTER (WHERE client_status = true)::int AS active_clients,
        COUNT(*) FILTER (WHERE client_status = false)::int AS inactive_clients,
        COUNT(*) FILTER (WHERE client_insta_status = true)::int AS insta_enabled,
        COUNT(*) FILTER (WHERE client_tiktok_status = true)::int AS tiktok_enabled,
        COUNT(*) FILTER (WHERE client_amplify_status = true)::int AS amplify_enabled
       FROM clients`,
    ),
    query(
      `SELECT
        COUNT(*) FILTER (WHERE parent_client_id IS NULL)::int AS root_clients,
        COUNT(*) FILTER (WHERE parent_client_id IS NOT NULL)::int AS child_clients
       FROM clients`,
    ),
    query(
      `SELECT COALESCE(client_group, 'UNKNOWN') AS client_group, COUNT(*)::int AS total
       FROM clients
       GROUP BY COALESCE(client_group, 'UNKNOWN')
       ORDER BY total DESC
       LIMIT 10`,
    ),
  ]);

  return res.json({
    success: true,
    data: {
      totals: totals.rows[0] || { total_clients: 0 },
      status: byStatus.rows[0] || {
        active_clients: 0,
        inactive_clients: 0,
        insta_enabled: 0,
        tiktok_enabled: 0,
        amplify_enabled: 0,
      },
      hierarchy: hierarchy.rows[0] || { root_clients: 0, child_clients: 0 },
      by_type: byType.rows,
      top_groups: topGroups.rows,
    },
  });
});

router.get('/management/clients', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;
  const q = String(req.query.q || '').trim();

  const values = [];
  let whereClause = '';
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    whereClause = `WHERE LOWER(client_id) LIKE $1 OR LOWER(nama) LIKE $1 OR LOWER(COALESCE(client_group,'')) LIKE $1`;
  }

  const [countResult, dataResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM clients ${whereClause}`, values),
    query(
      `SELECT client_id, nama, client_type, client_status, client_group, regional_id,
              client_insta, client_insta_status, client_tiktok, client_tiktok_status,
              client_amplify_status, client_operator, client_level, tiktok_secuid, client_super, parent_client_id
       FROM clients
       ${whereClause}
       ORDER BY client_id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
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

router.post('/management/clients', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const body = req.body || {};
  const clientId = String(body.client_id || '').trim();
  const nama = String(body.nama || '').trim();

  if (!clientId || !nama) {
    return res.status(400).json({ success: false, message: 'client_id dan nama wajib diisi' });
  }

  const exists = await query('SELECT 1 FROM clients WHERE LOWER(client_id)=LOWER($1) LIMIT 1', [clientId]);
  if (exists.rows[0]) {
    return res.status(409).json({ success: false, message: 'client_id sudah ada' });
  }

  const insert = await query(
    `INSERT INTO clients (
      client_id, nama, client_type, client_status, client_insta, client_insta_status,
      client_tiktok, client_tiktok_status, client_amplify_status, client_operator,
      client_group, regional_id, parent_client_id, client_level, tiktok_secuid, client_super
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`,
    [
      clientId,
      nama,
      body.client_type || null,
      body.client_status !== false,
      body.client_insta || null,
      body.client_insta_status !== false,
      body.client_tiktok || null,
      body.client_tiktok_status !== false,
      body.client_amplify_status !== false,
      body.client_operator || null,
      body.client_group || null,
      body.regional_id || null,
      body.parent_client_id || null,
      body.client_level || null,
      body.tiktok_secuid || null,
      body.client_super || null,
    ],
  );

  return res.status(201).json({ success: true, data: insert.rows[0] });
});

router.put('/management/clients/:clientId', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const { clientId } = req.params;
  const body = req.body || {};

  const updated = await query(
    `UPDATE clients SET
      nama = COALESCE($2, nama),
      client_type = COALESCE($3, client_type),
      client_status = COALESCE($4, client_status),
      client_insta = COALESCE($5, client_insta),
      client_insta_status = COALESCE($6, client_insta_status),
      client_tiktok = COALESCE($7, client_tiktok),
      client_tiktok_status = COALESCE($8, client_tiktok_status),
      client_amplify_status = COALESCE($9, client_amplify_status),
      client_operator = COALESCE($10, client_operator),
      client_group = COALESCE($11, client_group),
      regional_id = COALESCE($12, regional_id),
      parent_client_id = COALESCE($13, parent_client_id),
      client_level = COALESCE($14, client_level),
      tiktok_secuid = COALESCE($15, tiktok_secuid),
      client_super = COALESCE($16, client_super)
     WHERE LOWER(client_id)=LOWER($1)
     RETURNING *`,
    [
      clientId,
      body.nama ?? null,
      body.client_type ?? null,
      typeof body.client_status === 'boolean' ? body.client_status : null,
      body.client_insta ?? null,
      typeof body.client_insta_status === 'boolean' ? body.client_insta_status : null,
      body.client_tiktok ?? null,
      typeof body.client_tiktok_status === 'boolean' ? body.client_tiktok_status : null,
      typeof body.client_amplify_status === 'boolean' ? body.client_amplify_status : null,
      body.client_operator ?? null,
      body.client_group ?? null,
      body.regional_id ?? null,
      body.parent_client_id ?? null,
      body.client_level ?? null,
      body.tiktok_secuid ?? null,
      body.client_super ?? null,
    ],
  );

  if (!updated.rows[0]) {
    return res.status(404).json({ success: false, message: 'Client tidak ditemukan' });
  }

  return res.json({ success: true, data: updated.rows[0] });
});

router.delete('/management/clients/:clientId', requireSystemAdminRoles('super_admin'), async (req, res) => {
  const { clientId } = req.params;
  const deleted = await query('DELETE FROM clients WHERE LOWER(client_id)=LOWER($1) RETURNING client_id', [clientId]);
  if (!deleted.rows[0]) {
    return res.status(404).json({ success: false, message: 'Client tidak ditemukan' });
  }
  return res.json({ success: true, message: 'Client berhasil dihapus' });
});

router.get('/management/system-audit', async (_req, res) => {
  const cfg = getAdminSystemConfig();
  const analysis = analyzeAdminSystemConfig(cfg);

  const [overview, clients, funds, authAudit] = await Promise.all([
    query(
      `SELECT
        (SELECT COUNT(*)::int FROM dashboard_user) AS total_dashboard_users,
        (SELECT COUNT(*)::int FROM roles) AS total_roles,
        (SELECT COUNT(*)::int FROM user_roles) AS total_user_role_links`,
    ),
    query(
      `SELECT
        COUNT(*)::int AS total_clients,
        COUNT(*) FILTER (WHERE client_status = true)::int AS active_clients,
        COUNT(*) FILTER (WHERE client_status = false)::int AS inactive_clients
       FROM clients`,
    ),
    query(
      `SELECT
        COUNT(*)::int AS total_fund_transactions,
        COALESCE(SUM(CASE WHEN direction='inflow' THEN amount ELSE 0 END),0)::numeric AS total_inflow,
        COALESCE(SUM(CASE WHEN direction='outflow' THEN amount ELSE 0 END),0)::numeric AS total_outflow
       FROM system_management_fund_transaction`,
    ).catch(() => ({ rows: [{ total_fund_transactions: 0, total_inflow: 0, total_outflow: 0 }] })),
    query(
      `SELECT audit_id, action_type, config_key, actor_telegram_chat_id, created_at
       FROM system_management_config_audit
       ORDER BY created_at DESC
       LIMIT 20`,
    ).catch(() => ({ rows: [] })),
  ]);

  return res.json({
    success: true,
    data: {
      config_snapshot: {
        otp_ttl_seconds: cfg.otpTtlSeconds,
        session_ttl_seconds: cfg.sessionTtlSeconds,
        pagination_default_limit: cfg.paginationDefaultLimit,
        pagination_max_limit: cfg.paginationMaxLimit,
        timezone: cfg.timezone,
        total_admin_chat_ids: cfg.adminChatIds.length,
        total_role_mappings: Object.keys(cfg.roleMap || {}).length,
      },
      config_analysis: analysis,
      system_overview: overview.rows[0] || {},
      client_overview: clients.rows[0] || {},
      fund_overview: funds.rows[0] || {},
      recent_config_audit: authAudit.rows || [],
    },
  });
});

router.get('/management/payments/requests', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(config.paginationMaxLimit, Math.max(1, Number(req.query.limit) || config.paginationDefaultLimit));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || '').trim().toLowerCase();
  const allowed = new Set(['pending', 'confirmed', 'approved', 'rejected', 'expired']);

  const values = [];
  let whereClause = '';
  if (status && allowed.has(status)) {
    values.push(status);
    whereClause = `WHERE status = $1`;
  }

  const [countResult, dataResult, totals] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM dashboard_premium_request ${whereClause}`, values),
    query(
      `SELECT request_id, dashboard_user_id, client_id, username, whatsapp, bank_name, account_number,
              sender_name, transfer_amount, premium_tier, proof_url, status, created_at, responded_at, admin_whatsapp
       FROM dashboard_premium_request
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
    query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        COALESCE(SUM(transfer_amount) FILTER (WHERE status IN ('pending','confirmed')),0)::numeric AS pending_amount
       FROM dashboard_premium_request`,
    ),
  ]);

  return res.json({
    success: true,
    data: dataResult.rows,
    summary: totals.rows[0] || {},
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      total_pages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  });
});

router.post('/management/payments/requests/:requestId/decision', requireSystemAdminRoles('super_admin', 'finance_admin'), async (req, res) => {
  const { requestId } = req.params;
  const { status, note = null } = req.body || {};
  const nextStatus = String(status || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: 'status harus approved atau rejected' });
  }

  const existing = await query('SELECT request_id, status, dashboard_user_id FROM dashboard_premium_request WHERE request_id = $1', [requestId]);
  if (!existing.rows[0]) {
    return res.status(404).json({ success: false, message: 'Request payment tidak ditemukan' });
  }

  const prevStatus = existing.rows[0].status;
  const updated = await query(
    `UPDATE dashboard_premium_request
     SET status = $2, responded_at = NOW(), admin_whatsapp = $3, updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('admin_note', $4)
     WHERE request_id = $1
     RETURNING *`,
    [requestId, nextStatus, req.systemAdmin.telegram_chat_id, note],
  );

  await query(
    `INSERT INTO dashboard_premium_request_audit (
      request_id, dashboard_user_id, action, actor, note, status_from, status_to, admin_whatsapp, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      requestId,
      existing.rows[0].dashboard_user_id || null,
      'admin_decision',
      `system_admin:${req.systemAdmin.telegram_chat_id}`,
      note,
      prevStatus,
      nextStatus,
      req.systemAdmin.telegram_chat_id,
      JSON.stringify({ source: 'admin_system' }),
    ],
  ).catch(() => null);

  return res.json({ success: true, data: updated.rows[0] });
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
      .map(value => `"${sanitizeSpreadsheetCell(value).replace(/"/g, '""')}"`)
      .join(',');
  });

  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fund-audit-log.csv"');
  return res.send(csv);
});

export default router;
