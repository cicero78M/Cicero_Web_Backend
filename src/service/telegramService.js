// src/service/telegramService.js

import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let botReady = false;

/**
 * Initialize Telegram bot
 */
export function initializeTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  // Skip initialization if token is not provided or in test mode
  if (!token || process.env.TELEGRAM_SERVICE_SKIP_INIT === 'true') {
    console.log('[Telegram] Bot initialization skipped (no token or skip flag set)');
    return null;
  }

  try {
    bot = new TelegramBot(token, { polling: false });
    botReady = true;
    console.log('[Telegram] Bot initialized successfully (send-only mode)');
    return bot;
  } catch (error) {
    console.error('[Telegram] Failed to initialize bot:', error.message);
    return null;
  }
}

/**
 * Get the Telegram bot instance
 * @returns {TelegramBot|null}
 */
export function getTelegramBot() {
  return bot;
}

/**
 * Check if Telegram bot is ready
 * @returns {boolean}
 */
export function isTelegramReady() {
  return botReady && bot !== null;
}

/**
 * Send a message to a Telegram chat
 * @param {string|number} chatId - Chat ID or username
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<object|null>}
 */
export async function sendTelegramMessage(chatId, message, options = {}) {
  if (!isTelegramReady()) {
    console.warn('[Telegram] Bot not ready, skipping message');
    return null;
  }

  try {
    const result = await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      ...options
    });
    console.log(`[Telegram] Message sent to ${chatId}`);
    return result;
  } catch (error) {
    console.error(`[Telegram] Failed to send message to ${chatId}:`, error.message);
    return null;
  }
}

/**
 * Send a message to admin chat
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<object|null>}
 */
export async function sendTelegramAdminMessage(message, options = {}) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  
  if (!adminChatId) {
    console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_ID not configured');
    return null;
  }

  return sendTelegramMessage(adminChatId, message, options);
}

/**
 * Send login log notification to admin
 * @param {object} logData - Login log data
 * @returns {Promise<object|null>}
 */
export async function sendLoginLogNotification(logData) {
  const { username, role, loginType, loginSource, timestamp, clientInfo } = logData;
  
  const time = new Date(timestamp || Date.now()).toLocaleString('id-ID', { 
    timeZone: 'Asia/Jakarta' 
  });
  
  let message = `🔑 *Login Dashboard*\n\n`;
  message += `*Username:* ${username}\n`;
  if (role) message += `*Role:* ${role}\n`;
  if (clientInfo) message += `*${clientInfo.label}:* ${clientInfo.value}\n`;
  message += `*Tipe:* ${loginType}\n`;
  message += `*Sumber:* ${loginSource}\n`;
  message += `*Waktu:* ${time}`;
  
  return sendTelegramAdminMessage(message);
}

/**
 * Send dashboard user approval request notification
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserApprovalRequest(userData) {
  const { dashboard_user_id, username, whatsapp, email, role } = userData;
  
  let message = `📋 *Permintaan Registrasi Dashboard*\n\n`;
  message += `*User ID:* ${dashboard_user_id}\n`;
  message += `*Username:* ${username}\n`;
  if (whatsapp) message += `*WhatsApp:* ${whatsapp}\n`;
  if (email) message += `*Email:* ${email}\n`;
  if (role) message += `*Role:* ${role}\n`;
  message += `\n_Menunggu persetujuan admin_`;
  
  return sendTelegramAdminMessage(message);
}

/**
 * Send dashboard user approval confirmation
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserApprovalConfirmation(userData) {
  const { username } = userData;
  
  const message = `✅ *Registrasi Dashboard Disetujui*\n\n*Username:* ${username}`;
  
  return sendTelegramAdminMessage(message);
}

/**
 * Send dashboard user rejection confirmation
 * @param {object} userData - User data
 * @returns {Promise<object|null>}
 */
export async function sendUserRejectionConfirmation(userData) {
  const { username } = userData;
  
  const message = `❌ *Registrasi Dashboard Ditolak*\n\n*Username:* ${username}`;
  
  return sendTelegramAdminMessage(message);
}

// Initialize bot on module load
initializeTelegramBot();

export default {
  initializeTelegramBot,
  getTelegramBot,
  isTelegramReady,
  sendTelegramMessage,
  sendTelegramAdminMessage,
  sendLoginLogNotification,
  sendUserApprovalRequest,
  sendUserApprovalConfirmation,
  sendUserRejectionConfirmation
};
