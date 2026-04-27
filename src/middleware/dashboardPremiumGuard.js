import * as dashboardSubscriptionService from '../service/dashboardSubscriptionService.js';
import { query } from '../repository/db.js';

const DIREKTORAT_ROLE_SET = new Set([
  'ditbinmas',
  'ditlantas',
  'bidhumas',
  'ditsamapta',
  'ditintelkam',
  'direktorat',
]);

function normalizeTier(tier) {
  return typeof tier === 'string' ? tier.trim().toLowerCase() : null;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getTime() < Date.now();
}

function needsSnapshot(user = {}) {
  const missingStatus = typeof user.premium_status === 'undefined' || user.premium_status === null;
  const missingTier =
    typeof user.premium_tier === 'undefined' ||
    user.premium_tier === null ||
    (typeof user.premium_tier === 'string' && user.premium_tier.trim() === '');
  const missingExpiresAt =
    typeof user.premium_expires_at === 'undefined' ||
    user.premium_expires_at === null ||
    (typeof user.premium_expires_at === 'string' && user.premium_expires_at.trim() === '');

  return missingStatus || missingTier || missingExpiresAt;
}

function normalizeRoleValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function resolveDirektoratRoleCandidate(client) {
  if (!client || typeof client !== 'object') return null;

  const parentClientId = normalizeRoleValue(client.parent_client_id);
  if (parentClientId && DIREKTORAT_ROLE_SET.has(parentClientId)) {
    return parentClientId;
  }

  const clientGroup = normalizeRoleValue(client.client_group);
  if (clientGroup) {
    const compact = clientGroup.replace(/[\s_-]+/g, '');
    for (const role of DIREKTORAT_ROLE_SET) {
      if (compact.includes(role)) return role;
    }
  }

  return null;
}

async function isMandiriPolresOperatorBypassAllowed(req, userContext = {}) {
  const role = normalizeRoleValue(userContext.role);
  if (role !== 'operator') return false;

  const requestedClientId =
    req.query?.client_id ||
    req.headers?.['x-client-id'] ||
    userContext.client_id ||
    (Array.isArray(userContext.client_ids) && userContext.client_ids.length === 1
      ? userContext.client_ids[0]
      : null);

  if (!requestedClientId) return false;

  const normalizedRequested = String(requestedClientId).trim().toLowerCase();
  if (!normalizedRequested) return false;

  const allowedClientIds = Array.isArray(userContext.client_ids)
    ? userContext.client_ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
    : [];

  if (allowedClientIds.length > 0 && !allowedClientIds.includes(normalizedRequested)) {
    return false;
  }

  const { rows } = await query(
    `SELECT client_type, parent_client_id, client_group
     FROM clients
     WHERE LOWER(TRIM(client_id)) = LOWER($1)
     LIMIT 1`,
    [normalizedRequested],
  );

  const client = rows[0];
  if (!client) return false;

  const clientType = normalizeRoleValue(client.client_type);
  if (clientType !== 'org') return false;

  const tiedDirektorat = resolveDirektoratRoleCandidate(client);
  return !tiedDirektorat;
}

export function dashboardPremiumGuard(allowedTiers = []) {
  const normalizedAllowed = Array.isArray(allowedTiers)
    ? allowedTiers.map(normalizeTier).filter(Boolean)
    : [];

  return async (req, res, next) => {
    try {
      const userContext = req.dashboardUser || req.user;
      if (!userContext) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      let premiumStatus = userContext.premium_status;
      let premiumTier = userContext.premium_tier;
      let premiumExpiresAt = userContext.premium_expires_at;

      if (needsSnapshot(userContext)) {
        const snapshot = await dashboardSubscriptionService.getPremiumSnapshot(userContext);
        premiumStatus = snapshot.premiumStatus;
        premiumTier = snapshot.premiumTier;
        premiumExpiresAt = snapshot.premiumExpiresAt;
        const refreshedUser = {
          ...userContext,
          premium_status: premiumStatus,
          premium_tier: premiumTier,
          premium_expires_at: premiumExpiresAt,
        };
        req.dashboardUser = refreshedUser;
        req.user = refreshedUser;
      }

      const isOperatorMandiriBypass = await isMandiriPolresOperatorBypassAllowed(req, req.dashboardUser || req.user);
      if (isOperatorMandiriBypass) {
        req.premiumGuard = {
          premiumStatus: true,
          premiumTier: 'operator_mandiri_bypass',
          premiumExpiresAt: null,
        };
        return next();
      }

      const normalizedTier = normalizeTier(premiumTier);
      const expired = isExpired(premiumExpiresAt);

      if (!premiumStatus || expired) {
        return res.status(403).json({
          success: false,
          message: expired
            ? 'Langganan premium telah kedaluwarsa'
            : 'Akses premium diperlukan untuk endpoint ini',
          premium_tier: premiumTier || null,
          premium_expires_at: premiumExpiresAt || null,
        });
      }

      if (normalizedAllowed.length > 0 && (!normalizedTier || !normalizedAllowed.includes(normalizedTier))) {
        return res.status(403).json({
          success: false,
          message: 'Premium tier tidak diizinkan untuk endpoint ini',
          premium_tier: premiumTier || null,
        });
      }

      req.premiumGuard = {
        premiumStatus: Boolean(premiumStatus),
        premiumTier: normalizedTier,
        premiumExpiresAt,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
