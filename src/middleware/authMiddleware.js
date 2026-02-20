// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';

const authLogEvent = 'auth.middleware.denied';
const maxUserAgentLength = 120;
const defaultJwtClockToleranceSeconds = 30;
const defaultExpiredTokenGraceSeconds = 24 * 60 * 60;

const operatorAllowlist = [
  { path: '/clients/profile', type: 'exact' },
  { path: '/aggregator', type: 'prefix' },
  { path: '/amplify/rekap', type: 'exact' },
  { path: '/amplify/rekap-khusus', type: 'exact' },
  { path: '/amplify-khusus/rekap', type: 'exact' },
  { path: '/dashboard/stats', type: 'exact' },
  { path: '/dashboard/login-web/recap', type: 'exact' },
  { path: '/dashboard/social-media/instagram/analysis', type: 'exact' },
  { path: '/dashboard/komplain/insta', type: 'exact' },
  { path: '/dashboard/komplain/tiktok', type: 'exact' },
  { path: '/insta/rekap-likes', type: 'exact' },
  { path: '/likes/instagram', type: 'exact' },
  { path: '/insta/rapid-profile', type: 'exact' },
  { path: '/comments/tiktok', type: 'exact' },
  { path: '/tiktok/rekap-komentar', type: 'exact' },
  { path: '/users', type: 'exact' },
  { path: '/users/create', type: 'exact' },
  { path: '/users/list', type: 'exact' },
];

const operatorMethodAllowlist = [
  { method: 'PUT', pattern: /^\/users\/[^/]+$/ },
  { method: 'POST', pattern: /^\/link-reports$/ },
  { method: 'POST', pattern: /^\/link-reports-khusus$/ },
  { method: 'PUT', pattern: /^\/link-reports\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/link-reports-khusus\/[^/]+$/ },
];

function isOperatorAllowedPath(method, pathname) {
  const isPathAllowed = operatorAllowlist.some(({ path, type }) => {
    if (type === 'prefix') {
      return pathname === path || pathname.startsWith(`${path}/`);
    }
    return pathname === path;
  });
  if (isPathAllowed) {
    return true;
  }
  return operatorMethodAllowlist.some(({ method: allowedMethod, pattern }) => {
    if (allowedMethod !== method) {
      return false;
    }
    return pattern.test(pathname);
  });
}

function summarizeUserAgent(userAgent) {
  if (!userAgent) {
    return 'unknown';
  }
  const normalizedUserAgent = String(userAgent).replace(/\s+/g, ' ').trim();
  if (!normalizedUserAgent) {
    return 'unknown';
  }
  if (normalizedUserAgent.length <= maxUserAgentLength) {
    return normalizedUserAgent;
  }
  return `${normalizedUserAgent.slice(0, maxUserAgentLength - 1)}…`;
}

function getSourceIp(req) {
  const forwardedForHeader = req.headers['x-forwarded-for'];
  if (forwardedForHeader) {
    const [forwardedIp] = String(forwardedForHeader)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const realIpHeader = req.headers['x-real-ip'];
  if (realIpHeader) {
    return String(realIpHeader).trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function logAuthDenied(req, reason, statusCode, message) {
  console.warn(authLogEvent, {
    reason,
    statusCode,
    message,
    method: req.method,
    path: req.originalUrl || req.path,
    sourceIp: getSourceIp(req),
    userAgent: summarizeUserAgent(req.headers['user-agent']),
  });
}

function sendAuthError(res, req, statusCode, message, reason) {
  logAuthDenied(req, reason, statusCode, message);
  return res.status(statusCode).json({ success: false, message, reason });
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

function decodeExpiredTokenWithinGrace(token) {
  const graceSeconds = getNumericEnv(
    'JWT_EXPIRED_GRACE_SECONDS',
    defaultExpiredTokenGraceSeconds,
  );

  if (graceSeconds <= 0) {
    return null;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    ignoreExpiration: true,
  });
  const expiredAt = Number(decoded?.exp);
  if (!Number.isFinite(expiredAt)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - expiredAt > graceSeconds) {
    return null;
  }

  return decoded;
}

export function authRequired(req, res, next) {
  const authorizationHeader = req.headers.authorization;
  if (authorizationHeader && !authorizationHeader.startsWith('Bearer ')) {
    return sendAuthError(res, req, 401, 'Authorization harus format Bearer token', 'invalid_token');
  }

  const token = authorizationHeader?.split(' ')[1] || req.cookies?.token;
  if (!token) {
    return sendAuthError(res, req, 401, 'Token required', 'missing_token');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      clockTolerance: getNumericEnv(
        'JWT_CLOCK_TOLERANCE_SECONDS',
        defaultJwtClockToleranceSeconds,
      ),
    });
    req.user = decoded;
    if (decoded.role === 'operator' && !isOperatorAllowedPath(req.method, req.path)) {
      return sendAuthError(res, req, 403, 'Forbidden', 'forbidden_operator_path');
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      try {
        const graceDecodedToken = decodeExpiredTokenWithinGrace(token);
        if (graceDecodedToken) {
          req.user = graceDecodedToken;
          if (
            graceDecodedToken.role === 'operator' &&
            !isOperatorAllowedPath(req.method, req.path)
          ) {
            return sendAuthError(res, req, 403, 'Forbidden', 'forbidden_operator_path');
          }
          return next();
        }
      } catch (graceError) {
        console.warn('auth.middleware.grace_decode_failed', {
          message: graceError?.message || 'Unknown error',
          method: req.method,
          path: req.originalUrl || req.path,
        });
      }
      return sendAuthError(res, req, 401, 'Token expired', 'expired_token');
    }
    return sendAuthError(res, req, 401, 'Invalid token', 'invalid_token');
  }
}
