import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { formatToWhatsAppId, safeSendMessage } from '../utils/waHelper.js';
import waClient, { waitForWaReady } from '../service/waService.js';
import { sendSuccess } from '../utils/response.js';

export async function approveDashboardUser(req, res, next) {
  try {
    if (req.dashboardUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const { id } = req.params;
    const usr = await dashboardUserModel.findById(id);
    if (!usr) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const updated = await dashboardUserModel.updateStatus(id, true);
    if (usr.whatsapp) {
      try {
        await waitForWaReady();
        const wid = formatToWhatsAppId(usr.whatsapp);
        await safeSendMessage(
          waClient,
          wid,
          `✅ Registrasi dashboard Anda telah disetujui.\nUsername: ${usr.username}`
        );
      } catch (err) {
        console.warn(
          `[WA] Skipping approval notification for ${usr.username}: ${err.message}`
        );
      }
    }
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function rejectDashboardUser(req, res, next) {
  try {
    if (req.dashboardUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const { id } = req.params;
    const usr = await dashboardUserModel.findById(id);
    if (!usr) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const updated = await dashboardUserModel.updateStatus(id, false);
    if (usr.whatsapp) {
      try {
        await waitForWaReady();
        const wid = formatToWhatsAppId(usr.whatsapp);
        await safeSendMessage(
          waClient,
          wid,
          `❌ Registrasi dashboard Anda ditolak.\nUsername: ${usr.username}`
        );
      } catch (err) {
        console.warn(
          `[WA] Skipping rejection notification for ${usr.username}: ${err.message}`
        );
      }
    }
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
