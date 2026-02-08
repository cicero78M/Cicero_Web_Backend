import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { sendSuccess } from '../utils/response.js';
import { notifyAdmin } from '../service/telegramService.js';
import { formatSimpleNotification } from '../utils/telegramHelper.js';

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
    
    // Notify admins about the approval
    try {
      await notifyAdmin(
        formatSimpleNotification('✅', 'Dashboard User Approved', {
          'Username': usr.username,
          'User ID': id,
          'WhatsApp': usr.whatsapp || 'N/A'
        })
      );
    } catch (err) {
      console.warn(
        `[TELEGRAM] Failed to send approval notification for ${usr.username}: ${err.message}`
      );
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
    
    // Notify admins about the rejection
    try {
      await notifyAdmin(
        formatSimpleNotification('❌', 'Dashboard User Rejected', {
          'Username': usr.username,
          'User ID': id,
          'WhatsApp': usr.whatsapp || 'N/A'
        })
      );
    } catch (err) {
      console.warn(
        `[TELEGRAM] Failed to send rejection notification for ${usr.username}: ${err.message}`
      );
    }
    
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
