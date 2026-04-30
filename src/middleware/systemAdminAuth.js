import jwt from 'jsonwebtoken';
import redis from '../config/redis.js';

const jwtAllowedAlgorithms = ['HS256'];

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  return (
    req.cookies?.token ||
    (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader)
  );
}

export async function verifySystemAdminToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: jwtAllowedAlgorithms });
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  if (payload?.role !== 'system_admin' || !payload?.telegram_chat_id) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  let exists;
  try {
    exists = await redis.get(`login_token:${token}`);
  } catch (err) {
    console.error('[AUTH] Redis unavailable in verifySystemAdminToken:', err);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  if (!exists || !String(exists).startsWith('admin:')) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  req.systemAdmin = {
    telegram_chat_id: String(payload.telegram_chat_id),
    role: payload.role,
    admin_role: payload.admin_role || 'super_admin',
    scope: payload.scope || ['management:funds:read'],
    session_id: payload.session_id,
  };

  return next();
}

export function requireSystemAdminRoles(...allowedRoles) {
  return (req, res, next) => {
    const currentRole = req?.systemAdmin?.admin_role;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin role untuk aksi ini',
      });
    }
    return next();
  };
}
