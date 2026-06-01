import jwt from 'jsonwebtoken';
import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { query } from '../repository/db.js';
import redis from '../config/redis.js';

const jwtAllowedAlgorithms = ['HS256'];

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

async function buildDashboardRequestContext(token, payload, loginState) {
  let exists = loginState;
  if (exists === undefined) {
    try {
      exists = await redis.get(`login_token:${token}`);
    } catch (redisErr) {
      console.error('[AUTH] Redis unavailable in verifyDashboardToken:', redisErr);
      return {
        error: { status: 503, body: { success: false, message: 'Service temporarily unavailable' } },
      };
    }
  }

  if (!exists) {
    return { error: { status: 401, body: { success: false, message: 'Invalid token' } } };
  }
  if (!String(exists).startsWith('dashboard:')) {
    return { error: { status: 403, body: { success: false, message: 'Forbidden' } } };
  }

  const dashboardUserId = payload.dashboard_user_id;
  if (!dashboardUserId) {
    return { error: { status: 401, body: { success: false, message: 'Invalid token' } } };
  }

  try {
    const dashboardUser = await dashboardUserModel.findById(dashboardUserId);
    if (!dashboardUser || dashboardUserModel.getEffectiveApprovalStatus(dashboardUser) !== 'approved') {
      return { error: { status: 401, body: { success: false, message: 'Invalid token' } } };
    }

    const clientIds = normalizeClientIds(dashboardUser.client_ids);
    if (clientIds.length === 0) {
      return {
        error: {
          status: 403,
          body: {
            success: false,
            message: 'Operator belum memiliki klien yang diizinkan',
          },
        },
      };
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

    return { user: sanitizedUser };
  } catch (err) {
    console.error('[AUTH] Failed to process dashboard token:', err);
    return { error: { status: 401, body: { success: false, message: 'Invalid token' } } };
  }
}

function applyDashboardRequestContext(req, dashboardUser) {
  req.dashboardUser = dashboardUser;
  req.user = dashboardUser;
}

export async function verifyDashboardToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: jwtAllowedAlgorithms,
    });
  } catch (err) {
    console.error('[AUTH] Failed to verify dashboard token:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  const result = await buildDashboardRequestContext(token, payload);
  if (result.error) {
    return res.status(result.error.status).json(result.error.body);
  }

  applyDashboardRequestContext(req, result.user);
  return next();
}

export async function verifyDashboardOrClientToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: jwtAllowedAlgorithms,
    });
  } catch (err) {
    console.error('[AUTH] Failed to verify token:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  let exists;
  try {
    exists = await redis.get(`login_token:${token}`);
  } catch (redisErr) {
    console.error('[AUTH] Redis unavailable in verifyDashboardOrClientToken:', redisErr);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  try {
    if (!exists) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (String(exists).startsWith('dashboard:')) {
      const dashboardContext = await buildDashboardRequestContext(token, payload, exists);
      if (dashboardContext.error) {
        return res.status(dashboardContext.error.status).json(dashboardContext.error.body);
      }
      applyDashboardRequestContext(req, dashboardContext.user);
      return next();
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
