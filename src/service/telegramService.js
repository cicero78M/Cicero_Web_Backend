// src/service/telegramService.js

import TelegramBot from './telegramBotAdapter.js';
import {
  DEFAULT_TIMEZONE,
  escapeMarkdown,
  REJECTION_REASONS,
} from './telegram/formatters.js';
import {
  sendTelegramAdminMessage as sendTelegramAdminMessageHelper,
  sendLoginLogNotification as sendLoginLogNotificationHelper,
  sendPasswordResetFailureNotification as sendPasswordResetFailureNotificationHelper,
  sendUserApprovalConfirmation as sendUserApprovalConfirmationHelper,
  sendUserApprovalRequest as sendUserApprovalRequestHelper,
  sendUserRejectionConfirmation as sendUserRejectionConfirmationHelper,
} from './telegram/adminNotifications.js';
import {
  handlePremiumPendingCommand as handlePremiumPendingCommandHelper,
  processPremiumApproval as processPremiumApprovalHelper,
  processPremiumDenial as processPremiumDenialHelper,
  sendDashboardPremiumRequestNotification as sendDashboardPremiumRequestNotificationHelper,
  sendPremiumRequestNotification as sendPremiumRequestNotificationHelper,
} from './telegram/premiumNotifications.js';
import { createTelegramCallbackHandlers } from './telegram/callbackHandlers.js';
import { createTelegramCommandHandlers } from './telegram/commandHandlers.js';
import { createTelegramLifecycle } from './telegram/lifecycle.js';

let bot = null;
let botReady = false;
let isInitializing = false;

/**
 * Check if a chat ID is authorized as admin
 * @param {number|string} chatId - Telegram chat ID
 * @returns {boolean}
 */
export function isTelegramAdmin(chatId) {
  const adminChatIds = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => String(id));

  return adminChatIds.includes(String(chatId));
}

const commandHandlers = createTelegramCommandHandlers({
  getBot: () => bot,
  isTelegramAdmin,
  processApproval,
  processRejection,
  processPremiumApproval,
  processPremiumDenial,
  handlePremiumPendingCommand,
});

const {
  setupCommandHandlers,
} = commandHandlers;

function setupCallbackHandlers() {
  return callbackHandlers.setupCallbackHandlers();
}

const lifecycle = createTelegramLifecycle({
  TelegramBot,
  getBot: () => bot,
  setBot: (value) => {
    bot = value;
  },
  getBotReady: () => botReady,
  setBotReady: (value) => {
    botReady = value;
  },
  getIsInitializing: () => isInitializing,
  setIsInitializing: (value) => {
    isInitializing = value;
  },
  setupCommandHandlers,
  setupCallbackHandlers,
});

export const initializeTelegramBot = lifecycle.initializeTelegramBot;
export const getTelegramBot = lifecycle.getTelegramBot;
export const isTelegramReady = lifecycle.isTelegramReady;

/**
 * Send a message to a Telegram chat
 * @param {string|number} chatId - Chat ID or username
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<{chatId: string|number, status: 'sent'|'bot_not_ready'|'failed', message?: object, error?: object}>}
 */
export async function sendTelegramMessage(chatId, message, options = {}) {
  if (!isTelegramReady()) {
    console.warn('[Telegram] Bot not ready, skipping message');
    return { chatId, status: 'bot_not_ready' };
  }

  try {
    const result = await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      ...options
    });
    console.log(`[Telegram] Message sent to ${chatId}`);
    return { chatId, status: 'sent', message: result };
  } catch (error) {
    console.error(`[Telegram] Failed to send message to ${chatId}:`, error.message);

    // If parse error, retry without Markdown formatting
    if (error.message && error.message.includes("can't parse entities")) {
      console.warn(`[Telegram] Retrying message to ${chatId} without Markdown formatting`);
      try {
        // Remove parse_mode from options and retry
        const { parse_mode, ...optionsWithoutParseMode } = options;
        const result = await bot.sendMessage(chatId, message, optionsWithoutParseMode);
        console.log(`[Telegram] Message sent to ${chatId} (plain text)`);
        return { chatId, status: 'sent', message: result };
      } catch (retryError) {
        console.error(`[Telegram] Failed to send plain text message to ${chatId}:`, retryError.message);
        return {
          chatId,
          status: 'failed',
          error: { code: 'SEND_FAILED', message: 'Telegram message delivery failed' },
        };
      }
    }

    return {
      chatId,
      status: 'failed',
      error: { code: 'SEND_FAILED', message: 'Telegram message delivery failed' },
    };
  }
}

