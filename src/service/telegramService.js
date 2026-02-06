import TelegramBot from 'node-telegram-bot-api';
import * as dashboardUserModel from '../model/dashboardUserModel.js';
import { formatToWhatsAppId, safeSendMessage } from '../utils/waHelper.js';
import waClient, { waitForWaReady } from './waService.js';

let bot = null;
let isInitialized = false;
let initError = null;
let pollingErrorCount = 0;
const MAX_POLLING_ERRORS = 5;
let isPollingEnabled = true;

/**
 * Validate Telegram chat ID format
 * @param {string} chatId - Chat ID to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidChatId(chatId) {
  return chatId && chatId.match(/^-?\d+$/) !== null;
}

/**
 * Handle Telegram API errors with helpful messages
 * @param {Error} err - The error object
 * @param {string} adminChatId - The chat ID that was used
 * @param {string} context - Context for the error (e.g., "approval request", "notification")
 */
function handleTelegramError(err, adminChatId, context) {
  if (err.response?.body?.error_code === 400) {
    console.error(
      `[TELEGRAM] Chat not found (ID: ${adminChatId}). Please ensure:\n` +
        '  1. The bot is added to the chat/group\n' +
        '  2. The chat ID is correct (get it by sending /start to the bot)\n' +
        '  3. The bot has permission to send messages'
    );
  } else {
    console.error(`[TELEGRAM] Failed to send ${context}:`, err.message || err);
  }
}

/**
 * Initialize Telegram bot
 */
export function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !adminChatId) {
    console.log(
      '[TELEGRAM] Telegram bot is disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to enable.'
    );
    return false;
  }

  // Validate chat ID format
  if (!isValidChatId(adminChatId)) {
    console.error(
      `[TELEGRAM] Invalid TELEGRAM_ADMIN_CHAT_ID format: "${adminChatId}". Must be a numeric chat ID (e.g., "123456789" or "-123456789" for groups).`
    );
    return false;
  }

  try {
    bot = new TelegramBot(token, { 
      polling: {
        autoStart: true,
        interval: 300,
        params: {
          timeout: 10
        }
      }
    });
    isInitialized = true;
    pollingErrorCount = 0;
    isPollingEnabled = true;

    // Handle /start command
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(
        chatId,
        '👋 Selamat datang di Cicero Bot!\n\nBot ini digunakan untuk approval dashboard user.\n\nGunakan perintah berikut:\n/approve <username> - Setujui registrasi user\n/deny <username> - Tolak registrasi user'
      );
    });

    // Handle /approve command
    bot.onText(/\/approve (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const username = match[1]?.trim();

      // Check if admin
      if (String(chatId) !== adminChatId) {
        bot.sendMessage(chatId, '❌ Anda tidak memiliki akses untuk perintah ini.');
        return;
      }

      if (!username) {
        bot.sendMessage(chatId, '❌ Format salah! Gunakan: /approve <username>');
        return;
      }

      try {
        const usr = await dashboardUserModel.findByUsername(username);
        if (!usr) {
          bot.sendMessage(chatId, `❌ Username ${username} tidak ditemukan.`);
          return;
        }

        await dashboardUserModel.updateStatus(usr.dashboard_user_id, true);
        bot.sendMessage(chatId, `✅ User ${usr.username} telah disetujui.`);

        // Send notification to user via WhatsApp
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
              `[TELEGRAM] Gagal mengirim notifikasi WA untuk ${usr.username}: ${err.message}`
            );
          }
        }
      } catch (err) {
        console.error('[TELEGRAM] Error saat approve user:', err);
        bot.sendMessage(chatId, `❌ Terjadi kesalahan: ${err.message}`);
      }
    });

    // Handle /deny command
    bot.onText(/\/deny (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const username = match[1]?.trim();

      // Check if admin
      if (String(chatId) !== adminChatId) {
        bot.sendMessage(chatId, '❌ Anda tidak memiliki akses untuk perintah ini.');
        return;
      }

      if (!username) {
        bot.sendMessage(chatId, '❌ Format salah! Gunakan: /deny <username>');
        return;
      }

      try {
        const usr = await dashboardUserModel.findByUsername(username);
        if (!usr) {
          bot.sendMessage(chatId, `❌ Username ${username} tidak ditemukan.`);
          return;
        }

        await dashboardUserModel.updateStatus(usr.dashboard_user_id, false);
        bot.sendMessage(chatId, `❌ User ${usr.username} telah ditolak.`);

        // Send notification to user via WhatsApp
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
              `[TELEGRAM] Gagal mengirim notifikasi WA untuk ${usr.username}: ${err.message}`
            );
          }
        }
      } catch (err) {
        console.error('[TELEGRAM] Error saat deny user:', err);
        bot.sendMessage(chatId, `❌ Terjadi kesalahan: ${err.message}`);
      }
    });

    // Error handling with exponential backoff
    bot.on('polling_error', (error) => {
      pollingErrorCount++;
      
      // Log the error with more details
      console.error(`[TELEGRAM] Polling error #${pollingErrorCount}:`, error.code || error.message);
      
      // Handle specific error types
      if (error.code === 'EFATAL' || error.code === 'ETELEGRAM') {
        console.error('[TELEGRAM] Fatal polling error detected:', error.message);
        
        // If too many errors and polling is still enabled, stop polling to prevent continuous errors
        if (pollingErrorCount >= MAX_POLLING_ERRORS && isPollingEnabled) {
          console.error(`[TELEGRAM] Too many polling errors (${pollingErrorCount}). Stopping polling to prevent continuous failures.`);
          console.error('[TELEGRAM] Please check: 1) Bot token is valid, 2) No other bot instance is running, 3) Network connectivity');
          isPollingEnabled = false;
          
          try {
            bot.stopPolling();
            console.log('[TELEGRAM] Polling stopped successfully');
          } catch (stopErr) {
            console.error('[TELEGRAM] Error stopping polling:', stopErr.message);
          }
          return; // Exit early to prevent further error handling
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.error('[TELEGRAM] Network connectivity issue. Will retry automatically.');
      }
      
      initError = error;
    });

    console.log('[TELEGRAM] Telegram bot initialized successfully');
    return true;
  } catch (err) {
    console.error('[TELEGRAM] Failed to initialize Telegram bot:', err);
    initError = err;
    isInitialized = false;
    return false;
  }
}

