import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import * as penmasUserModel from "../model/penmasUserModel.js";
import * as dashboardUserModel from "../model/dashboardUserModel.js";
import * as userModel from "../model/userModel.js";
import * as clientModel from "../model/clientModel.js";
import * as dashboardSubscriptionService from "../service/dashboardSubscriptionService.js";
import {
  minPhoneDigitLength,
  normalizeWhatsappNumber,
  formatToWhatsAppId,
} from "../utils/waHelper.js";
import { insertVisitorLog } from "../model/visitorLogModel.js";
import { insertLoginLog } from "../model/loginLogModel.js";
import { normalizeUserId } from '../utils/utilsHelper.js';
import {
  sendLoginLogNotification,
  sendUserApprovalRequest,
  sendTelegramAdminMessage,
} from "../service/telegramService.js";

import {
  clearAuthCookie,
  clearClientSessions,
  clearDashboardSessions,
  clearPenmasSessions,
  clearUserSessions,
  cookieOptions,
  registerSession,
  revokeSessionToken,
  sendSessionUnavailable,
  AUTH_TOKEN_LIFETIME_SECONDS,
} from './auth/shared.js';
import {
  handleDashboardPasswordResetConfirm,
  handleDashboardPasswordResetRequest,
} from './auth/passwordResetHandlers.js';

export {
  handleDashboardPasswordResetConfirm,
  handleDashboardPasswordResetRequest,
};

const router = express.Router();

function getApprovalNotificationStatus(results) {
  if (!Array.isArray(results)) return results ? 'sent' : 'failed';
  if (results.length === 0) return 'not_configured';
  return results.some(Boolean) ? 'sent' : 'bot_unavailable';
}

function getRequestToken(req) {
  const authorizationHeader = req.headers.authorization;
  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.split(' ')[1];
  }
  return req.cookies?.token || null;
}

router.post('/logout', async (req, res) => {
  const token = getRequestToken(req);
  if (token) {
    await revokeSessionToken(token);
  }
  clearAuthCookie(res);
  return res.json({ success: true, message: 'Logout berhasil' });
});

router.post('/penmas-register', async (req, res) => {
  if (process.env.PENMAS_PUBLIC_REGISTRATION_ENABLED !== 'true') {
    return res.status(403).json({
      success: false,
      message: 'Registrasi Penmas publik dinonaktifkan. Hubungi administrator.',
    });
  }

  const { username, password } = req.body;
  const role = 'penulis';
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'username dan password wajib diisi' });
  }
  const existing = await penmasUserModel.findByUsername(username);
  if (existing) {
    return res
      .status(400)
      .json({ success: false, message: 'username sudah terpakai' });
  }
  const user_id = uuidv4();
  const password_hash = await bcrypt.hash(password, 10);
  const user = await penmasUserModel.createUser({
    user_id,
    username,
    password_hash,
    role,
  });
  return res.status(201).json({ success: true, user_id: user.user_id });
});