/**
 * Send a message to admin chat(s)
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<{totalTargets: number, sentCount: number, failedCount: number, results: Array<object>}>}
 */
export async function sendTelegramAdminMessage(message, options = {}) {
  return sendTelegramAdminMessageHelper(sendTelegramMessage, message, options);
}

/**
 * Send login log notification to admin
 * @param {object} logData - Login log data
 * @returns {Promise<object|null>}
 */
export async function sendLoginLogNotification(logData) {
  const { username, role, loginType, loginSource, timestamp, clientInfo } = logData;

  const time = new Date(timestamp || Date.now()).toLocaleString('id-ID', {
    timeZone: DEFAULT_TIMEZONE
  });

  let message = `🔑 *Login Dashboard*\n\n`;
  message += `*Username:* ${escapeMarkdown(username)}\n`;
  if (role) message += `*Role:* ${escapeMarkdown(role)}\n`;
  if (clientInfo) message += `*${escapeMarkdown(clientInfo.label)}:* ${escapeMarkdown(clientInfo.value)}\n`;
  message += `*Tipe:* ${escapeMarkdown(loginType)}\n`;
  message += `*Sumber:* ${escapeMarkdown(loginSource)}\n`;
  message += `*Waktu:* ${escapeMarkdown(time)}`;

  return sendTelegramAdminMessage(message);
}

/**
 * Send dashboard user approval request notification with inline buttons
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserApprovalRequest(userData) {
  const { dashboard_user_id, username, email, role, clientNames } = userData;

  let message = `📋 *Permintaan Registrasi Dashboard*\n\n`;
  message += `*User ID:* ${escapeMarkdown(String(dashboard_user_id))}\n`;
  message += `*Username:* ${escapeMarkdown(username)}\n`;
  if (email) message += `*Email:* ${escapeMarkdown(email)}\n`;
  if (role) message += `*Role:* ${escapeMarkdown(role)}\n`;
  if (clientNames) message += `*Satker/Polres:* ${escapeMarkdown(clientNames)}\n`;
  message += `\n_Menunggu persetujuan admin_\n\n`;
  message += `Gunakan tombol di bawah atau ketik:\n`;
  message += `\`/approvedash ${escapeMarkdown(username)}\` untuk menyetujui\n`;
  message += `\`/denydash ${escapeMarkdown(username)}\` untuk menolak`;

  // Add inline keyboard with approve/deny buttons
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Setujui', callback_data: `approve:${username}` },
        { text: '❌ Tolak', callback_data: `deny:${username}` }
      ]
    ]
  };

  return sendTelegramAdminMessage(message, { reply_markup: inlineKeyboard });
}

/**
 * Send dashboard user approval confirmation
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserApprovalConfirmation(userData) {
  const { username } = userData;

  const message = `✅ *Registrasi Dashboard Disetujui*\n\n*Username:* ${escapeMarkdown(username)}`;

  return sendTelegramAdminMessage(message);
}

/**
 * Send dashboard user rejection confirmation
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserRejectionConfirmation(userData) {
  const { username } = userData;

  const message = `❌ *Registrasi Dashboard Ditolak*\n\n*Username:* ${escapeMarkdown(username)}`;

  return sendTelegramAdminMessage(message);
}

/**
 * Send premium subscription request notification to admin
 * @param {object} requestData - Premium request data
 * @returns {Promise<object|null>}
 */
export async function sendPremiumRequestNotification(requestData) {
  return sendPremiumRequestNotificationHelper(sendTelegramAdminMessage, requestData);
}

/**
 * Send dashboard premium request notification to admin via Telegram
 * @param {object} request - Premium request data
 * @returns {Promise<boolean>}
 */
