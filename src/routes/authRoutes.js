import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import * as penmasUserModel from "../model/penmasUserModel.js";
import * as dashboardUserModel from "../model/dashboardUserModel.js";
import * as dashboardPasswordResetModel from "../model/dashboardPasswordResetModel.js";
import * as userModel from "../model/userModel.js";
import * as dashboardSubscriptionService from "../service/dashboardSubscriptionService.js";
import {
  minPhoneDigitLength,
  normalizeWhatsappNumber,
} from "../utils/waHelper.js";
import redis from "../config/redis.js";
import { insertVisitorLog } from "../model/visitorLogModel.js";
import { insertLoginLog } from "../model/loginLogModel.js";
import { 
  sendLoginLogNotification, 
  sendUserApprovalRequest,
  sendPasswordResetFailureNotification,
  sendTelegramAdminMessage
} from "../service/telegramService.js";

const RESET_TOKEN_EXPIRY_MINUTES = Number(
  process.env.DASHBOARD_RESET_TOKEN_EXPIRY_MINUTES || 15,
);

const DEFAULT_RESET_BASE_URL = "https://papiqo.com";

function buildResetMessage({ username, token }) {
  const configuredBaseUrl =
    process.env.DASHBOARD_PASSWORD_RESET_URL || process.env.DASHBOARD_URL;
  const resetBaseUrl = configuredBaseUrl || DEFAULT_RESET_BASE_URL;
  const header = "🔐 Reset Password Dashboard";
  const baseUrlWithoutTrailingSlash = resetBaseUrl.replace(/\/$/, "");
  const baseResetPath = baseUrlWithoutTrailingSlash.endsWith("/reset-password")
    ? baseUrlWithoutTrailingSlash
    : `${baseUrlWithoutTrailingSlash}/reset-password`;
  const url = `${baseResetPath}?token=${token}`;
  const instruction =
    `Username: ${username}\nToken: ${token}\nToken berlaku selama ${RESET_TOKEN_EXPIRY_MINUTES} menit. Dengan url ${baseResetPath}`;
  return `${header}\n\nSilakan buka tautan berikut untuk mengatur ulang password Anda:\n${url}\n\n${instruction}`;
}

async function clearDashboardSessions(dashboardUserId) {
  const sessionKey = `dashboard_login:${dashboardUserId}`;
  try {
    if (typeof redis.sMembers === "function") {
      const tokens = await redis.sMembers(sessionKey);
      if (Array.isArray(tokens) && tokens.length > 0) {
        await Promise.all(
          tokens.map((token) =>
            redis
              .del(`login_token:${token}`)
              .catch((err) =>
                console.error(
                  `[AUTH] Gagal menghapus token login ${token}: ${err.message}`,
                ),
              ),
          ),
        );
      }
    }
    if (typeof redis.del === "function") {
      await redis.del(sessionKey);
    }
  } catch (err) {
    console.error(
      `[AUTH] Gagal menghapus sesi dashboard ${dashboardUserId}: ${err.message}`,
    );
  }
}

const router = express.Router();

export async function handleDashboardPasswordResetRequest(req, res) {
  const { username, contact } = req.body;
  if (!username || !contact) {
    return res.status(400).json({
      success: false,
      message: 'username dan kontak wajib diisi',
    });
  }
  const normalizedContact = normalizeWhatsappNumber(contact);
  if (!normalizedContact || normalizedContact.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'kontak whatsapp tidak valid',
    });
  }
  try {
    const user = await dashboardUserModel.findByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'pengguna dashboard tidak ditemukan',
      });
    }

    let matchesWhatsapp = false;
    if (user.whatsapp) {
      matchesWhatsapp =
        normalizeWhatsappNumber(user.whatsapp) === normalizedContact;
    }
    if (!matchesWhatsapp) {
      const candidates = await dashboardUserModel.findAllByNormalizedWhatsApp(
        normalizedContact,
      );
      matchesWhatsapp = candidates.some(
        (candidate) => candidate.dashboard_user_id === user.dashboard_user_id,
      );
    }
    if (!matchesWhatsapp) {
      return res.status(400).json({
        success: false,
        message: 'kontak tidak sesuai dengan data pengguna',
      });
    }

    const resetToken = uuidv4();
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000,
    );
    await dashboardPasswordResetModel.createResetRequest({
      dashboardUserId: user.dashboard_user_id,
      deliveryTarget: contact,
      resetToken,
      expiresAt,
    });

    try {
      const message = buildResetMessage({ username: user.username, token: resetToken });
      const sent = await sendTelegramAdminMessage(message);
      if (!sent) {
        throw new Error('Telegram send returned null');
      }
    } catch (err) {
      console.warn(
        `[Telegram] Gagal mengirim reset password dashboard untuk ${username}: ${err.message}`,
      );
      await sendPasswordResetFailureNotification(
        `⚠️ Reset password dashboard gagal dikirim. Username: ${username}. Kontak: ${contact}. Token: ${resetToken}`,
      ).catch(e => console.error('[Telegram] Failed to send failure notification:', e));
      return res.status(500).json({
        success: false,
        message:
          'Instruksi reset tidak dapat dikirim. Silakan hubungi admin untuk bantuan.',
      });
    }

    return res.json({
      success: true,
      message: 'Instruksi reset password telah dikirim ke admin melalui Telegram.',
    });
  } catch (err) {
    console.error('[AUTH] Gagal membuat permintaan reset password dashboard:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server. Silakan hubungi admin.',
    });
  }
}

