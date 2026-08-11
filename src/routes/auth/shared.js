import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import redis from '../../config/redis.js';
import { normalizeWhatsappNumber } from '../../utils/waHelper.js';

export const RESET_TOKEN_EXPIRY_MINUTES = Number(
  process.env.DASHBOARD_RESET_TOKEN_EXPIRY_MINUTES || 15,
);

export const AUTH_TOKEN_LIFETIME_SECONDS = Number(
  process.env.AUTH_TOKEN_LIFETIME_SECONDS || 2 * 60 * 60,
);

export const DEFAULT_RESET_BASE_URL = 'https://papiqo.com';

export function buildWhatsappVariants(phoneNumber) {
  const normalized = normalizeWhatsappNumber(phoneNumber);
  if (!normalized) return new Set();

  const variants = new Set([normalized]);
  if (normalized.startsWith('62')) {
    variants.add(`0${normalized.slice(2)}`);
  }
  if (normalized.startsWith('0')) {
    variants.add(`62${normalized.slice(1)}`);
  }
  return variants;
}

export function isSameWhatsappContact(a, b) {
  const variantsA = buildWhatsappVariants(a);
  const variantsB = buildWhatsappVariants(b);
  if (variantsA.size === 0 || variantsB.size === 0) return false;
  for (const value of variantsA) {
    if (variantsB.has(value)) return true;
  }
  return false;
}

export function buildResetMessage({ username, token }) {
  const configuredBaseUrl =
    process.env.DASHBOARD_PASSWORD_RESET_URL || process.env.DASHBOARD_URL;
  const resetBaseUrl = configuredBaseUrl || DEFAULT_RESET_BASE_URL;
  const header = '🔐 Reset Password Dashboard';
  const baseUrlWithoutTrailingSlash = resetBaseUrl.replace(/\/$/, '');
  const baseResetPath = baseUrlWithoutTrailingSlash.endsWith('/reset-password')
    ? baseUrlWithoutTrailingSlash
    : `${baseUrlWithoutTrailingSlash}/reset-password`;
  const url = `${baseResetPath}?token=${token}`;
  const instruction =
    `Username: ${username}\nToken: ${token}\nToken berlaku selama ${RESET_TOKEN_EXPIRY_MINUTES} menit. Dengan url ${baseResetPath}`;
  return `${header}\n\nSilakan buka tautan berikut untuk mengatur ulang password Anda:\n${url}\n\n${instruction}`;
}

export async function clearSessions(userId, keyPrefix) {
  const sessionKey = `${keyPrefix}:${userId}`;
  try {
    if (typeof redis.sMembers === 'function') {
      const tokens = await redis.sMembers(sessionKey);
      if (Array.isArray(tokens) && tokens.length > 0) {
        await Promise.all(
          tokens.map((token) =>
            redis.del(`login_token:${token}`).catch((err) =>
              console.error(
                `[AUTH] Gagal menghapus token login: ${err.message}`,
              ),
            ),
          ),
        );
      }
    }
    if (typeof redis.del === 'function') {
      await redis.del(sessionKey);
    }
  } catch (err) {
    console.error(
      `[AUTH] Gagal menghapus sesi ${keyPrefix} ${userId}: ${err.message}`,
    );
  }
}

export function clearDashboardSessions(dashboardUserId) {
  return clearSessions(dashboardUserId, 'dashboard_login');
}

export function clearPenmasSessions(userId) {
  return clearSessions(userId, 'penmas_login');
}

export function clearClientSessions(clientId) {
  return clearSessions(clientId, 'login');
}

export function clearUserSessions(userId) {
  return clearSessions(userId, 'user_login');
}

function getNumericEnv(name, fallbackValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallbackValue;
  }
  const parsedValue = Number(rawValue);
  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallbackValue;
  }
  return parsedValue;
}

export function getAuthSessionTtlSeconds() {
  return AUTH_TOKEN_LIFETIME_SECONDS + getNumericEnv('JWT_EXPIRED_GRACE_SECONDS', 0);
}