export async function sendDashboardPremiumRequestNotification(request) {
  return sendDashboardPremiumRequestNotificationHelper(sendTelegramAdminMessage, request);
}

async function processPremiumApproval(chatId, token) {
  return processPremiumApprovalHelper((...args) => bot.sendMessage(...args), chatId, token);
}

async function processPremiumDenial(chatId, token) {
  return processPremiumDenialHelper((...args) => bot.sendMessage(...args), chatId, token);
}

async function handlePremiumPendingCommand(msg) {
  return handlePremiumPendingCommandHelper((...args) => bot.sendMessage(...args), isTelegramAdmin, msg);
}

/**
 * Send complaint response notification
 * @param {string} message - Complaint message
 * @param {object} options - Options with chatId
 * @returns {Promise<object|null>}
 */
export async function sendComplaintNotification(message, options = {}) {
  const { chatId } = options;

  if (!chatId) {
    console.warn('[Telegram] No chatId provided for complaint notification');
    return null;
  }

  return sendTelegramMessage(chatId, message);
}

/**
 * Send password reset token to user via Telegram
 * @param {string|number} chatId - Telegram chat ID
 * @param {object} resetData - Reset data with username and token
 * @returns {Promise<object|null>}
 */
export async function sendPasswordResetToken(chatId, resetData) {
  const { username, token, expiryMinutes = 15, resetUrl } = resetData;

  const RESET_TOKEN_EXPIRY_MINUTES = expiryMinutes;
  const DEFAULT_RESET_BASE_URL = 'https://papiqo.com';

  const configuredBaseUrl = resetUrl || process.env.DASHBOARD_PASSWORD_RESET_URL || process.env.DASHBOARD_URL;
  const resetBaseUrl = configuredBaseUrl || DEFAULT_RESET_BASE_URL;

  const baseUrlWithoutTrailingSlash = resetBaseUrl.replace(/\/$/, '');
  const baseResetPath = baseUrlWithoutTrailingSlash.endsWith('/reset-password')
    ? baseUrlWithoutTrailingSlash
    : `${baseUrlWithoutTrailingSlash}/reset-password`;

  const url = `${baseResetPath}?token=${token}`;

  let message = `🔐 *Reset Password Dashboard*\n\n`;
  message += `Silakan buka tautan berikut untuk mengatur ulang password Anda:\n`;
  message += `${url}\n\n`;
  message += `*Username:* ${escapeMarkdown(username)}\n`;
  message += `*Token:* \`${token}\`\n\n`;
  message += `Token berlaku selama ${RESET_TOKEN_EXPIRY_MINUTES} menit.\n`;
  message += `Base URL: ${escapeMarkdown(baseResetPath)}`;

  return sendTelegramMessage(chatId, message);
}

/**
 * Queue admin notification for failed password reset
 * @param {string} message - Notification message
 * @returns {Promise<object|null>}
 */
export async function sendPasswordResetFailureNotification(message) {
  return sendPasswordResetFailureNotificationHelper(sendTelegramAdminMessage, message);
}

/**
 * Send Telegram notification to user and return status
 * @param {object} user - User object with telegram_chat_id field
 * @param {string} message - Message to send
 * @returns {Promise<object>} - Object with userNotified boolean and userNotificationError string
 */
async function sendUserTelegramNotification(user, message) {
  const result = {
    userNotified: false,
    userNotificationError: null
  };

  if (!user.telegram_chat_id) {
    result.userNotificationError = 'User does not have telegram_chat_id configured';
    return result;
  }

  try {
    const sent = await sendTelegramMessage(user.telegram_chat_id, message);

    result.userNotified = sent !== null;
    if (!result.userNotified) {
      result.userNotificationError = 'Telegram message send returned null';
    }
  } catch (err) {
    console.error(`[Telegram] Failed to notify user ${user.username}:`, err.message);
    result.userNotificationError = err.message;
  }

  return result;
}