router.post('/penmas-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'username dan password wajib diisi' });
  }
  const user = await penmasUserModel.findByUsername(username);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: data tidak ditemukan' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: password salah' });
  }
  const payload = { user_id: user.user_id, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: AUTH_TOKEN_LIFETIME_SECONDS,
  });
  await clearPenmasSessions(user.user_id);
  try {
    await registerSession({
      sessionKey: `penmas_login:${user.user_id}`,
      token,
      tokenOwner: `penmas:${user.user_id}`,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login penmas:', err.message);
    return sendSessionUnavailable(res);
  }
  res.cookie('token', token, cookieOptions);
  await insertLoginLog({
    actorId: user.user_id,
    loginType: 'operator',
    loginSource: 'web'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  sendTelegramAdminMessage(
    `🔑 *Login Penmas*\n\nUsername: ${user.username}\nRole: ${user.role}\nWaktu: ${time}`
  ).catch(err => console.warn('[Telegram] Failed to send login notification:', err.message));
  return res.json({ success: true, token, user: payload });
});

router.post('/dashboard-register', async (req, res) => {
  // telegram_chat_id is intentionally not accepted from public registration.
  // Admin/operator must populate it only after verifying ownership of the Telegram chat.
  let { username, password, role_id, role, client_ids, client_id, email } = req.body;
  const status = false;
  const clientIds = client_ids || (client_id ? [client_id] : []);
  if (!username || !password || !email) {
    return res
      .status(400)
      .json({ success: false, message: 'username, password, dan email wajib diisi' });
  }
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res
      .status(400)
      .json({ success: false, message: 'email tidak valid' });
  }
  const existing = await dashboardUserModel.findByUsername(username);
  if (existing) {
    return res
      .status(400)
      .json({ success: false, message: 'username sudah terpakai' });
  }
  const dashboard_user_id = uuidv4();
  const password_hash = await bcrypt.hash(password, 10);

  let roleRow;
  if (role_id) {
    const { rows } = await query('SELECT role_id, role_name FROM roles WHERE role_id = $1', [role_id]);
    roleRow = rows[0];
    if (!roleRow) {
      return res.status(400).json({ success: false, message: 'role_id tidak valid' });
    }
  } else if (role) {
    const { rows } = await query(
      'SELECT role_id, role_name FROM roles WHERE LOWER(role_name) = LOWER($1)',
      [role]
    );
    roleRow = rows[0];
    if (!roleRow) {
      return res.status(400).json({ success: false, message: 'role tidak valid' });
    }
    role_id = roleRow.role_id;
  } else {
    const { rows } = await query(
      'SELECT role_id, role_name FROM roles WHERE LOWER(role_name) = LOWER($1)',
      ['operator']
    );
    roleRow = rows[0];
    if (!roleRow) {
      const inserted = await query(
        'INSERT INTO roles (role_name) VALUES ($1) ON CONFLICT (role_name) DO UPDATE SET role_name=EXCLUDED.role_name RETURNING role_id, role_name',
        ['operator']
      );
      roleRow = inserted.rows[0];
    }
    role_id = roleRow.role_id;
  }

  if (roleRow.role_name === 'operator' && clientIds.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: 'minimal satu client harus dipilih' });
  }

  const user = await dashboardUserModel.createUser({
    dashboard_user_id,
    username,
    password_hash,
    role_id,
    status,
    approval_status: 'pending',
    email,
  });
  if (clientIds.length > 0) {
    await dashboardUserModel.addClients(dashboard_user_id, clientIds);
  }

  // Fetch client names for the approval message
  let clientNamesList = [];
  let resolvedClientIds = [];
  if (clientIds.length > 0) {
    const clientPromises = clientIds.map(clientId =>
      clientModel.findById(clientId).then(client => ({ clientId, client }))
    );
    const clientResults = await Promise.all(clientPromises);
    resolvedClientIds = clientResults.map(({ clientId, client }) => client?.client_id || clientId);
    clientNamesList = clientResults.map(({ clientId, client }) => {
      if (client && client.nama) {
        return `${client.nama} (${client.client_id || clientId})`;
      }
      // Return with indicator when client data is missing or incomplete
      return `${clientId} (Unknown)`;
    });
  }

  // Log approval request
  console.log('[AUTH]',
    `\uD83D\uDCCB Permintaan User Approval dengan data sebagai berikut :\nUsername: ${username}\nID: ${dashboard_user_id}\nRole: ${roleRow?.role_name || '-'}\nEmail: ${email}\nClient ID: ${
      clientIds.length ? clientIds.join(', ') : '-'
    }\n\nBalas approvedash#${username} untuk menyetujui atau denydash#${username} untuk menolak.`
  );

  // The account and client relations are the source of truth. Telegram delivery
  // is awaited and audited, but a delivery failure must not roll registration back.
  let notificationStatus;
  try {
    const notificationResults = await sendUserApprovalRequest({
      dashboard_user_id: user.dashboard_user_id,
      username: user.username,
      email: user.email,
      role: roleRow?.role_name,
      clientIds: resolvedClientIds.length ? resolvedClientIds.join(', ') : '-',
      clientNames: clientNamesList.length ? clientNamesList.join(', ') : '-'
    });
    notificationStatus = getApprovalNotificationStatus(notificationResults);
  } catch (err) {
    notificationStatus = 'failed';
    console.warn(`[Telegram] Failed to send approval request: ${err.message}`);
  }

  console.log('[AUTH_AUDIT]', JSON.stringify({
    event: 'dashboard_registration_approval_notification',
    dashboard_user_id,
    username,
    client_ids: clientIds,
    notification_status: notificationStatus
  }));

  return res
    .status(201)
    .json({
      success: true,
      dashboard_user_id: user.dashboard_user_id,
      status: user.status,
      approval_status: user.approval_status,
      notification_status: notificationStatus
    });
});

