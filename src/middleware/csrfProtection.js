const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function createCsrfProtection(allowedOrigins = []) {
  const normalizedAllowedOrigins = new Set(
    allowedOrigins.map(normalizeOrigin).filter(Boolean),
  );

  return function csrfProtection(req, res, next) {
    if (!unsafeMethods.has(req.method)) return next();

    // Bearer authentication is not attached automatically by browsers.
    if (req.headers.authorization?.startsWith('Bearer ')) return next();

    // Let the authentication middleware handle anonymous requests.
    if (!req.cookies?.token && !req.cookies?.admin_system_token) return next();

    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (fetchSite === 'cross-site') {
      return res.status(403).json({
        success: false,
        message: 'Cross-site request ditolak',
      });
    }

    const requestOrigin = normalizeOrigin(req.headers.origin || '');
    if (requestOrigin && !normalizedAllowedOrigins.has(requestOrigin)) {
      return res.status(403).json({
        success: false,
        message: 'Origin request tidak diizinkan',
      });
    }

    return next();
  };
}
