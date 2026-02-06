import jwt from 'jsonwebtoken';
import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { query } from '../repository/db.js';
import redis from '../config/redis.js';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  return (
    req.cookies?.token ||
    (authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : authHeader)
  );
}

function normalizeClientIds(clientIds) {
  if (!Array.isArray(clientIds)) {
    return [];
  }
  return clientIds.filter(id => id != null && String(id).trim() !== '');
}

async function resolveDashboardRole(dashboardUser) {
  let roleName = dashboardUser.role;
  const clientIds = dashboardUser.client_ids || [];

  if (clientIds.length === 1) {
    const [singleClientId] = clientIds;
    const { rows } = await query('SELECT client_type FROM clients WHERE client_id = $1', [
      singleClientId,
    ]);
    if (rows[0]?.client_type?.toLowerCase() === 'direktorat') {
      roleName = String(singleClientId).toLowerCase();
    }
  }

  return roleName;
}

export async function verifyDashboardToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const exists = await redis.get(`login_token:${token}`);
    if (!exists) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    if (!String(exists).startsWith('dashboard:')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const dashboardUserId = payload.dashboard_user_id;
    if (!dashboardUserId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const dashboardUser = await dashboardUserModel.findById(dashboardUserId);
    if (!dashboardUser || !dashboardUser.status) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const clientIds = normalizeClientIds(dashboardUser.client_ids);
    if (clientIds.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Operator belum memiliki klien yang diizinkan',
      });
    }

    const resolvedRole = await resolveDashboardRole({ ...dashboardUser, client_ids: clientIds });
    const sanitizedUser = { ...dashboardUser };
    delete sanitizedUser.password_hash;
    sanitizedUser.role = resolvedRole;
    sanitizedUser.client_ids = clientIds;
    if (clientIds.length === 1) {
      sanitizedUser.client_id = clientIds[0];
    } else if ('client_id' in sanitizedUser) {
      delete sanitizedUser.client_id;
    }

    req.dashboardUser = sanitizedUser;
    req.user = sanitizedUser;
    next();
  } catch (err) {
    console.error('[AUTH] Failed to verify dashboard token:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

export async function verifyDashboardOrClientToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error('[AUTH] Failed to verify token:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  try {
    const exists = await redis.get(`login_token:${token}`);
    if (!exists) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (String(exists).startsWith('dashboard:')) {
      return verifyDashboardToken(req, res, next);
    }

    const userPayload = { ...payload };
    if (!userPayload.client_id && typeof exists === 'string' && !exists.includes(':')) {
      userPayload.client_id = exists;
    }
    req.user = userPayload;
    return next();
  } catch (err) {
    console.error('[AUTH] Failed to validate login token:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}
