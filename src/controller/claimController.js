import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as userModel from '../model/userModel.js';
import * as claimPasswordResetModel from '../model/claimPasswordResetModel.js';
import { sendClaimPasswordResetEmail } from '../service/emailService.js';
import { sendTelegramAdminMessage } from '../service/telegramService.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeEmail, normalizeUserId } from '../utils/utilsHelper.js';
import { normalizeWhatsappNumber, minPhoneDigitLength } from '../utils/waHelper.js';

const validationErrorCodes = {
  invalidWhatsappFormat: 'CLAIM_INVALID_WHATSAPP_FORMAT',
  invalidEmailFormat: 'CLAIM_INVALID_EMAIL_FORMAT',
  invalidInstagramFormat: 'CLAIM_INVALID_INSTAGRAM_FORMAT',
  invalidTiktokFormat: 'CLAIM_INVALID_TIKTOK_FORMAT',
  usernameBlocked: 'CLAIM_USERNAME_BLOCKED',
  duplicateUsernameInput: 'CLAIM_DUPLICATE_USERNAME_INPUT',
  socialUsernameConflict: 'CLAIM_SOCIAL_USERNAME_CONFLICT',
};

function isConnectionError(err) {
  return err && err.code === 'ECONNREFUSED';
}

function sendValidationError(res, { errorCode, field, message }) {
  return res.status(400).json({
    success: false,
    error_code: errorCode,
    field,
    message,
  });
}

function isValidEmailFormat(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function extractInstagramUsername(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(
    /^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(\?.*)?$/i
  );
  const username = match ? match[2] : trimmed.replace(/^@/, '');
  const normalized = username?.toLowerCase();
  if (!normalized || !/^[a-z0-9._]{1,30}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function extractTiktokUsername(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(
    /^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9._]+)\/?(\?.*)?$/i
  );
  const username = match ? match[2] : trimmed.replace(/^@/, '');
  const normalized = username?.toLowerCase();
  if (!normalized || !/^[a-z0-9._]{1,24}$/.test(normalized)) {
    return null;
  }
  return `@${normalized}`;
}

function isClaimPasswordValid(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasPunctuation = /[^A-Za-z0-9\s]/.test(password);
  return hasLetter && hasDigit && hasPunctuation;
}

const claimPasswordResetMessage =
  'Permintaan reset password tidak valid. Periksa kembali data yang dimasukkan.';
const claimPasswordResetNeutralMessage =
  'Jika data valid dan terdaftar, instruksi reset password akan dikirim melalui kanal yang tersedia.';

function getClaimResetSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET belum diset');
  }
  return process.env.JWT_SECRET;
}

function isSmtpEnabled() {
  const requiredSmtpEnv = [
    process.env.SMTP_HOST,
    process.env.SMTP_PORT,
    process.env.SMTP_USER,
    process.env.SMTP_PASS,
    process.env.SMTP_FROM,
  ];

  return requiredSmtpEnv.every((value) => typeof value === 'string' && value.trim() !== '');
}

function maskEmail(email) {
  const [localPart, domainPart] = String(email || '').split('@');
  if (!localPart || !domainPart) return 'invalid-email';
  const visibleLocal = localPart.length <= 2 ? `${localPart[0] || '*'}*` : `${localPart.slice(0, 2)}***`;
  return `${visibleLocal}@${domainPart}`;
}