router.post('/dashboard-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'username dan password wajib diisi' });
  }
  const user = await dashboardUserModel.findByUsername(username);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: data tidak ditemukan' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: password salah' });
  }
  const effectiveApprovalStatus = dashboardUserModel.getEffectiveApprovalStatus(user);
  if (effectiveApprovalStatus !== 'approved') {
    const message = effectiveApprovalStatus === 'rejected' ? 'Akun ditolak' : 'Akun belum disetujui';
    return res.status(403).json({ success: false, message });
  }
  if (!user.client_ids || user.client_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: 'Operator belum memiliki klien yang diizinkan' });
  }
  const premiumSnapshot = await dashboardSubscriptionService.getPremiumSnapshot(user);
  let roleName = user.role;
  if (user.client_ids.length === 1) {
    const [singleClientId] = user.client_ids;
    const { rows } = await query('SELECT client_type FROM clients WHERE client_id = $1', [singleClientId]);
    if (rows[0]?.client_type?.toLowerCase() === 'direktorat') {
      roleName = String(singleClientId).toLowerCase();
    }
  }
  const payload = {
    dashboard_user_id: user.dashboard_user_id,
    role: roleName,
    role_id: user.role_id,
    client_ids: user.client_ids,
    premium_status: premiumSnapshot.premiumStatus,
    premium_tier: premiumSnapshot.premiumTier,
    premium_expires_at: premiumSnapshot.premiumExpiresAt
  };
  if (user.client_ids.length === 1) {
    payload.client_id = user.client_ids[0];
  }
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: AUTH_TOKEN_LIFETIME_SECONDS,
  });
  await clearDashboardSessions(user.dashboard_user_id);
  try {
    await registerSession({
      sessionKey: `dashboard_login:${user.dashboard_user_id}`,
      token,
      tokenOwner: `dashboard:${user.dashboard_user_id}`,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login dashboard:', err.message);
    return sendSessionUnavailable(res);
  }
  res.cookie('token', token, cookieOptions);
  await insertLoginLog({
    actorId: user.dashboard_user_id,
    loginType: 'operator',
    loginSource: 'web'
  });
  const clientInfoLabel = user.client_ids.length === 1 ? 'Client ID' : 'Client IDs';
  const clientInfo = user.client_ids.length === 1 ? user.client_ids[0] : user.client_ids.join(', ');

  // Send notification to admin via Telegram
  sendLoginLogNotification({
    username: user.username,
    role: user.role,
    loginType: 'operator',
    loginSource: 'web',
    timestamp: new Date(),
    clientInfo: {
      label: clientInfoLabel,
      value: clientInfo
    }
  }).catch((err) => {
    console.warn(`[Telegram] Failed to send login notification: ${err.message}`);
  });

  return res.json({ success: true, token, user: payload });
});

// Canonical dashboard password-reset routes live under /api/password-reset/*.
// Keep the /api/auth/* aliases for backward compatibility during migration.
router.post('/dashboard-password-reset/request', handleDashboardPasswordResetRequest);
router.post('/password-reset/request', handleDashboardPasswordResetRequest);

router.post('/dashboard-password-reset/confirm', handleDashboardPasswordResetConfirm);
router.post('/password-reset/confirm', handleDashboardPasswordResetConfirm);

