import {
  confirmDashboardPremiumRequest,
  createDashboardPremiumRequest,
  findDashboardPremiumRequestByToken,
  findLatestOpenDashboardPremiumRequestByIdentifier,
  markDashboardPremiumRequestNotified,
} from '../service/dashboardPremiumRequestService.js';
import waClient from '../service/waService.js';
import { sendDashboardPremiumRequestNotification } from '../service/waService.js';

function getDashboardUserFromRequest(req) {
  return req.dashboardUser || req.user || null;
}

async function broadcastDashboardPremiumRequest(request, source = 'create') {
  if (!request) return request;
  if (source === 'confirm' && request.metadata?.admin_notification_sent) {
    return request;
  }

  try {
    const notified = await sendDashboardPremiumRequestNotification(waClient, request);
    if (notified) {
      const metadataPatch = {
        admin_notification_sent: true,
        admin_notification_sent_at: request.metadata?.admin_notification_sent_at || new Date().toISOString(),
        admin_notification_source: source,
      };
      return markDashboardPremiumRequestNotified(request, metadataPatch);
    }
  } catch (err) {
    console.warn(
      `[DashboardPremiumRequest] Failed to notify admins on ${source}: ${err?.message || err}`,
    );
  }

  return request;
}

export async function createDashboardPremiumRequestController(req, res, next) {
  try {
    const dashboardUser = getDashboardUserFromRequest(req);
    const request = await createDashboardPremiumRequest(dashboardUser, req.body || {});
    const updatedRequest = await broadcastDashboardPremiumRequest(request, 'create');
    res.status(201).json({ success: true, request: updatedRequest });
  } catch (err) {
    next(err);
  }
}

export async function confirmDashboardPremiumRequestController(req, res, next) {
  try {
    const dashboardUser = getDashboardUserFromRequest(req);
    const { token } = req.params;
    const request = await confirmDashboardPremiumRequest(token, dashboardUser, req.body || {});
    const updatedRequest = await broadcastDashboardPremiumRequest(request, 'confirm');
    res.json({ success: true, request: updatedRequest });
  } catch (err) {
    next(err);
  }
}

export async function getDashboardPremiumRequestController(req, res, next) {
  try {
    const dashboardUser = getDashboardUserFromRequest(req);
    const { token } = req.params;
    const request = await findDashboardPremiumRequestByToken(token);
    if (!request || request.dashboard_user_id !== dashboardUser?.dashboard_user_id) {
      return res.status(404).json({ success: false, message: 'Request tidak ditemukan' });
    }
    res.json({ success: true, request });
  } catch (err) {
    next(err);
  }
}

export async function getLatestDashboardPremiumRequestController(req, res, next) {
  try {
    const dashboardUser = getDashboardUserFromRequest(req);
    const identifier = dashboardUser?.dashboard_user_id || dashboardUser?.username;
    const request = await findLatestOpenDashboardPremiumRequestByIdentifier(identifier);

    if (!request || request.dashboard_user_id !== dashboardUser?.dashboard_user_id) {
      return res.json({ success: true, hasOpenRequest: false, request: null });
    }

    return res.json({ success: true, hasOpenRequest: true, request });
  } catch (err) {
    next(err);
  }
}