function obfuscateNrp(nrp) {
  const text = String(nrp || '');
  if (text.length <= 3) return '***';
  return `${text.slice(0, 2)}***${text.slice(-1)}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function logClaimPasswordReset(payload) {
  console.info(JSON.stringify({ event: 'claim_password_reset_request', ...payload }));
}

function toSocialAccountList(rawValue) {
  if (rawValue === undefined) return undefined;
  if (rawValue === null || rawValue === '') return [];
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === 'string') return [rawValue];
  return null;
}

function normalizeSocialAccounts(rawValue, platform) {
  const list = toSocialAccountList(rawValue);
  if (list === undefined) return undefined;
  if (list === null) return null;

  const extractor = platform === 'instagram' ? extractInstagramUsername : extractTiktokUsername;
  const normalized = [];
  const seen = new Set();

  for (const item of list) {
    if (item === null || item === undefined || item === '') continue;
    const username = extractor(String(item));
    if (!username) return null;
    const dedupeKey = platform === 'tiktok' ? username.replace(/^@/, '') : username;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      normalized.push(username);
    }
  }

  return normalized;
}

function findDuplicateSocialUsername(usernames = [], platform) {
  const seen = new Set();
  for (const username of usernames) {
    const dedupeKey = platform === 'tiktok' ? username.replace(/^@/, '') : username;
    if (seen.has(dedupeKey)) return username;
    seen.add(dedupeKey);
  }
  return null;
}

function findBlockedSocialUsername(usernames = [], platform) {
  for (const username of usernames) {
    const dedupeKey = platform === 'tiktok' ? username.replace(/^@/, '') : username;
    if (dedupeKey === 'cicero_devs') return username;
  }
  return null;
}

async function verifyClaimCredentials(nrp, password) {
  const user = await userModel.findUserById(nrp);
  if (!user || !user.password_hash) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

export async function registerClaimCredentials(req, res, next) {
  try {
    const { nrp: rawNrp, password } = req.body;
    const nrp = normalizeUserId(rawNrp);

    if (!nrp || !password) {
      return res.status(400).json({
        success: false,
        message: 'nrp dan password wajib diisi',
      });
    }

    if (!isClaimPasswordValid(password)) {
      return res.status(400).json({
        success: false,
        message:
          'Password minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.',
      });
    }

    let user;
    try {
      user = await userModel.findUserById(nrp);
    } catch (err) {
      if (isConnectionError(err)) {
        return res.status(503).json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'NRP anda tidak terdaftar' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await userModel.setClaimCredentials(nrp, {
      passwordHash,
    });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'NRP anda tidak terdaftar' });
    }

    sendSuccess(res, {
      message: 'Registrasi kredensial berhasil. Silakan login menggunakan NRP dan password.',
      user_id: updatedUser.user_id,
    });
  } catch (err) {
    next(err);
  }
}

export async function getUserData(req, res, next) {
  try {
    const { nrp: rawNrp, password } = req.body;
    const nrp = normalizeUserId(rawNrp);
    if (!nrp || !password) {
      return res.status(400).json({
        success: false,
        message: 'nrp dan password wajib diisi',
      });
    }

    let user;
    try {
      user = await verifyClaimCredentials(nrp, password);
    } catch (err) {
      if (isConnectionError(err)) {
        return res.status(503).json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'NRP atau password tidak valid',
      });
    }

    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateUserData(req, res, next) {
  try {
    const {
      nrp: rawNrp,
      password,
      nama,
      title,
      divisi,
      jabatan,
      desa,
      insta,
      tiktok,
      instagram_accounts,
      tiktok_accounts,
      whatsapp,
      email,
    } = req.body;
    const nrp = normalizeUserId(rawNrp);
    if (!nrp || !password) {
      return res.status(400).json({
        success: false,
        message: 'nrp dan password wajib diisi',
      });
    }

    let user;
    try {
      user = await verifyClaimCredentials(nrp, password);
    } catch (err) {
      if (isConnectionError(err)) {
        return res.status(503).json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'NRP atau password tidak valid',
      });
    }

    let igUsername;
    if (insta !== undefined) {
      igUsername = extractInstagramUsername(insta);
      if (igUsername === null) {
        return sendValidationError(res, {
          errorCode: validationErrorCodes.invalidInstagramFormat,
          field: 'insta',
          message:
            'Format username Instagram tidak valid. Gunakan tautan profil atau username seperti instagram.com/username atau @username.',
        });
      }
    }

    let ttUsername;
    if (tiktok !== undefined) {
      ttUsername = extractTiktokUsername(tiktok);
      if (ttUsername === null) {
        return sendValidationError(res, {
          errorCode: validationErrorCodes.invalidTiktokFormat,
          field: 'tiktok',
          message:
            'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.',
        });
      }
    }

    const normalizedInstagramAccounts = normalizeSocialAccounts(instagram_accounts, 'instagram');
    if (normalizedInstagramAccounts === null) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.invalidInstagramFormat,
        field: 'instagram_accounts',
        message: 'Format instagram_accounts tidak valid. Isi array username/link Instagram yang valid.',
      });
    }

    const normalizedTiktokAccounts = normalizeSocialAccounts(tiktok_accounts, 'tiktok');
    if (normalizedTiktokAccounts === null) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.invalidTiktokFormat,
        field: 'tiktok_accounts',
        message: 'Format tiktok_accounts tidak valid. Isi array username/link TikTok yang valid.',
      });
    }

    let normalizedWhatsapp;
    if (whatsapp !== undefined) {
      if (whatsapp === null || whatsapp === '') {
        normalizedWhatsapp = '';
      } else {
        const digits = String(whatsapp).replace(/\D/g, '');
        if (digits.length < minPhoneDigitLength) {
          return sendValidationError(res, {
            errorCode: validationErrorCodes.invalidWhatsappFormat,
            field: 'whatsapp',
            message: 'Nomor telepon tidak valid. Masukkan minimal 8 digit angka.',
          });
        }
        normalizedWhatsapp = normalizeWhatsappNumber(whatsapp);
      }
    }

    let normalizedEmail;
    if (email !== undefined) {
      if (email === null || email === '') {
        normalizedEmail = '';
      } else {
        normalizedEmail = normalizeEmail(email);
        if (!isValidEmailFormat(normalizedEmail)) {
          return sendValidationError(res, {
            errorCode: validationErrorCodes.invalidEmailFormat,
            field: 'email',
            message: 'Format email tidak valid.',
          });
        }
      }
    }

    const data = { nama, title, divisi, jabatan, desa };
    if (whatsapp !== undefined) {
      data.whatsapp = normalizedWhatsapp;
    }
    if (email !== undefined) {
      data.email = normalizedEmail;
    }
    if (insta !== undefined) {
      if (igUsername === 'cicero_devs') {
        return sendValidationError(res, {
          errorCode: validationErrorCodes.usernameBlocked,
          field: 'insta',
          message: 'Username cicero_devs tidak diperbolehkan.',
        });
      }
      data.insta = igUsername;
    }
    if (tiktok !== undefined) {
      if (ttUsername && ttUsername.replace(/^@/, '') === 'cicero_devs') {
        return sendValidationError(res, {
          errorCode: validationErrorCodes.usernameBlocked,
          field: 'tiktok',
          message: 'Username cicero_devs tidak diperbolehkan.',
        });
      }
      data.tiktok = ttUsername;
    }

    let instagramAccountsPayload = normalizedInstagramAccounts;
    if (insta !== undefined) {
      instagramAccountsPayload = igUsername ? [igUsername, ...(normalizedInstagramAccounts || [])] : (normalizedInstagramAccounts || []);
    }
    const duplicateInstagramInput = findDuplicateSocialUsername(instagramAccountsPayload, 'instagram');
    const blockedInstagramInput = findBlockedSocialUsername(instagramAccountsPayload, 'instagram');
    if (blockedInstagramInput) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.usernameBlocked,
        field: 'instagram_accounts',
        message: 'Username cicero_devs tidak diperbolehkan.',
      });
    }
    if (duplicateInstagramInput) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.duplicateUsernameInput,
        field: 'instagram_accounts',
        message:
          'Terdeteksi duplikasi username Instagram pada input username 1/2. Gunakan username yang berbeda.',
      });
    }
    if (instagramAccountsPayload?.length && insta === undefined) {
      data.insta = instagramAccountsPayload[0];
    }

    let tiktokAccountsPayload = normalizedTiktokAccounts;
    if (tiktok !== undefined) {
      tiktokAccountsPayload = ttUsername ? [ttUsername, ...(normalizedTiktokAccounts || [])] : (normalizedTiktokAccounts || []);
    }
    const duplicateTiktokInput = findDuplicateSocialUsername(tiktokAccountsPayload, 'tiktok');
    const blockedTiktokInput = findBlockedSocialUsername(tiktokAccountsPayload, 'tiktok');
    if (blockedTiktokInput) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.usernameBlocked,
        field: 'tiktok_accounts',
        message: 'Username cicero_devs tidak diperbolehkan.',
      });
    }
    if (duplicateTiktokInput) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.duplicateUsernameInput,
        field: 'tiktok_accounts',
        message:
          'Terdeteksi duplikasi username TikTok pada input username 1/2. Gunakan username yang berbeda.',
      });
    }
    if (tiktokAccountsPayload?.length && tiktok === undefined) {
      data.tiktok = tiktokAccountsPayload[0];
    }

    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    const updated = await userModel.updateUser(nrp, data);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    if (instagramAccountsPayload !== undefined) {
      const instagramConflict = await userModel.findSocialUsernameConflict(
        nrp,
        'instagram',
        instagramAccountsPayload
      );
      if (instagramConflict) {
        return res.status(409).json({
          success: false,
          error_code: validationErrorCodes.socialUsernameConflict,
          message: 'Username social media sudah digunakan akun lain.',
          conflict: {
            platform: instagramConflict.platform,
            username: instagramConflict.username,
          },
        });
      }
      await userModel.replaceUserSocialAccounts(nrp, 'instagram', instagramAccountsPayload);
    } else if (insta !== undefined) {
      const instagramConflict = await userModel.findSocialUsernameConflict(
        nrp,
        'instagram',
        igUsername ? [igUsername] : []
      );
      if (instagramConflict) {
        return res.status(409).json({
          success: false,
          error_code: validationErrorCodes.socialUsernameConflict,
          message: 'Username social media sudah digunakan akun lain.',
          conflict: {
            platform: instagramConflict.platform,
            username: instagramConflict.username,
          },
        });
      }
      await userModel.replaceUserSocialAccounts(nrp, 'instagram', igUsername ? [igUsername] : []);
    }

    if (tiktokAccountsPayload !== undefined) {
      const tiktokConflict = await userModel.findSocialUsernameConflict(
        nrp,
        'tiktok',
        tiktokAccountsPayload
      );
      if (tiktokConflict) {
        return res.status(409).json({
          success: false,
          error_code: validationErrorCodes.socialUsernameConflict,
          message: 'Username social media sudah digunakan akun lain.',
          conflict: {
            platform: tiktokConflict.platform,
            username: tiktokConflict.username,
          },
        });
      }
      await userModel.replaceUserSocialAccounts(nrp, 'tiktok', tiktokAccountsPayload);
    } else if (tiktok !== undefined) {
      const tiktokConflict = await userModel.findSocialUsernameConflict(
        nrp,
        'tiktok',
        ttUsername ? [ttUsername] : []
      );
      if (tiktokConflict) {
        return res.status(409).json({
          success: false,
          error_code: validationErrorCodes.socialUsernameConflict,
          message: 'Username social media sudah digunakan akun lain.',
          conflict: {
            platform: tiktokConflict.platform,
            username: tiktokConflict.username,
          },
        });
      }
      await userModel.replaceUserSocialAccounts(nrp, 'tiktok', ttUsername ? [ttUsername] : []);
    }

    const userSocialAccounts = await userModel.findUserSocialAccounts(nrp);
    const responseData = {
      ...updated,
      instagram_accounts: userSocialAccounts.instagram,
      tiktok_accounts: userSocialAccounts.tiktok,
    };
    sendSuccess(res, responseData);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Username Instagram/TikTok sudah digunakan akun lain.',
      });
    }
    next(err);
  }
}

export async function requestClaimPasswordReset(req, res, next) {
  try {
    const { nrp: rawNrp, email: rawEmail } = req.body;
    const nrp = normalizeUserId(rawNrp);
    const email = normalizeEmail(rawEmail);
    const smtpEnabled = isSmtpEnabled();

    if (!nrp || !email) {
      return res.status(400).json({
        success: false,
        message: claimPasswordResetMessage,
      });
    }

    let user;
    try {
      user = await userModel.findUserById(nrp);
    } catch (err) {
      if (isConnectionError(err)) {
        return res.status(503).json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    const normalizedUserEmail = normalizeEmail(user?.email || '');
    const accountMatched = Boolean(user && normalizedUserEmail && normalizedUserEmail === email);

    if (accountMatched) {
      const token = jwt.sign(
        {
          type: 'claim_password_reset',
          user_id: user.user_id,
        },
        getClaimResetSecret(),
        { expiresIn: '15m' }
      );
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await claimPasswordResetModel.createResetRequest({
        userId: user.user_id,
        deliveryTarget: email,
        resetToken: token,
        expiresAt,
      });

      if (smtpEnabled) {
        try {
          await sendClaimPasswordResetEmail(email, token, {
            nrp,
            expiryMinutes: 15,
          });
          logClaimPasswordReset({
            outcome: 'delivered_email',
            delivery_channel: 'smtp',
            smtp_enabled: true,
            nrp_masked: obfuscateNrp(nrp),
            email_masked: maskEmail(email),
            token_fingerprint: hashToken(token),
          });
        } catch (err) {
          logClaimPasswordReset({
            outcome: 'email_send_failed_fallback_telegram',
            delivery_channel: 'smtp_to_telegram_fallback',
            smtp_enabled: true,
            nrp_masked: obfuscateNrp(nrp),
            email_masked: maskEmail(email),
            token_fingerprint: hashToken(token),
            error: err?.message || 'unknown_error',
          });
          await sendTelegramAdminMessage(
            `⚠️ CLAIM reset fallback (SMTP gagal)\nNRP: ${nrp}\nEmail: ${email}\nToken: ${token}`
          );
        }
      } else {
        await sendTelegramAdminMessage(
          `⚠️ CLAIM reset manual flow (SMTP nonaktif)\nNRP: ${nrp}\nEmail: ${email}\nToken: ${token}`
        );
        logClaimPasswordReset({
          outcome: 'delivered_admin_telegram',
          delivery_channel: 'telegram_admin',
          smtp_enabled: false,
          nrp_masked: obfuscateNrp(nrp),
          email_masked: maskEmail(email),
          token_fingerprint: hashToken(token),
        });
      }
    } else {
      logClaimPasswordReset({
        outcome: 'account_not_found_or_mismatch',
        delivery_channel: 'none',
        smtp_enabled: smtpEnabled,
        nrp_masked: obfuscateNrp(nrp),
        email_masked: maskEmail(email),
      });
    }

    return sendSuccess(res, {
      message: claimPasswordResetNeutralMessage,
    });
  } catch (err) {
    next(err);
  }
}

export async function confirmClaimPasswordReset(req, res, next) {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'token, password, dan confirmPassword wajib diisi',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password dan konfirmasi password harus sama.',
      });
    }

    if (!isClaimPasswordValid(password)) {
      return res.status(400).json({
        success: false,
        message:
          'Password minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.',
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, getClaimResetSecret());
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
      });
    }

    if (payload?.type !== 'claim_password_reset' || !payload?.user_id) {
      return res.status(400).json({
        success: false,
        message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
      });
    }

    const resetRecord = await claimPasswordResetModel.findActiveByToken(token);
    if (!resetRecord || String(resetRecord.user_id) !== String(payload.user_id)) {
      return res.status(400).json({
        success: false,
        message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await userModel.setClaimCredentials(payload.user_id, { passwordHash });
    if (!updatedUser) {
      return res.status(400).json({
        success: false,
        message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
      });
    }

    await claimPasswordResetModel.markTokenUsed(token);

    return sendSuccess(res, {
      message: 'Password berhasil diperbarui.',
    });
  } catch (err) {
    next(err);
  }
}