export async function handleDashboardPasswordResetConfirm(req, res) {
  const { token, password, confirmPassword, password_confirmation: passwordConfirmation } =
    req.body;
  const confirmation = confirmPassword ?? passwordConfirmation;
  if (!token || !password || !confirmation) {
    return res.status(400).json({
      success: false,
      message: 'token, password, dan konfirmasi wajib diisi',
    });
  }
  if (password !== confirmation) {
    return res.status(400).json({
      success: false,
      message: 'konfirmasi password tidak cocok',
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'password minimal 8 karakter',
    });
  }

  try {
    const resetRecord = await dashboardPasswordResetModel.findActiveByToken(token);
    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: 'token reset tidak valid atau sudah kedaluwarsa',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await dashboardUserModel.updatePasswordHash(
      resetRecord.dashboard_user_id,
      passwordHash,
    );
    if (!updatedUser) {
      throw new Error('dashboard user not found when updating password');
    }

    await dashboardPasswordResetModel.markTokenUsed(token);
    await clearDashboardSessions(resetRecord.dashboard_user_id);

    return res.json({
      success: true,
      message: 'Password berhasil diperbarui. Silakan login kembali.',
    });
  } catch (err) {
    console.error('[AUTH] Gagal mengonfirmasi reset password dashboard:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui password. Silakan hubungi admin.',
    });
  }
}