export async function registerSession({ sessionKey, token, tokenOwner }) {
  const tokenKey = `login_token:${token}`;

  try {
    await redis.sAdd(sessionKey, token);
    await redis.set(tokenKey, tokenOwner, {
      EX: getAuthSessionTtlSeconds(),
    });
  } catch (error) {
    const cleanupResults = await Promise.allSettled([
      redis.sRem(sessionKey, token),
      redis.del(tokenKey),
    ]);
    if (cleanupResults.some((result) => result.status === 'rejected')) {
      console.error('[AUTH] Gagal membersihkan registrasi sesi parsial');
    }
    throw error;
  }
}

export function sendSessionUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: 'Layanan autentikasi sementara tidak tersedia',
  });
}

function inferSessionKeyFromDecodedToken(decodedToken) {
  if (!decodedToken || typeof decodedToken !== 'object') {
    return null;
  }
  if (decodedToken.dashboard_user_id) {
    return `dashboard_login:${decodedToken.dashboard_user_id}`;
  }
  if (decodedToken.user_id && decodedToken.role === 'user') {
    return `user_login:${decodedToken.user_id}`;
  }
  if (decodedToken.user_id) {
    return `penmas_login:${decodedToken.user_id}`;
  }
  if (decodedToken.client_id) {
    return `login:${decodedToken.client_id}`;
  }
  return null;
}

export async function revokeSessionToken(token) {
  if (!token) return;

  let tokenOwner = null;
  try {
    tokenOwner = await redis.get(`login_token:${token}`);
  } catch (err) {
    console.error(`[AUTH] Gagal membaca token login: ${err.message}`);
  }

  const cleanupTargets = [];
  if (typeof tokenOwner === 'string' && tokenOwner) {
    if (tokenOwner.startsWith('dashboard:')) {
      cleanupTargets.push(`dashboard_login:${tokenOwner.slice('dashboard:'.length)}`);
    } else if (tokenOwner.startsWith('penmas:')) {
      cleanupTargets.push(`penmas_login:${tokenOwner.slice('penmas:'.length)}`);
    } else if (tokenOwner.startsWith('user:')) {
      cleanupTargets.push(`user_login:${tokenOwner.slice('user:'.length)}`);
    } else if (!tokenOwner.includes(':')) {
      cleanupTargets.push(`login:${tokenOwner}`);
    }
  }

  if (cleanupTargets.length === 0) {
    try {
      const decodedToken = jwt.verify(token, process.env.JWT_SECRET, {
        ignoreExpiration: true,
        algorithms: ['HS256'],
      });
      const inferredKey = inferSessionKeyFromDecodedToken(decodedToken);
      if (inferredKey) {
        cleanupTargets.push(inferredKey);
      }
    } catch {
      // Ignore decode failures so logout stays idempotent.
    }
  }

  try {
    await Promise.all([
      ...cleanupTargets.map((sessionKey) =>
        redis.sRem(sessionKey, token).catch((err) =>
          console.error(
            `[AUTH] Gagal menghapus token dari sesi: ${err.message}`,
          ),
        ),
      ),
      redis.del(`login_token:${token}`),
    ]);
  } catch (err) {
    console.error(`[AUTH] Gagal mencabut token login: ${err.message}`);
  }
}

const cookieSameSite = ['lax', 'strict', 'none'].includes(env.AUTH_COOKIE_SAME_SITE.toLowerCase())
  ? env.AUTH_COOKIE_SAME_SITE.toLowerCase()
  : 'lax';

const requestedCookieSecure = ['true', '1', 'yes'].includes(String(env.AUTH_COOKIE_SECURE).toLowerCase());
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const cookieSecure = isProduction || cookieSameSite === 'none' ? true : requestedCookieSecure;

export const cookieOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  maxAge: AUTH_TOKEN_LIFETIME_SECONDS * 1000,
  secure: cookieSecure,
};

if (env.AUTH_COOKIE_DOMAIN) {
  cookieOptions.domain = env.AUTH_COOKIE_DOMAIN;
}

export function clearAuthCookie(res) {
  res.clearCookie('token', {
    ...cookieOptions,
    maxAge: undefined,
  });
}
