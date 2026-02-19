import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { sendSuccess } from '../utils/response.js';
import { 
  sendUserApprovalConfirmation, 
  sendUserRejectionConfirmation,
  sendTelegramMessage
} from '../service/telegramService.js';
import { sendApprovalEmail, sendRejectionEmail } from '../service/emailService.js';

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
    
    // Send Telegram notification to admin
    sendUserApprovalConfirmation(usr).catch((err) => {
      console.warn(`[Telegram] Failed to send approval notification: ${err.message}`);
    });
    
    // Send Telegram notification to user if they have telegram_chat_id
    if (usr.telegram_chat_id) {
      try {
        await sendTelegramMessage(
          usr.telegram_chat_id,
          `✅ Registrasi dashboard Anda telah disetujui.\nUsername: ${usr.username}`
        );
      } catch (err) {
        console.warn(
          `[Telegram] Skipping approval notification for ${usr.username}: ${err.message}`
        );
      }
    }

    // Send email notification to user if they have email
    if (usr.email) {
      sendApprovalEmail(usr.email, usr.username).catch((err) => {
        console.warn(`[Email] Failed to send approval email to ${usr.username}: ${err.message}`);
      });
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
    const { reason } = req.body || {};
    const usr = await dashboardUserModel.findById(id);
    if (!usr) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const updated = await dashboardUserModel.updateStatus(id, false);
    
    // Send Telegram notification to admin
    sendUserRejectionConfirmation(usr).catch((err) => {
      console.warn(`[Telegram] Failed to send rejection notification: ${err.message}`);
    });
    
    // Send Telegram notification to user if they have telegram_chat_id
    if (usr.telegram_chat_id) {
      try {
        await sendTelegramMessage(
          usr.telegram_chat_id,
          `❌ Registrasi dashboard Anda ditolak.\nUsername: ${usr.username}`
        );
      } catch (err) {
        console.warn(
          `[Telegram] Skipping rejection notification for ${usr.username}: ${err.message}`
        );
      }
    }

    // Send email notification to user if they have email
    if (usr.email) {
      sendRejectionEmail(usr.email, usr.username, reason || null).catch((err) => {
        console.warn(`[Email] Failed to send rejection email to ${usr.username}: ${err.message}`);
      });
    }

    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
