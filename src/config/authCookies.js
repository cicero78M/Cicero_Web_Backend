export const AUTH_COOKIE_NAMES = Object.freeze({
  dashboard: 'cicero_dashboard_session',
  reposter: 'cicero_reposter_session',
  penmas: 'cicero_penmas_session',
  client: 'cicero_client_session',
  legacy: 'token',
});

export const AUTH_SCOPE_HEADER = 'x-cicero-auth-scope';

const supportedScopes = new Set(['dashboard', 'reposter', 'penmas', 'client']);

export function getRequestedAuthScope(req, fallback = null) {
  const rawScope = String(req.headers?.[AUTH_SCOPE_HEADER] || '')
    .trim()
    .toLowerCase();
  return supportedScopes.has(rawScope) ? rawScope : fallback;
}

export function getBearerToken(req) {
  const authorization = req.headers?.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

export function getCookieToken(req, scope = null) {
  const cookies = req.cookies || {};
  if (scope && AUTH_COOKIE_NAMES[scope]) {
    return cookies[AUTH_COOKIE_NAMES[scope]] || cookies[AUTH_COOKIE_NAMES.legacy] || null;
  }

  return (
    cookies[AUTH_COOKIE_NAMES.dashboard] ||
    cookies[AUTH_COOKIE_NAMES.reposter] ||
    cookies[AUTH_COOKIE_NAMES.penmas] ||
    cookies[AUTH_COOKIE_NAMES.client] ||
    cookies[AUTH_COOKIE_NAMES.legacy] ||
    null
  );
}

export function getAuthToken(req, fallbackScope = null) {
  return getBearerToken(req) || getCookieToken(req, getRequestedAuthScope(req, fallbackScope));
}

export function hasAuthCookie(req) {
  const cookies = req.cookies || {};
  return Object.values(AUTH_COOKIE_NAMES).some((cookieName) => Boolean(cookies[cookieName]));
}
