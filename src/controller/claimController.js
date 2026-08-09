import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import * as userModel from '../model/userModel.js';
import * as claimPasswordResetModel from '../model/claimPasswordResetModel.js';
import redis from '../config/redis.js';
import {
  sendClaimPasswordResetEmail,
  sendOtpEmail,
} from '../service/emailService.js';
import { sendTelegramAdminMessage } from '../service/telegramService.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeEmail, normalizeUserId } from '../utils/utilsHelper.js';
import {
  normalizeWhatsappNumber,
  minPhoneDigitLength,
} from '../utils/waHelper.js';
import {
  validateDateRange,
  validateTanggalFilter,
} from '../utils/dateFilterValidation.js';
import { getPendingContentForUser } from '../service/claimPendingContentService.js';
import { fetchClaimSocialProfile } from '../service/claimSocialProfileService.js';
import {
  extractInstagramUsername,
  extractTiktokUsername,
} from '../utils/socialUsername.js';

const validationErrorCodes = {
  invalidWhatsappFormat: 'CLAIM_INVALID_WHATSAPP_FORMAT',
  invalidEmailFormat: 'CLAIM_INVALID_EMAIL_FORMAT',
  invalidInstagramFormat: 'CLAIM_INVALID_INSTAGRAM_FORMAT',
  invalidTiktokFormat: 'CLAIM_INVALID_TIKTOK_FORMAT',
  usernameBlocked: 'CLAIM_USERNAME_BLOCKED',
  duplicateUsernameInput: 'CLAIM_DUPLICATE_USERNAME_INPUT',
  socialUsernameConflict: 'CLAIM_SOCIAL_USERNAME_CONFLICT',
};

const pendingContentPeriods = new Set([
  'harian',
  'mingguan',
  'bulanan',
  'semua',
]);

function toPendingContentDto(result) {
  return {
    user_id: result.user_id,
    timezone: result.timezone,
    filters: result.filters,
    instagram: result.instagram,
    tiktok: result.tiktok,
  };
}

export async function getPendingContent(req, res, next) {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error_code: 'CLAIM_AUTH_USER_REQUIRED',
        message: 'Token user tidak valid',
      });
    }

    if (String(req.user?.role || '').toLowerCase() !== 'user') {
      return res.status(403).json({
        success: false,
        error_code: 'CLAIM_USER_ROLE_REQUIRED',
        message: 'Endpoint hanya dapat diakses oleh user',
      });
    }

    const periode = String(req.query.periode || 'harian').toLowerCase();
    const tanggal = req.query.tanggal;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    if (!pendingContentPeriods.has(periode)) {
      return res.status(400).json({
        success: false,
        error_code: 'CLAIM_INVALID_DATE_FILTER',
        message:
          'Parameter periode harus harian, mingguan, bulanan, atau semua',
      });
    }

    const { error: tanggalError } = validateTanggalFilter(tanggal, periode);
    const { error: rangeError } = validateDateRange(startDate, endDate);
    if (tanggalError || rangeError || Boolean(startDate) !== Boolean(endDate)) {
      return res.status(400).json({
        success: false,
        error_code: 'CLAIM_INVALID_DATE_FILTER',
        message:
          tanggalError ||
          rangeError ||
          'Parameter start_date dan end_date harus digunakan bersamaan',
      });
    }

    const result = await getPendingContentForUser(userId, {
      periode,
      tanggal,
      startDate,
      endDate,
    });
    if (!result) {
      return res.status(404).json({
        success: false,
        error_code: 'CLAIM_USER_NOT_FOUND',
        message: 'User tidak ditemukan',
      });
    }

    return sendSuccess(res, toPendingContentDto(result));
  } catch (err) {
    return next(err);
  }
}

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

const claimProfileFields = [
  'user_id',
  'nama',
  'title',
  'divisi',
  'jabatan',
  'desa',
  'client_id',
  'whatsapp',
  'email',
  'insta',
  'tiktok',
  'instagram_accounts',
  'tiktok_accounts',
  'ditbinmas',
  'ditlantas',
  'bidhumas',
  'ditsamapta',
  'ditintelkam',
  'operator',
];

function toClaimProfileDto(user) {
  if (!user) return user;
  return Object.fromEntries(
    claimProfileFields
      .filter((field) => Object.hasOwn(user, field))
      .map((field) => [field, user[field]])
  );
}

