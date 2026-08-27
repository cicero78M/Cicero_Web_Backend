import bcrypt from 'bcrypt';
import crypto from 'crypto';
import * as dashboardUserModel from '../../model/dashboardUserModel.js';
import * as dashboardPasswordResetModel from '../../model/dashboardPasswordResetModel.js';
import { normalizeWhatsappNumber } from '../../utils/waHelper.js';
import {
  sendPasswordResetFailureNotification,
  sendTelegramAdminMessage,
} from '../../service/telegramService.js';
import {
  buildResetMessage,
  clearDashboardSessions,
  isSameWhatsappContact,
  RESET_TOKEN_EXPIRY_MINUTES,
} from './shared.js';

export async function handleDashboardPasswordResetRequest(req, res) {
  const { username, contact } = req.body;
  if (!username || !contact) {
    return res.status(400).json({
      success: false,
      message: 'username dan kontak wajib diisi',
    });
  }
  const normalizedContact = normalizeWhatsappNumber(contact);
  if (!normalizedContact || normalizedContact.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'kontak whatsapp tidak valid',
    });
  }
  try {
    const user = await dashboardUserModel.findByUsername(username);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'pengguna dashboard tidak ditemukan',
      });
    }

    let matchesWhatsapp = false;
    if (user.whatsapp) {
      matchesWhatsapp = isSameWhatsappContact(user.whatsapp, normalizedContact);
    }
    if (!matchesWhatsapp) {
      const candidates = await dashboardUserModel.findAllByNormalizedWhatsApp(
        normalizedContact,
      );
      matchesWhatsapp = candidates.some(
        (candidate) => candidate.dashboard_user_id === user.dashboard_user_id,
      );
    }
    if (!matchesWhatsapp) {
      return res.status(400).json({
        success: false,
        message: 'kontak tidak sesuai dengan data pengguna',
      });
    }

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000,
    );
    await dashboardPasswordResetModel.createResetRequest({
      dashboardUserId: user.dashboard_user_id,
      deliveryTarget: contact,
      resetToken,
      expiresAt,
    });

    try {
      const message = buildResetMessage({ username: user.username, token: resetToken });
      const sent = await sendTelegramAdminMessage(message);
      if (!sent) {
        throw new Error('Telegram send returned null');
      }
    } catch (err) {
      console.warn(
        `[Telegram] Gagal mengirim reset password dashboard untuk ${username}: ${err.message}`,
      );
      await sendPasswordResetFailureNotification(
        `⚠️ Reset password dashboard gagal dikirim. Username: ${username}. Kontak: ${contact}. Token: ${resetToken}`,
      ).catch((e) => console.error('[Telegram] Failed to send failure notification:', e));
      return res.status(500).json({
        success: false,
        message:
          'Instruksi reset tidak dapat dikirim. Silakan hubungi admin untuk bantuan.',
      });
    }

    return res.json({
      success: true,
      message: 'Permintaan reset password telah diterima. Token akan dikirim ke admin melalui Telegram. Silakan hubungi admin untuk mendapatkan token reset password Anda.',
    });
  } catch (err) {
    console.error('[AUTH] Gagal membuat permintaan reset password dashboard:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server. Silakan hubungi admin.',
    });
  }
}

export async function handleDashboardPasswordResetConfirm(req, res) {
  const { token, password, confirmPassword, password_confirmation: passwordConfirmation } =
    req.body;
  const confirmation = confirmPassword ?? passwordConfirmation;
  if (!token || !password || !confirmation) {
    return res.status(400).json({
      success: false,
      message: 'token, password, dan konfirmasi wajib diisi',
    });
  }
  if (password !== confirmation) {
    return res.status(400).json({
      success: false,
      message: 'konfirmasi password tidak cocok',
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'password minimal 8 karakter',
    });
  }

  try {
    const resetRecord = await dashboardPasswordResetModel.findActiveByToken(token);
    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: 'token reset tidak valid atau sudah kedaluwarsa',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updatedUser = await dashboardUserModel.updatePasswordHash(
      resetRecord.dashboard_user_id,
      passwordHash,
    );
    if (!updatedUser) {
      throw new Error('dashboard user not found when updating password');
    }

    await dashboardPasswordResetModel.markTokenUsed(token);
    await clearDashboardSessions(resetRecord.dashboard_user_id);

    return res.json({
      success: true,
      message: 'Password berhasil diperbarui. Silakan login kembali.',
    });
  } catch (err) {
    console.error('[AUTH] Gagal mengonfirmasi reset password dashboard:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui password. Silakan hubungi admin.',
    });
  }
}