/**
 * Build confirmation message with notification status
 * @param {string} baseMessage - Base confirmation message
 * @param {object} user - User object with telegram_chat_id field
 * @param {boolean} userNotified - Whether user was notified
 * @param {string|null} userNotificationError - Error message if notification failed
 * @returns {string} - Complete confirmation message
 */
function buildConfirmationMessage(baseMessage, user, userNotified, userNotificationError) {
  let confirmationMessage = baseMessage;

  if (user.telegram_chat_id) {
    if (userNotified) {
      confirmationMessage += `\n✅ Notifikasi telah dikirim ke Telegram user`;
    } else {
      confirmationMessage += `\n⚠️ Notifikasi ke Telegram user gagal dikirim`;
      if (userNotificationError) {
        confirmationMessage += `\nAlasan: ${escapeMarkdown(userNotificationError)}`;
      }
    }
  } else {
    confirmationMessage += `\n⚠️ User tidak memiliki Telegram chat ID terdaftar`;
  }

  return confirmationMessage;
}

/**
 * Process user approval
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} username - Username to approve
 */
export async function processApproval(chatId, username) {
  try {
    const { findByUsername, getEffectiveApprovalStatus, updateApprovalStatus } = await import('../model/dashboardUserModel.js');
    const { sendApprovalEmail } = await import('./emailService.js');

    // Find user by username
    const user = await findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId,
        `❌ User dengan username "${escapeMarkdown(username)}" tidak ditemukan.`
      );
      return;
    }

    const effectiveApprovalStatus = getEffectiveApprovalStatus(user);
    if (effectiveApprovalStatus !== 'pending') {
      const message = effectiveApprovalStatus === 'approved'
        ? `✅ User "${escapeMarkdown(username)}" sudah disetujui sebelumnya.`
        : `❌ User "${escapeMarkdown(username)}" sudah ditolak sebelumnya.`;
      await bot.sendMessage(chatId, message);
      return;
    }

    // Approve user (set status to true and approval_status to approved)
    const updated = await updateApprovalStatus(user.dashboard_user_id, 'approved', { onlyPending: true });
    if (!updated) {
      await bot.sendMessage(
        chatId,
        `⚠️ User "${escapeMarkdown(username)}" tidak lagi pending. Silakan cek status terbaru.`
      );
      return;
    }

    // Send notification to user via Telegram if available
    const { userNotified, userNotificationError } = await sendUserTelegramNotification(
      user,
      `✅ Registrasi dashboard Anda telah disetujui.\nUsername: ${escapeMarkdown(user.username)}`
    );

    // Send approval email to user if they have email
    if (user.email) {
      sendApprovalEmail(user.email, user.username).catch((err) => {
        console.warn(`[Email] Failed to send approval email to ${user.username}: ${err.message}`);
      });
    }

    // Send confirmation to admin via Telegram with notification status
    const confirmationMessage = buildConfirmationMessage(
      `✅ User "${escapeMarkdown(username)}" berhasil disetujui.`,
      user,
      userNotified,
      userNotificationError
    );

    await bot.sendMessage(chatId, confirmationMessage);

  } catch (err) {
    console.error('[Telegram] Error handling approve command:', err);
    await bot.sendMessage(
      chatId,
      `❌ Terjadi kesalahan: ${escapeMarkdown(err.message)}`
    );
  }
}

/**
 * Process user rejection - shows rejection reason selection to admin
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} username - Username to reject
 */
export async function processRejection(chatId, username) {
  try {
    const { findByUsername, getEffectiveApprovalStatus } = await import('../model/dashboardUserModel.js');

    // Find user by username
    const user = await findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId,
        `❌ User dengan username "${escapeMarkdown(username)}" tidak ditemukan.`
      );
      return;
    }

    const effectiveApprovalStatus = getEffectiveApprovalStatus(user);
    if (effectiveApprovalStatus !== 'pending') {
      const message = effectiveApprovalStatus === 'approved'
        ? `✅ User "${escapeMarkdown(username)}" sudah disetujui sebelumnya.`
        : `❌ User "${escapeMarkdown(username)}" sudah ditolak sebelumnya.`;
      await bot.sendMessage(chatId, message);
      return;
    }

    // Show rejection reason selection
    const inlineKeyboard = {
      inline_keyboard: REJECTION_REASONS.map((reason, index) => [
        { text: reason, callback_data: `reject_reason:${username}:${index}` }
      ])
    };

    await bot.sendMessage(
      chatId,
      `❌ Pilih alasan penolakan untuk user "${escapeMarkdown(username)}":`,
      { reply_markup: inlineKeyboard }
    );

  } catch (err) {
    console.error('[Telegram] Error handling deny command:', err);
    await bot.sendMessage(
      chatId,
      `❌ Terjadi kesalahan: ${escapeMarkdown(err.message)}`
    );
  }
}