function isValidEmailFormat(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

  return requiredSmtpEnv.every(
    (value) => typeof value === 'string' && value.trim() !== ''
  );
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

  const extractor =
    platform === 'instagram' ? extractInstagramUsername : extractTiktokUsername;
  const normalized = [];
  const seen = new Set();

  for (const item of list) {
    if (item === null || item === undefined || item === '') continue;
    const username = extractor(String(item));
    if (!username) return null;
    const dedupeKey =
      platform === 'tiktok' ? username.replace(/^@/, '') : username;
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
    const dedupeKey =
      platform === 'tiktok' ? username.replace(/^@/, '') : username;
    if (seen.has(dedupeKey)) return username;
    seen.add(dedupeKey);
  }
  return null;
}

function findBlockedSocialUsername(usernames = [], platform) {
  for (const username of usernames) {
    const dedupeKey =
      platform === 'tiktok' ? username.replace(/^@/, '') : username;
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
        return res
          .status(503)
          .json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'NRP anda tidak terdaftar' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await userModel.setClaimCredentials(nrp, {
      passwordHash,
    });

    if (!updatedUser) {
      return res
        .status(404)
        .json({ success: false, message: 'NRP anda tidak terdaftar' });
    }

    sendSuccess(res, {
      message:
        'Registrasi kredensial berhasil. Silakan login menggunakan NRP dan password.',
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
        return res
          .status(503)
          .json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'NRP atau password tidak valid',
      });
    }

    const profile = await userModel.findClaimProfileById(nrp);
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: 'User tidak ditemukan' });
    }

    sendSuccess(res, toClaimProfileDto(profile));
  } catch (err) {
    next(err);
  }
}

export async function getClaimMe(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error_code: 'CLAIM_AUTH_USER_REQUIRED',
        message: 'Token user tidak valid',
      });
    }

    const user = await userModel.findClaimProfileById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User tidak ditemukan' });
    }

    const socialAccounts = await userModel.findUserSocialAccounts(userId);
    return sendSuccess(res, {
      ...toClaimProfileDto(user),
      instagram_accounts: socialAccounts.instagram,
      tiktok_accounts: socialAccounts.tiktok,
    });
  } catch (err) {
    return next(err);
  }
}