router.post("/login", async (req, res) => {
  const { client_id, client_operator } = req.body;
  // Validasi input
  if (!client_id || !client_operator) {
    const reason = "client_id dan client_operator wajib diisi";
    const time = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });
    console.log('[AUTH]',
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id || "-"}\nOperator: ${
        client_operator || "-"}\nWaktu: ${time}`
    );
    return res
      .status(400)
      .json({ success: false, message: reason });
  }
  // Cari client berdasarkan ID saja
  const { rows } = await query(
    "SELECT * FROM clients WHERE client_id = $1",
    [client_id]
  );
  const client = rows[0];
  // Jika client tidak ditemukan
  if (!client) {
    const reason = "client_id tidak ditemukan";
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    console.log('[AUTH]',
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id}\nOperator: ${client_operator}\nWaktu: ${time}`
    );
    return res.status(401).json({
      success: false,
      message: `Login gagal: ${reason}`,
    });
  }

  // Cek operator yang diberikan: boleh operator asli atau admin
  const inputId = formatToWhatsAppId(client_operator);
  const dbOperator = client.client_operator
    ? formatToWhatsAppId(client.client_operator)
    : "";

  const isValidOperator =
    inputId === dbOperator ||
    client_operator === client.client_operator;

  if (!isValidOperator) {
    const reason = "client operator tidak valid";
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    console.warn(
      `[AUTH] Login failed: ${reason} - ID: ${client_id}, Operator: ${client_operator}, Time: ${time}`
    );
    return res.status(401).json({
      success: false,
      message: `Login gagal: ${reason}`,
    });
  }

  // Generate JWT token
  const role =
    client.client_type?.toLowerCase() === "direktorat"
      ? client.client_id.toLowerCase()
      : "client";
  const payload = {
    client_id: client.client_id,
    nama: client.nama,
    role,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: AUTH_TOKEN_LIFETIME_SECONDS,
  });
  await clearClientSessions(client_id);
  try {
    await registerSession({
      sessionKey: `login:${client_id}`,
      token,
      tokenOwner: client_id,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login:', err.message);
    return sendSessionUnavailable(res);
  }
  res.cookie('token', token, cookieOptions);
  await insertLoginLog({
    actorId: client.client_id,
    loginType: 'operator',
    loginSource: 'mobile'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  // Send notification to admin via WhatsApp
  console.log('[AUTH]',
    `\uD83D\uDD11 Login: ${client.nama} (${client.client_id})\nOperator: ${client_operator}\nWaktu: ${time}`
  );

  // Send notification to admin via Telegram
  sendLoginLogNotification({
    username: client.nama,
    role: role,
    loginType: 'operator',
    loginSource: 'mobile',
    timestamp: new Date(),
    clientInfo: {
      label: 'Client ID',
      value: client.client_id
    }
  }).catch((err) => {
    console.warn(`[Telegram] Failed to send login notification: ${err.message}`);
  });

  // Kembalikan token dan data client
  return res.json({ success: true, token, client: payload });
});

router.post('/user-register', async (req, res) => {
  const { nrp, nama, client_id, whatsapp = '', divisi = '', jabatan = '', title = '' } = req.body;
  if (!nrp || !nama || !client_id) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp, nama, dan client_id wajib diisi' });
  }
  const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp);
  if (whatsapp && (!normalizedWhatsapp || normalizedWhatsapp.length < minPhoneDigitLength)) {
    return res
      .status(400)
      .json({ success: false, message: 'whatsapp tidak valid' });
  }
  const existing = await query('SELECT * FROM "user" WHERE user_id = $1', [nrp]);
  if (existing.rows.length) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp sudah terdaftar' });
  }
  const user = await userModel.createUser({
    user_id: nrp,
    nama,
    client_id,
    whatsapp: normalizedWhatsapp,
    divisi,
    jabatan,
    title
  });
  return res.status(201).json({ success: true, user_id: user.user_id });
});

