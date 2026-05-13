import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import * as userModel from '../model/userModel.js';
import * as claimPasswordResetModel from '../model/claimPasswordResetModel.js';
import redis from '../config/redis.js';
import { sendOtpEmail } from '../service/emailService.js';
import { sendTelegramAdminMessage, sendTelegramMessage } from '../service/telegramService.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeEmail, normalizeUserId } from '../utils/utilsHelper.js';
import {
  normalizeWhatsappNumber,
  minPhoneDigitLength,
  formatToWhatsAppId,
  safeSendMessage,
} from '../utils/waHelper.js';

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
const CLAIM_RESET_OTP_TTL_SECONDS = 10 * 60;
const CLAIM_RESET_OTP_MAX_ATTEMPTS = 5;
const CLAIM_RESET_REQUEST_COOLDOWN_SECONDS = 45;

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
    const { nrp: rawNrp, channel: rawChannel, destination: rawDestination } = req.body || {};
    const nrp = normalizeUserId(rawNrp);
    const channel = String(rawChannel || '').trim().toLowerCase();
    const destination = String(rawDestination || '').trim();
    const smtpEnabled = isSmtpEnabled();

    if (!nrp) {
      return res.status(400).json({ success: false, message: claimPasswordResetMessage });
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
      return sendSuccess(res, { message: claimPasswordResetNeutralMessage });
    }

    const hasWhatsapp = Boolean(normalizeWhatsappNumber(user?.whatsapp || ''));
    const hasEmail = Boolean(smtpEnabled && normalizeEmail(user?.email || ''));
    const hasTelegram = Boolean(String(user?.telegram_chat_id || '').trim());
    const availableChannels = [];
    if (hasWhatsapp) availableChannels.push('whatsapp');
    if (hasEmail) availableChannels.push('email');
    if (hasTelegram) availableChannels.push('telegram');

    const allowedChannels = new Set(['whatsapp', 'email', 'telegram']);
    const selectedChannel =
      channel || (hasWhatsapp ? 'whatsapp' : hasEmail ? 'email' : hasTelegram ? 'telegram' : '');

    if (selectedChannel && !allowedChannels.has(selectedChannel)) {
      return res.status(400).json({
        success: false,
        message: 'Kanal pengiriman OTP tidak dikenali.',
        available_channels: ['whatsapp', 'email', 'telegram'],
      });
    }

    if (!selectedChannel) {
      return res.status(400).json({
        success: false,
        message: 'Kontak belum tersedia. Pilih kanal pengiriman OTP dan isi tujuan pengiriman.',
        requires_destination: true,
        available_channels: ['whatsapp', 'email', 'telegram'],
      });
    }

    let deliveryTarget = '';
    if (selectedChannel === 'whatsapp') {
      deliveryTarget = normalizeWhatsappNumber(destination || user?.whatsapp || '') || '';
      if (deliveryTarget && deliveryTarget.length < minPhoneDigitLength) {
        deliveryTarget = '';
      }
    } else if (selectedChannel === 'email') {
      deliveryTarget = normalizeEmail(destination || user?.email || '') || '';
      if (deliveryTarget && !isValidEmailFormat(deliveryTarget)) {
        deliveryTarget = '';
      }
    } else if (selectedChannel === 'telegram') {
      deliveryTarget = String(destination || user?.telegram_chat_id || '').trim();
    }

    if (!deliveryTarget) {
      return res.status(400).json({
        success: false,
        message: 'Tujuan pengiriman OTP tidak valid untuk kanal yang dipilih.',
        requires_destination: true,
        available_channels: availableChannels.length ? availableChannels : ['whatsapp', 'email', 'telegram'],
      });
    }

    const cooldownKey = `claim_reset_req_cooldown:${nrp}`;
    const cooldownExists = await redis.get(cooldownKey);
    if (cooldownExists) {
      const ttl = await redis.ttl(cooldownKey);
      return res.status(429).json({
        success: false,
        message: 'Permintaan OTP terlalu sering. Coba beberapa saat lagi.',
        retry_after_seconds: ttl > 0 ? ttl : CLAIM_RESET_REQUEST_COOLDOWN_SECONDS,
      });
    }

    const requestId = uuidv4();
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    await redis.set(
      `claim_reset_otp:${requestId}`,
      JSON.stringify({
        user_id: user.user_id,
        channel: selectedChannel,
        delivery_target: deliveryTarget,
        otp_hash: otpHash,
        failed_attempts: 0,
      }),
      { EX: CLAIM_RESET_OTP_TTL_SECONDS }
    );
    await redis.set(cooldownKey, '1', { EX: CLAIM_RESET_REQUEST_COOLDOWN_SECONDS });

    const otpMessage = `Kode OTP reset password CICERO Anda: ${otp}. Berlaku 10 menit.`;
    let deliveredChannel = selectedChannel;

    if (selectedChannel === 'email') {
      await sendOtpEmail(deliveryTarget, otp);
    } else if (selectedChannel === 'telegram') {
      await sendTelegramMessage(deliveryTarget, otpMessage);
    } else if (selectedChannel === 'whatsapp') {
      const waClient = globalThis?.waClient;
      const target = formatToWhatsAppId(deliveryTarget);
      const sent = await safeSendMessage(waClient, target, otpMessage);
      if (!sent) {
        if (hasEmail) {
          await sendOtpEmail(normalizeEmail(user?.email || ''), otp);
          deliveredChannel = 'email';
        } else if (hasTelegram) {
          await sendTelegramMessage(String(user?.telegram_chat_id), otpMessage);
          deliveredChannel = 'telegram';
        } else {
          throw new Error('Pengiriman OTP WhatsApp gagal');
        }
      }
    }

    return sendSuccess(res, {
      message: `OTP berhasil dikirim melalui ${deliveredChannel}.`,
      request_id: requestId,
      delivery_channel: deliveredChannel,
      available_channels: availableChannels,
      otp_ttl_seconds: CLAIM_RESET_OTP_TTL_SECONDS,
    });
  } catch (err) {
    await sendTelegramAdminMessage(`⚠️ CLAIM reset OTP gagal dikirim: ${err?.message || 'unknown_error'}`);
    next(err);
  }
}