async function updateClaimUser(req, res, next, authenticatedUserId = null) {
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
    const nrp = normalizeUserId(authenticatedUserId || rawNrp);
    if (!nrp || (!authenticatedUserId && !password)) {
      return res.status(400).json({
        success: false,
        message: authenticatedUserId
          ? 'Identitas token tidak valid'
          : 'nrp dan password wajib diisi',
      });
    }

    if (!authenticatedUserId) {
      let user;
      try {
        user = await verifyClaimCredentials(nrp, password);
      } catch (err) {
        if (isConnectionError(err)) {
          return res
            .status(503)
            .json({ success: false, message: 'Database tidak tersedia' });
        }
        throw err;
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'NRP atau password tidak valid',
        });
      }
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

    const normalizedInstagramAccounts = normalizeSocialAccounts(
      instagram_accounts,
      'instagram'
    );
    if (normalizedInstagramAccounts === null) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.invalidInstagramFormat,
        field: 'instagram_accounts',
        message:
          'Format instagram_accounts tidak valid. Isi array username/link Instagram yang valid.',
      });
    }

    const normalizedTiktokAccounts = normalizeSocialAccounts(
      tiktok_accounts,
      'tiktok'
    );
    if (normalizedTiktokAccounts === null) {
      return sendValidationError(res, {
        errorCode: validationErrorCodes.invalidTiktokFormat,
        field: 'tiktok_accounts',
        message:
          'Format tiktok_accounts tidak valid. Isi array username/link TikTok yang valid.',
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
            message:
              'Nomor telepon tidak valid. Masukkan minimal 8 digit angka.',
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
      instagramAccountsPayload = igUsername
        ? [igUsername, ...(normalizedInstagramAccounts || [])]
        : normalizedInstagramAccounts || [];
    }
    const duplicateInstagramInput = findDuplicateSocialUsername(
      instagramAccountsPayload,
      'instagram'
    );
    const blockedInstagramInput = findBlockedSocialUsername(
      instagramAccountsPayload,
      'instagram'
    );
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
      tiktokAccountsPayload = ttUsername
        ? [ttUsername, ...(normalizedTiktokAccounts || [])]
        : normalizedTiktokAccounts || [];
    }
    const duplicateTiktokInput = findDuplicateSocialUsername(
      tiktokAccountsPayload,
      'tiktok'
    );
    const blockedTiktokInput = findBlockedSocialUsername(
      tiktokAccountsPayload,
      'tiktok'
    );
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

    const socialAccountUpdates = [
      {
        platform: 'instagram',
        usernames: instagramAccountsPayload,
      },
      {
        platform: 'tiktok',
        usernames: tiktokAccountsPayload,
      },
    ];
    for (const { platform, usernames } of socialAccountUpdates) {
      if (usernames === undefined) continue;
      const conflict = await userModel.findSocialUsernameConflict(
        nrp,
        platform,
        usernames
      );
      if (conflict) {
        return res.status(409).json({
          success: false,
          error_code: validationErrorCodes.socialUsernameConflict,
          message: 'Username social media sudah digunakan akun lain.',
          conflict: {
            platform: conflict.platform,
            username: conflict.username,
          },
        });
      }
    }

    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    const updated = await userModel.updateUser(nrp, data);
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'User tidak ditemukan' });
    }

    if (instagramAccountsPayload !== undefined) {
      await userModel.replaceUserSocialAccounts(
        nrp,
        'instagram',
        instagramAccountsPayload
      );
    } else if (insta !== undefined) {
      await userModel.replaceUserSocialAccounts(
        nrp,
        'instagram',
        igUsername ? [igUsername] : []
      );
    }

    if (tiktokAccountsPayload !== undefined) {
      await userModel.replaceUserSocialAccounts(
        nrp,
        'tiktok',
        tiktokAccountsPayload
      );
    } else if (tiktok !== undefined) {
      await userModel.replaceUserSocialAccounts(
        nrp,
        'tiktok',
        ttUsername ? [ttUsername] : []
      );
    }

    const userSocialAccounts = await userModel.findUserSocialAccounts(nrp);
    const responseData = {
      ...toClaimProfileDto(updated),
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

export async function updateUserData(req, res, next) {
  return updateClaimUser(req, res, next);
}

export async function updateClaimMe(req, res, next) {
  const userId = normalizeUserId(req.user?.user_id);
  if (!userId) {
    return res.status(401).json({
      success: false,
      error_code: 'CLAIM_AUTH_USER_REQUIRED',
      message: 'Token user tidak valid',
    });
  }
  return updateClaimUser(req, res, next, userId);
}

export async function validateClaimSocialProfile(req, res) {
  const platform = String(req.body?.platform || '')
    .trim()
    .toLowerCase();
  if (!['instagram', 'tiktok'].includes(platform)) {
    return res.status(400).json({
      success: false,
      error_code: 'CLAIM_SOCIAL_PLATFORM_INVALID',
      message: 'Platform harus instagram atau tiktok.',
    });
  }

  const normalize =
    platform === 'instagram' ? extractInstagramUsername : extractTiktokUsername;
  const username = normalize(req.body?.username);
  if (!username) {
    return res.status(400).json({
      success: false,
      error_code: 'CLAIM_SOCIAL_USERNAME_INVALID',
      message: 'Format username tidak valid.',
    });
  }

  try {
    return sendSuccess(res, await fetchClaimSocialProfile(platform, username));
  } catch (error) {
    const responses = {
      not_found: [
        404,
        'CLAIM_SOCIAL_PROFILE_NOT_FOUND',
        'Akun tidak ditemukan.',
      ],
      rate_limited: [
        429,
        'CLAIM_SOCIAL_UPSTREAM_RATE_LIMITED',
        'Kuota validasi sementara penuh. Coba lagi nanti.',
      ],
      configuration_unavailable: [
        503,
        'CLAIM_SOCIAL_CONFIGURATION_UNAVAILABLE',
        'Layanan validasi belum dikonfigurasi.',
      ],
      upstream_unavailable: [
        502,
        'CLAIM_SOCIAL_UPSTREAM_UNAVAILABLE',
        'Layanan validasi profil sedang terganggu.',
      ],
    };
    const [status, errorCode, message] =
      responses[error?.code] || responses.upstream_unavailable;
    return res.status(status).json({
      success: false,
      error_code: errorCode,
      message,
    });
  }
}

export async function requestClaimPasswordReset(req, res, next) {
  try {
    const { nrp: rawNrp, email: rawEmail } = req.body || {};
    const nrp = normalizeUserId(rawNrp);
    const inputEmail = normalizeEmail(rawEmail || '');
    const smtpEnabled = isSmtpEnabled();

    if (!nrp) {
      return res
        .status(400)
        .json({ success: false, message: claimPasswordResetMessage });
    }

    let user;
    try {
      user = await userModel.findUserById(nrp);
    } catch (err) {
      if (isConnectionError(err)) {
        return res
          .status(503)
          .json({ success: false, message: 'Database tidak tersedia' });
      }
      throw err;
    }

    if (!user) {
      return sendSuccess(res, { message: claimPasswordResetNeutralMessage });
    }

    if (!smtpEnabled) {
      return res.status(503).json({
        success: false,
        message:
          'Layanan email OTP sedang tidak tersedia. Silakan hubungi admin.',
      });
    }

    const existingEmail = normalizeEmail(user?.email || '');
    const hasRegisteredEmail = Boolean(
      existingEmail && isValidEmailFormat(existingEmail)
    );

    if (
      !hasRegisteredEmail &&
      (!inputEmail || !isValidEmailFormat(inputEmail))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Email aktif wajib diisi dengan format yang valid.',
        requires_email: true,
      });
    }

    const deliveryTarget = hasRegisteredEmail ? existingEmail : inputEmail;

    const cooldownKey = `claim_reset_req_cooldown:${nrp}`;
    const cooldownExists = await redis.get(cooldownKey);
    if (cooldownExists) {
      const ttl = await redis.ttl(cooldownKey);
      return res.status(429).json({
        success: false,
        message: 'Permintaan OTP terlalu sering. Coba beberapa saat lagi.',
        retry_after_seconds:
          ttl > 0 ? ttl : CLAIM_RESET_REQUEST_COOLDOWN_SECONDS,
      });
    }

    const requestId = uuidv4();
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    await redis.set(
      `claim_reset_otp:${requestId}`,
      JSON.stringify({
        user_id: user.user_id,
        channel: 'email',
        delivery_target: deliveryTarget,
        otp_hash: otpHash,
        failed_attempts: 0,
        pending_email: hasRegisteredEmail ? null : inputEmail,
      }),
      { EX: CLAIM_RESET_OTP_TTL_SECONDS }
    );
    await redis.set(cooldownKey, '1', {
      EX: CLAIM_RESET_REQUEST_COOLDOWN_SECONDS,
    });

    await sendOtpEmail(deliveryTarget, otp);

    const message = hasRegisteredEmail
      ? inputEmail && inputEmail !== existingEmail
        ? `NRP Anda terhubung dengan email ${existingEmail}. OTP dikirim ke email tersebut.`
        : `OTP berhasil dikirim ke email ${existingEmail}.`
      : `Email pada NRP belum terdaftar. OTP dikirim ke ${inputEmail}. Setelah verifikasi, email ini akan ditautkan.`;

    return sendSuccess(res, {
      message,
      request_id: requestId,
      delivery_channel: 'email',
      email: deliveryTarget,
      has_registered_email: hasRegisteredEmail,
      otp_ttl_seconds: CLAIM_RESET_OTP_TTL_SECONDS,
    });
  } catch (err) {
    await sendTelegramAdminMessage(
      `⚠️ CLAIM reset OTP gagal dikirim: ${err?.message || 'unknown_error'}`
    );
    next(err);
  }
}

