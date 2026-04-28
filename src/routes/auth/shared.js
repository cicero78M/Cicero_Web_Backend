import { env } from '../../config/env.js';
import redis from '../../config/redis.js';
import { normalizeWhatsappNumber } from '../../utils/waHelper.js';

export const RESET_TOKEN_EXPIRY_MINUTES = Number(
  process.env.DASHBOARD_RESET_TOKEN_EXPIRY_MINUTES || 15,
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
                `[AUTH] Gagal menghapus token login ${token}: ${err.message}`,
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

const cookieSameSite = ['lax', 'strict', 'none'].includes(env.AUTH_COOKIE_SAME_SITE.toLowerCase())
  ? env.AUTH_COOKIE_SAME_SITE.toLowerCase()
  : 'lax';

const requestedCookieSecure = ['true', '1', 'yes'].includes(String(env.AUTH_COOKIE_SECURE).toLowerCase());
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const cookieSecure = isProduction || cookieSameSite === 'none' ? true : requestedCookieSecure;

export const cookieOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  maxAge: 2 * 60 * 60 * 1000,
  secure: cookieSecure,
};

if (env.AUTH_COOKIE_DOMAIN) {
  cookieOptions.domain = env.AUTH_COOKIE_DOMAIN;
}