export async function verifyClaimPasswordResetOtp(req, res, next) {
  try {
    const { request_id, otp } = req.body || {};
    if (!request_id || !otp) {
      return res.status(400).json({ success: false, message: 'request_id dan otp wajib diisi' });
    }

    const raw = await redis.get(`claim_reset_otp:${request_id}`);
    if (!raw) {
      return res.status(400).json({ success: false, message: 'OTP tidak valid atau sudah kedaluwarsa.' });
    }

    const payload = JSON.parse(raw);
    const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    if (payload.otp_hash !== otpHash) {
      const nextFailed = Number(payload.failed_attempts || 0) + 1;
      if (nextFailed >= CLAIM_RESET_OTP_MAX_ATTEMPTS) {
        await redis.del(`claim_reset_otp:${request_id}`);
      } else {
        const ttl = await redis.ttl(`claim_reset_otp:${request_id}`);
        await redis.set(
          `claim_reset_otp:${request_id}`,
          JSON.stringify({ ...payload, failed_attempts: nextFailed }),
          { EX: ttl > 0 ? ttl : CLAIM_RESET_OTP_TTL_SECONDS }
        );
      }
      return res.status(400).json({ success: false, message: 'OTP tidak valid atau sudah kedaluwarsa.' });
    }

    await redis.del(`claim_reset_otp:${request_id}`);

    const token = jwt.sign(
      { type: 'claim_password_reset', user_id: payload.user_id },
      getClaimResetSecret(),
      { expiresIn: '15m' }
    );
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await claimPasswordResetModel.createResetRequest({
      userId: payload.user_id,
      deliveryTarget: payload.delivery_target,
      resetToken: token,
      expiresAt,
    });

    return sendSuccess(res, {
      message: 'OTP valid. Silakan buat password baru.',
      reset_token: token,
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