export async function verifyClaimPasswordResetOtp(req, res, next) {
  try {
    const { request_id, otp } = req.body || {};
    if (!request_id || !otp) {
      return res
        .status(400)
        .json({ success: false, message: 'request_id dan otp wajib diisi' });
    }

    const raw = await redis.get(`claim_reset_otp:${request_id}`);
    if (!raw) {
      return res
        .status(400)
        .json({
          success: false,
          message: 'OTP tidak valid atau sudah kedaluwarsa.',
        });
    }

    const payload = JSON.parse(raw);
    const otpHash = crypto
      .createHash('sha256')
      .update(String(otp))
      .digest('hex');
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
      return res
        .status(400)
        .json({
          success: false,
          message: 'OTP tidak valid atau sudah kedaluwarsa.',
        });
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

    if (payload?.pending_email && isValidEmailFormat(payload.pending_email)) {
      await userModel.updateUserField(
        payload.user_id,
        'email',
        payload.pending_email
      );
    }

    const resetBaseUrl = (
      process.env.CLAIM_PASSWORD_RESET_URL ||
      process.env.DASHBOARD_PASSWORD_RESET_URL ||
      ''
    ).trim();
    await sendClaimPasswordResetEmail(payload.delivery_target, token, {
      nrp: payload.user_id,
      expiryMinutes: 15,
      resetBaseUrl,
    });

    return sendSuccess(res, {
      message: 'OTP valid. Link ganti password sudah dikirim ke email Anda.',
      reset_token: token,
      reset_link: resetBaseUrl
        ? `${resetBaseUrl.replace(/\/$/, '')}?token=${encodeURIComponent(token)}`
        : null,
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
    if (
      !resetRecord ||
      String(resetRecord.user_id) !== String(payload.user_id)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await userModel.setClaimCredentials(payload.user_id, {
      passwordHash,
    });
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
