import * as dashboardSubscriptionService from '../service/dashboardSubscriptionService.js';

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