router.post('/user-login', async (req, res) => {
  const { user_id, whatsapp, nrp, password } = req.body;

  // Support both new mechanism (user_id + whatsapp) and old mechanism (nrp + password)
  if (user_id && whatsapp) {
    // New mechanism: authenticate with user_id and whatsapp
    const normalizedUserId = normalizeUserId(user_id);
    const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp);

    if (!normalizedUserId) {
      return res
        .status(400)
        .json({ success: false, message: 'user_id dan whatsapp wajib diisi' });
    }

    if (!normalizedWhatsapp || normalizedWhatsapp.length < minPhoneDigitLength) {
      return res
        .status(400)
        .json({ success: false, message: 'whatsapp tidak valid' });
    }

    const { rows } = await query(
      'SELECT user_id, nama, whatsapp, "user".client_id FROM "user" WHERE user_id = $1 AND whatsapp = $2',
      [normalizedUserId, normalizedWhatsapp]
    );
    const user = rows[0];

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Login gagal: user_id atau whatsapp tidak sesuai' });
    }

    const payload = {
      user_id: user.user_id,
      nama: user.nama,
      role: 'user',
      client_id: user.client_id
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_LIFETIME_SECONDS
    });
    await clearUserSessions(user.user_id);
    try {
      await registerSession({
        sessionKey: `user_login:${user.user_id}`,
        token,
        tokenOwner: `user:${user.user_id}`,
      });
    } catch (err) {
      console.error('[AUTH] Gagal menyimpan token login user:', err.message);
      return sendSessionUnavailable(res);
    }
    res.cookie('token', token, cookieOptions);
    await insertLoginLog({
      actorId: user.user_id,
      loginType: 'user',
      loginSource: 'mobile'
    });
    if (process.env.ADMIN_NOTIFY_LOGIN !== 'false') {
      const time = new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta'
      });
      console.warn('[AUTH]',
        `\uD83D\uDD11 Login user: ${user.user_id} - ${user.nama}\nWaktu: ${time}`
      );
    }
    return res.json({ success: true, token, user: payload });
  } else if (nrp && password) {
    // Old mechanism: authenticate with nrp and password
    const normalizedNrp = normalizeUserId(nrp);
    if (!normalizedNrp || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'nrp dan password wajib diisi' });
    }
    const { rows } = await query(
      'SELECT user_id, nama, password_hash, client_id FROM "user" WHERE user_id = $1',
      [normalizedNrp]
    );
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res
        .status(401)
        .json({ success: false, message: 'Login gagal: kredensial belum terdaftar' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res
        .status(401)
        .json({ success: false, message: 'Login gagal: password salah' });
    }
    const payload = {
      user_id: user.user_id,
      nama: user.nama,
      role: 'user',
      client_id: user.client_id
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_LIFETIME_SECONDS
    });
    await clearUserSessions(user.user_id);
    try {
      await registerSession({
        sessionKey: `user_login:${user.user_id}`,
        token,
        tokenOwner: `user:${user.user_id}`,
      });
    } catch (err) {
      console.error('[AUTH] Gagal menyimpan token login user:', err.message);
      return sendSessionUnavailable(res);
    }
    res.cookie('token', token, cookieOptions);
    await insertLoginLog({
      actorId: user.user_id,
      loginType: 'user',
      loginSource: 'mobile'
    });
    if (process.env.ADMIN_NOTIFY_LOGIN !== 'false') {
      const time = new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta'
      });
      console.warn('[AUTH]',
        `\uD83D\uDD11 Login user: ${user.user_id} - ${user.nama}\nWaktu: ${time}`
      );
    }
    return res.json({ success: true, token, user: payload });
  } else {
    return res
      .status(400)
      .json({ success: false, message: 'user_id dan whatsapp atau nrp dan password wajib diisi' });
  }
});

router.get('/open', async (req, res) => {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  await insertVisitorLog({ ip, userAgent: ua });
  console.log('[AUTH]',
    `\uD83D\uDD0D Web dibuka\nIP: ${ip}\nUA: ${ua}\nWaktu: ${time}`
  );
  return res.json({ success: true });
});


export default router;
