import bcrypt from 'bcrypt';
import * as userModel from '../model/userModel.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeEmail, normalizeUserId } from '../utils/utilsHelper.js';
import { normalizeWhatsappNumber, minPhoneDigitLength } from '../utils/waHelper.js';

function isConnectionError(err) {
  return err && err.code === 'ECONNREFUSED';
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
    if (dedupeKey === 'cicero_devs') return null;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      normalized.push(username);
    }
  }

  return normalized;
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
        return res.status(400).json({
          success: false,
          message:
            'Format username Instagram tidak valid. Gunakan tautan profil atau username seperti instagram.com/username atau @username.',
        });
      }
    }

    let ttUsername;
    if (tiktok !== undefined) {
      ttUsername = extractTiktokUsername(tiktok);
      if (ttUsername === null) {
        return res.status(400).json({
          success: false,
          message:
            'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.',
        });
      }
    }

    const normalizedInstagramAccounts = normalizeSocialAccounts(instagram_accounts, 'instagram');
    if (normalizedInstagramAccounts === null) {
      return res.status(400).json({
        success: false,
        message:
          'Format instagram_accounts tidak valid. Isi array username/link Instagram yang valid.',
      });
    }

    const normalizedTiktokAccounts = normalizeSocialAccounts(tiktok_accounts, 'tiktok');
    if (normalizedTiktokAccounts === null) {
      return res.status(400).json({
        success: false,
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
          return res.status(400).json({
            success: false,
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
          return res.status(400).json({
            success: false,
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
        return res.status(400).json({ success: false, message: 'username instagram tidak valid' });
      }
      data.insta = igUsername;
    }
    if (tiktok !== undefined) {
      if (ttUsername && ttUsername.replace(/^@/, '') === 'cicero_devs') {
        return res.status(400).json({ success: false, message: 'username tiktok tidak valid' });
      }
      data.tiktok = ttUsername;
    }

    let instagramAccountsPayload = normalizedInstagramAccounts;
    if (insta !== undefined) {
      instagramAccountsPayload = igUsername ? [igUsername, ...(normalizedInstagramAccounts || [])] : (normalizedInstagramAccounts || []);
      instagramAccountsPayload = [...new Set(instagramAccountsPayload)];
    }
    if (instagramAccountsPayload?.length && insta === undefined) {
      data.insta = instagramAccountsPayload[0];
    }

    let tiktokAccountsPayload = normalizedTiktokAccounts;
    if (tiktok !== undefined) {
      tiktokAccountsPayload = ttUsername ? [ttUsername, ...(normalizedTiktokAccounts || [])] : (normalizedTiktokAccounts || []);
      const tiktokUniqueMap = new Map();
      for (const username of tiktokAccountsPayload) {
        tiktokUniqueMap.set(username.replace(/^@/, ''), username);
      }
      tiktokAccountsPayload = [...tiktokUniqueMap.values()];
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
      await userModel.replaceUserSocialAccounts(nrp, 'instagram', instagramAccountsPayload);
    } else if (insta !== undefined) {
      await userModel.replaceUserSocialAccounts(nrp, 'instagram', igUsername ? [igUsername] : []);
    }

    if (tiktokAccountsPayload !== undefined) {
      await userModel.replaceUserSocialAccounts(nrp, 'tiktok', tiktokAccountsPayload);
    } else if (tiktok !== undefined) {
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
