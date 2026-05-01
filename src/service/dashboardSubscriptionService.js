import * as dashboardSubscriptionModel from '../model/dashboardSubscriptionModel.js';
import { query } from '../repository/db.js';

const REGULAR_TIER = 'regular';

function getExecutor(dbClient = query) {
  if (typeof dbClient?.query === 'function') {
    return (...args) => dbClient.query(...args);
  }
  return dbClient;
}

async function updatePremiumCache(dashboardUserId, activeSubscription = null, dbClient = query) {
  const exec = getExecutor(dbClient);
  const active =
    activeSubscription || (await dashboardSubscriptionModel.findActiveByUser(dashboardUserId, dbClient));

  const premiumStatus = Boolean(active);
  const premiumTier = active?.tier || REGULAR_TIER;
  const premiumExpiresAt = active?.expires_at || null;

  const { rows } = await exec(
    `UPDATE dashboard_user
     SET premium_status = $2,
         premium_tier = $3,
         premium_expires_at = $4,
         updated_at = NOW()
     WHERE dashboard_user_id = $1
     RETURNING premium_status, premium_tier, premium_expires_at`,
    [dashboardUserId, premiumStatus, premiumTier, premiumExpiresAt],
  );

  return rows[0] || {
    premium_status: premiumStatus,
    premium_tier: premiumTier,
    premium_expires_at: premiumExpiresAt,
  };
}

export async function createSubscription(payload) {
  await query('BEGIN');
  try {
    const subscription = await dashboardSubscriptionModel.create(payload);
    const cache = await updatePremiumCache(subscription.dashboard_user_id, subscription);
    await query('COMMIT');
    return { subscription, cache };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

export async function createSubscriptionWithClient(payload, dbClient) {
  const execClient = dbClient || query;
  const subscription = await dashboardSubscriptionModel.create(payload, execClient);
  const cache = await updatePremiumCache(subscription.dashboard_user_id, subscription, execClient);
  return { subscription, cache };
}

export async function expireSubscription(subscriptionId, expiredAt = null) {
  await query('BEGIN');
  try {
    const subscription = await dashboardSubscriptionModel.expire(subscriptionId, expiredAt);
    if (!subscription) {
      await query('ROLLBACK');
      return null;
    }
    const cache = await updatePremiumCache(subscription.dashboard_user_id);
    await query('COMMIT');
    return { subscription, cache };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

export async function cancelSubscription(subscriptionId, canceledAt = null) {
  await query('BEGIN');
  try {
    const subscription = await dashboardSubscriptionModel.cancel(subscriptionId, canceledAt);
    if (!subscription) {
      await query('ROLLBACK');
      return null;
    }
    const cache = await updatePremiumCache(subscription.dashboard_user_id);
    await query('COMMIT');
    return { subscription, cache };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

export async function renewSubscription(subscriptionId, payload = {}) {
  await query('BEGIN');
  try {
    const subscription = await dashboardSubscriptionModel.renew(subscriptionId, payload);
    if (!subscription) {
      await query('ROLLBACK');
      return null;
    }
    const cache = await updatePremiumCache(subscription.dashboard_user_id, subscription);
    await query('COMMIT');
    return { subscription, cache };
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

export async function getActiveSubscription(dashboardUserId) {
  return dashboardSubscriptionModel.findActiveByUser(dashboardUserId);
}

export async function getPremiumSnapshot(dashboardUser) {
  if (!dashboardUser) {
    return { premiumStatus: false, premiumTier: REGULAR_TIER, premiumExpiresAt: null };
  }
  const active = await dashboardSubscriptionModel.findActiveByUser(
    dashboardUser.dashboard_user_id,
  );
  if (active) {
    return {
      premiumStatus: true,
      premiumTier: active.tier,
      premiumExpiresAt: active.expires_at,
    };
  }

  const needsCacheRefresh =
    Boolean(dashboardUser.premium_status) ||
    Boolean(dashboardUser.premium_expires_at) ||
    (typeof dashboardUser.premium_tier === 'string' &&
      dashboardUser.premium_tier.trim() !== '' &&
      dashboardUser.premium_tier.trim().toLowerCase() !== REGULAR_TIER);

  if (needsCacheRefresh) {
    const refreshed = await updatePremiumCache(dashboardUser.dashboard_user_id);
    return {
      premiumStatus: Boolean(refreshed.premium_status),
      premiumTier: refreshed.premium_tier || REGULAR_TIER,
      premiumExpiresAt: refreshed.premium_expires_at || null,
    };
  }

  return {
    premiumStatus: Boolean(dashboardUser.premium_status),
    premiumTier: dashboardUser.premium_tier || REGULAR_TIER,
    premiumExpiresAt: dashboardUser.premium_expires_at || null,
  };
}

export async function refreshPremiumCache(dashboardUserId, { dbClient } = {}) {
  return updatePremiumCache(dashboardUserId, null, dbClient || query);
}