/**
 * Send approval request notification to Telegram admin
 * @param {Object} data - User data
 * @param {string} data.username - Username
 * @param {string} data.dashboard_user_id - User ID
 * @param {string} data.role - User role
 * @param {string} data.whatsapp - WhatsApp number
 * @param {Array<string>} data.clientIds - Client IDs
 */
export async function sendTelegramApprovalRequest(data) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!isBotInitialized() || !adminChatId) {
    console.warn('[TELEGRAM] Bot not initialized or admin chat ID not configured');
    return false;
  }

  // Validate chat ID format
  if (!isValidChatId(adminChatId)) {
    console.error(
      `[TELEGRAM] Invalid TELEGRAM_ADMIN_CHAT_ID format: "${adminChatId}". Must be a numeric chat ID.`
    );
    return false;
  }

  try {
    const message = `📋 Permintaan User Approval

Username: ${data.username}
ID: ${data.dashboard_user_id}
Role: ${data.role || '-'}
WhatsApp: ${data.whatsapp}
Client ID: ${data.clientIds?.length ? data.clientIds.join(', ') : '-'}

Gunakan perintah berikut untuk menyetujui atau menolak:
/approve ${data.username}
/deny ${data.username}`;

    await bot.sendMessage(adminChatId, message);
    console.log(`[TELEGRAM] Approval request sent for ${data.username}`);
    return true;
  } catch (err) {
    handleTelegramError(err, adminChatId, 'approval request');
    return false;
  }
}

/**
 * Send generic notification to Telegram admin
 * @param {string} message - Message to send
 */
export async function sendTelegramNotification(message) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!isBotInitialized() || !adminChatId) {
    return false;
  }

  // Validate chat ID format
  if (!isValidChatId(adminChatId)) {
    console.error(
      `[TELEGRAM] Invalid TELEGRAM_ADMIN_CHAT_ID format: "${adminChatId}". Must be a numeric chat ID.`
    );
    return false;
  }

  try {
    await bot.sendMessage(adminChatId, message);
    return true;
  } catch (err) {
    handleTelegramError(err, adminChatId, 'notification');
    return false;
  }
}

/**
 * Check if Telegram bot is initialized (regardless of polling status)
 */
export function isBotInitialized() {
  return isInitialized && bot !== null;
}

/**
 * Check if Telegram bot is enabled and polling is active
 */
export function isTelegramEnabled() {
  return isInitialized && bot !== null && isPollingEnabled;
}

/**
 * Get bot polling status
 */
export function getBotStatus() {
  return {
    isInitialized,
    isPollingEnabled,
    pollingErrorCount,
    hasBot: bot !== null,
    lastError: initError ? initError.message : null
  };
}

/**
 * Reset polling error count (for manual intervention)
 */
export function resetPollingErrors() {
  pollingErrorCount = 0;
  console.log('[TELEGRAM] Polling error count reset');
}

/**
 * Get bot instance (for testing purposes)
 */
export function getTelegramBot() {
  return bot;
}

/**
 * Stop the Telegram bot
 */
export function stopTelegramBot() {
  if (bot && isInitialized) {
    try {
      bot.stopPolling();
      isPollingEnabled = false;
      bot = null;
      isInitialized = false;
      pollingErrorCount = 0;
      console.log('[TELEGRAM] Telegram bot stopped');
    } catch (err) {
      console.error('[TELEGRAM] Error stopping bot:', err.message);
    }
  }
}

export default {
  initTelegramBot,
  sendTelegramApprovalRequest,
  sendTelegramNotification,
  isTelegramEnabled,
  isBotInitialized,
  getTelegramBot,
  stopTelegramBot,
  getBotStatus,
  resetPollingErrors
};