/**
 * Finalize user rejection with selected reason
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} username - Username to reject
 * @param {string} reason - Rejection reason text
 */
export async function finalizeRejection(chatId, username, reason) {
  try {
    const { findByUsername, getEffectiveApprovalStatus, updateApprovalStatus } = await import('../model/dashboardUserModel.js');
    const { sendRejectionEmail } = await import('./emailService.js');

    const user = await findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId,
        `❌ User dengan username "${escapeMarkdown(username)}" tidak ditemukan.`
      );
      return;
    }

    const effectiveApprovalStatus = getEffectiveApprovalStatus(user);
    if (effectiveApprovalStatus !== 'pending') {
      const message = effectiveApprovalStatus === 'approved'
        ? `✅ User "${escapeMarkdown(username)}" sudah disetujui sebelumnya.`
        : `❌ User "${escapeMarkdown(username)}" sudah ditolak sebelumnya.`;
      await bot.sendMessage(chatId, message);
      return;
    }

    // Reject user (set status to false and approval_status to rejected)
    const updated = await updateApprovalStatus(user.dashboard_user_id, 'rejected', { onlyPending: true });
    if (!updated) {
      await bot.sendMessage(
        chatId,
        `⚠️ User "${escapeMarkdown(username)}" tidak lagi pending. Silakan cek status terbaru.`
      );
      return;
    }

    // Send notification to user via Telegram if available
    const { userNotified, userNotificationError } = await sendUserTelegramNotification(
      user,
      `❌ Registrasi dashboard Anda ditolak.\nUsername: ${escapeMarkdown(user.username)}\nAlasan: ${escapeMarkdown(reason)}`
    );

    // Send rejection email to user if they have email
    if (user.email) {
      sendRejectionEmail(user.email, user.username, reason).catch((err) => {
        console.warn(`[Email] Failed to send rejection email to ${user.username}: ${err.message}`);
      });
    }

    // Send confirmation to admin via Telegram with notification status
    const confirmationMessage = buildConfirmationMessage(
      `✅ User "${escapeMarkdown(username)}" berhasil ditolak.\nAlasan: ${escapeMarkdown(reason)}`,
      user,
      userNotified,
      userNotificationError
    );

    await bot.sendMessage(chatId, confirmationMessage);

  } catch (err) {
    console.error('[Telegram] Error finalizing rejection:', err);
    await bot.sendMessage(
      chatId,
      `❌ Terjadi kesalahan: ${escapeMarkdown(err.message)}`
    );
  }
}

const callbackHandlers = createTelegramCallbackHandlers({
  getBot: () => bot,
  isTelegramAdmin,
  rejectionReasons: REJECTION_REASONS,
  finalizeRejection,
  processPremiumApproval,
  processPremiumDenial,
  processApproval,
  processRejection,
});

// Initialize bot on module load
initializeTelegramBot();

export default {
  initializeTelegramBot,
  getTelegramBot,
  isTelegramReady,
  isTelegramAdmin,
  sendTelegramMessage,
  sendTelegramAdminMessage,
  sendLoginLogNotification,
  sendUserApprovalRequest,
  sendUserApprovalConfirmation,
  sendUserRejectionConfirmation,
  sendPremiumRequestNotification,
  sendDashboardPremiumRequestNotification,
  sendComplaintNotification,
  sendPasswordResetToken,
  sendPasswordResetFailureNotification,
  REJECTION_REASONS
};