router.post('/penmas-register', async (req, res) => {
  const { username, password, role = 'penulis' } = req.body;
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
    expiresIn: '2h',
  });
  try {
    await redis.sAdd(`penmas_login:${user.user_id}`, token);
    await redis.set(`login_token:${token}`, `penmas:${user.user_id}`, {
      EX: 2 * 60 * 60,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login penmas:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  await insertLoginLog({
    actorId: user.user_id,
    loginType: 'operator',
    loginSource: 'web'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  notifyAdmin(
    `\uD83D\uDD11 Login Penmas: ${user.username} (${user.role})\nWaktu: ${time}`
  );
  return res.json({ success: true, token, user: payload });
});

router.post('/dashboard-register', async (req, res) => {
  let { username, password, role_id, role, client_ids, client_id, whatsapp, email } = req.body;
  const status = false;
  const clientIds = client_ids || (client_id ? [client_id] : []);
  if (!username || !password || !whatsapp) {
    return res
      .status(400)
      .json({ success: false, message: 'username, password, dan whatsapp wajib diisi' });
  }
  const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp);
  if (normalizedWhatsapp.length < 8) {
    return res
      .status(400)
      .json({ success: false, message: 'whatsapp tidak valid' });
  }
  whatsapp = normalizedWhatsapp;
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
    whatsapp,
  });
  if (clientIds.length > 0) {
    await dashboardUserModel.addClients(dashboard_user_id, clientIds);
  }

  // Send approval request to admin via WhatsApp
  notifyAdmin(
    `\uD83D\uDCCB Permintaan User Approval dengan data sebagai berikut :\nUsername: ${username}\nID: ${dashboard_user_id}\nRole: ${roleRow?.role_name || '-'}\nWhatsApp: ${whatsapp}\nClient ID: ${
      clientIds.length ? clientIds.join(', ') : '-'
    }\n\nBalas approvedash#${username} untuk menyetujui atau denydash#${username} untuk menolak.`
  );

  // Send approval request to admin via Telegram
  sendUserApprovalRequest({
    dashboard_user_id,
    username,
    whatsapp,
    email,
    role: roleRow?.role_name,
    clientIds: clientIds.length ? clientIds.join(', ') : '-'
  }).catch((err) => {
    console.warn(`[Telegram] Failed to send approval request: ${err.message}`);
  });

  if (whatsapp) {
    try {
      await waitForWaReady();
      const wid = formatToWhatsAppId(whatsapp);
      safeSendMessage(
        waClient,
        wid,
        "\uD83D\uDCCB Permintaan registrasi dashboard Anda telah diterima dan menunggu persetujuan admin."
      );
    } catch (err) {
      console.warn(
        `[WA] Skipping user notification for ${whatsapp}: ${err.message}`
      );
    }
  }
  return res
    .status(201)
    .json({ success: true, dashboard_user_id: user.dashboard_user_id, status: user.status });
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
  if (!user.status) {
    return res
      .status(403)
      .json({ success: false, message: 'Akun belum disetujui' });
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
    expiresIn: '2h',
  });
  try {
    await redis.sAdd(`dashboard_login:${user.dashboard_user_id}`, token);
    await redis.set(`login_token:${token}`, `dashboard:${user.dashboard_user_id}`, {
      EX: 2 * 60 * 60,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login dashboard:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  await insertLoginLog({
    actorId: user.dashboard_user_id,
    loginType: 'operator',
    loginSource: 'web'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const clientInfoLabel = user.client_ids.length === 1 ? 'Client ID' : 'Client IDs';
  const clientInfo = user.client_ids.length === 1 ? user.client_ids[0] : user.client_ids.join(', ');
  
  // Send notification to admin via WhatsApp
  notifyAdmin(
    `\uD83D\uDD11 Login dashboard: ${user.username} (${user.role})\n${clientInfoLabel}: ${clientInfo}\nWaktu: ${time}`
  );
  
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
    notifyAdmin(
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
    notifyAdmin(
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
    client_operator === client.client_operator ||
    isAdminWhatsApp(inputId) ||
    isAdminWhatsApp(client_operator);

  if (!isValidOperator) {
    const reason = "client operator tidak valid";
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    notifyAdmin(
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id}\nOperator: ${client_operator}\nWaktu: ${time}`
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
    expiresIn: "2h",
  });
  try {
    const setKey = `login:${client_id}`;
    await redis.sAdd(setKey, token);
    await redis.set(`login_token:${token}`, client_id, { EX: 2 * 60 * 60 });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production'
  });
  await insertLoginLog({
    actorId: client.client_id,
    loginType: 'operator',
    loginSource: 'mobile'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  
  // Send notification to admin via WhatsApp
  notifyAdmin(
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
  if (whatsapp && normalizedWhatsapp.length < minPhoneDigitLength) {
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
  const { nrp, whatsapp, password } = req.body;
  const waInput = whatsapp || password;
  if (!nrp || !waInput) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp dan whatsapp wajib diisi' });
  }
  const wa = normalizeWhatsappNumber(waInput);
  const rawWa = String(waInput).replace(/\D/g, "");
  const { rows } = await query(
    'SELECT user_id, nama FROM "user" WHERE user_id = $1 AND (whatsapp = $2 OR whatsapp = $3)',
    [nrp, wa, rawWa]
  );
  const user = rows[0];
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: data tidak ditemukan' });
  }
  const payload = { user_id: user.user_id, nama: user.nama, role: 'user' };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '2h'
  });
  try {
    await redis.sAdd(`user_login:${user.user_id}`, token);
    await redis.set(`login_token:${token}`, `user:${user.user_id}`, {
      EX: 2 * 60 * 60
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login user:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production'
  });
  await insertLoginLog({
    actorId: user.user_id,
    loginType: 'user',
    loginSource: 'mobile'
  });
  if (process.env.ADMIN_NOTIFY_LOGIN !== 'false') {
    const time = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta'
    });
    queueAdminNotification(
      `\uD83D\uDD11 Login user: ${user.user_id} - ${user.nama}\nWaktu: ${time}`
    );
  }
  return res.json({ success: true, token, user: payload });
});

router.get('/open', async (req, res) => {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  await insertVisitorLog({ ip, userAgent: ua });
  notifyAdmin(
    `\uD83D\uDD0D Web dibuka\nIP: ${ip}\nUA: ${ua}\nWaktu: ${time}`
  );
  return res.json({ success: true });
});


export default router;
