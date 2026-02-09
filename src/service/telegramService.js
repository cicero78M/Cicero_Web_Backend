// src/service/telegramService.js

import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let botReady = false;
let isInitializing = false;

// Configuration constants
const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

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

  // Prevent multiple simultaneous initializations (singleton pattern)
  if (isInitializing) {
    console.log('[Telegram] Bot initialization already in progress, skipping duplicate call');
    return bot;
  }
  
  // If bot is already initialized and polling, return existing instance
  if (bot && botReady) {
    console.log('[Telegram] Bot already initialized, returning existing instance');
    return bot;
  }

  isInitializing = true;

  try {
    // Stop existing bot if any to prevent conflicts
    if (bot) {
      try {
        bot.stopPolling();
        console.log('[Telegram] Stopped existing bot polling');
      } catch (stopError) {
        console.warn('[Telegram] Error stopping existing bot:', stopError.message);
      }
    }
    
    // Enable polling to receive messages and callbacks
    bot = new TelegramBot(token, { 
      polling: {
        interval: 1000,
        autoStart: true,
        params: {
          timeout: 10
        }
      }
    });
    
    botReady = true;
    console.log('[Telegram] Bot initialized successfully (interactive mode with polling)');
    
    // Set up polling error handler
    bot.on('polling_error', (error) => {
      console.error('[Telegram] Polling error:', error.message);
      
      // Handle 409 Conflict specifically
      // Check for HTTP 409 status or error message indicating conflict
      const is409Conflict = 
        (error.response && error.response.statusCode === 409) ||
        (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict'));
      
      if (is409Conflict) {
        console.warn('[Telegram] Detected 409 Conflict - another bot instance may be running');
        console.warn('[Telegram] Stopping this instance to prevent conflicts');
        
        // Set botReady to false first to prevent race conditions
        botReady = false;
        
        // Stop polling on this instance
        try {
          bot.stopPolling();
          console.log('[Telegram] Polling stopped due to conflict');
        } catch (stopErr) {
          console.error('[Telegram] Error stopping polling:', stopErr.message);
        }
      }
    });
    
    // Set up command and callback handlers
    setupCommandHandlers();
    setupCallbackHandlers();
    
    return bot;
  } catch (error) {
    console.error('[Telegram] Failed to initialize bot:', error.message);
    botReady = false;
    return null;
  } finally {
    isInitializing = false;
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
    timeZone: DEFAULT_TIMEZONE
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
 * Send dashboard user approval request notification with inline buttons
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
  message += `\n_Menunggu persetujuan admin_\n\n`;
  message += `Gunakan tombol di bawah atau ketik:\n`;
  message += `\`/approvedash ${username}\` untuk menyetujui\n`;
  message += `\`/denydash ${username}\` untuk menolak`;
  
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

/**
 * Handle /approvedash command
 * @param {object} msg - Telegram message object
 */
async function handleApproveDashCommand(msg) {
  const chatId = msg.chat.id;
  const username = msg.text.split(' ')[1];
  
  // Check if sender is admin
  if (!isTelegramAdmin(chatId)) {
    await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    return;
  }
  
  if (!username) {
    await bot.sendMessage(
      chatId, 
      '❌ Format salah. Gunakan: `/approvedash username`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await processApproval(chatId, username);
}

/**
 * Handle /denydash command
 * @param {object} msg - Telegram message object
 */
async function handleDenyDashCommand(msg) {
  const chatId = msg.chat.id;
  const username = msg.text.split(' ')[1];
  
  // Check if sender is admin
  if (!isTelegramAdmin(chatId)) {
    await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    return;
  }
  
  if (!username) {
    await bot.sendMessage(
      chatId, 
      '❌ Format salah. Gunakan: `/denydash username`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await processRejection(chatId, username);
}

/**
 * Send WhatsApp notification to user and return status
 * @param {object} user - User object with whatsapp field
 * @param {string} message - Message to send
 * @returns {Promise<object>} - Object with userNotified boolean and userNotificationError string
 */
async function sendUserWhatsAppNotification(user, message) {
  const result = {
    userNotified: false,
    userNotificationError: null
  };

  if (!user.whatsapp) {
    return result;
  }

  try {
    const { formatToWhatsAppId, safeSendMessage } = await import('../utils/waHelper.js');
    const { default: waClient, waitForWaReady } = await import('./waService.js');
    
    await waitForWaReady();
    const wid = formatToWhatsAppId(user.whatsapp);
    const sent = await safeSendMessage(waClient, wid, message);
    
    result.userNotified = sent !== false;
    if (!result.userNotified) {
      result.userNotificationError = 'WhatsApp message send returned false';
    }
  } catch (err) {
    console.error(`[Telegram->WA] Failed to notify user ${user.username}:`, err.message);
    result.userNotificationError = err.message;
  }

  return result;
}

/**
 * Build confirmation message with notification status
 * @param {string} baseMessage - Base confirmation message
 * @param {object} user - User object with whatsapp field
 * @param {boolean} userNotified - Whether user was notified
 * @param {string|null} userNotificationError - Error message if notification failed
 * @returns {string} - Complete confirmation message
 */
function buildConfirmationMessage(baseMessage, user, userNotified, userNotificationError) {
  let confirmationMessage = baseMessage;
  
  if (user.whatsapp) {
    if (userNotified) {
      confirmationMessage += `\n✅ Notifikasi telah dikirim ke ${user.whatsapp}`;
    } else {
      confirmationMessage += `\n⚠️ Notifikasi ke ${user.whatsapp} gagal dikirim`;
      if (userNotificationError) {
        confirmationMessage += `\nAlasan: ${userNotificationError}`;
      }
    }
  } else {
    confirmationMessage += `\n⚠️ User tidak memiliki nomor WhatsApp terdaftar`;
  }
  
  return confirmationMessage;
}

/**
 * Process user approval
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} username - Username to approve
 */
async function processApproval(chatId, username) {
  try {
    const { default: dashboardUserModel } = await import('../model/dashboardUserModel.js');
    
    // Find user by username
    const user = await dashboardUserModel.findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId, 
        `❌ User dengan username "${username}" tidak ditemukan.`
      );
      return;
    }
    
    // Check if user is already approved (status = true means approved)
    // Note: status = false means either pending or rejected (no distinction in DB)
    if (user.status) {
      await bot.sendMessage(
        chatId, 
        `✅ User "${username}" sudah disetujui sebelumnya.`
      );
      return;
    }
    
    // Approve user (set status to true)
    await dashboardUserModel.updateStatus(user.dashboard_user_id, true);
    
    // Send notification to user via WhatsApp if available
    const { userNotified, userNotificationError } = await sendUserWhatsAppNotification(
      user,
      `✅ Registrasi dashboard Anda telah disetujui.\nUsername: ${user.username}`
    );
    
    // Send confirmation to admin via Telegram with notification status
    const confirmationMessage = buildConfirmationMessage(
      `✅ User "${username}" berhasil disetujui.`,
      user,
      userNotified,
      userNotificationError
    );
    
    await bot.sendMessage(chatId, confirmationMessage);
    
  } catch (err) {
    console.error('[Telegram] Error handling approve command:', err);
    await bot.sendMessage(
      chatId, 
      `❌ Terjadi kesalahan: ${err.message}`
    );
  }
}

/**
 * Process user rejection
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} username - Username to reject
 */
async function processRejection(chatId, username) {
  try {
    const { default: dashboardUserModel } = await import('../model/dashboardUserModel.js');
    
    // Find user by username
    const user = await dashboardUserModel.findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId, 
        `❌ User dengan username "${username}" tidak ditemukan.`
      );
      return;
    }
    
    // Check if user is not approved (status = false means either pending or already rejected)
    // Note: The system doesn't distinguish between pending and rejected states
    // Both have status = false, only approved users have status = true
    if (!user.status) {
      await bot.sendMessage(
        chatId, 
        `✅ User "${username}" sudah ditolak sebelumnya.`
      );
      return;
    }
    
    // Reject user (set status to false)
    await dashboardUserModel.updateStatus(user.dashboard_user_id, false);
    
    // Send notification to user via WhatsApp if available
    const { userNotified, userNotificationError } = await sendUserWhatsAppNotification(
      user,
      `❌ Registrasi dashboard Anda ditolak.\nUsername: ${user.username}`
    );
    
    // Send confirmation to admin via Telegram with notification status
    const confirmationMessage = buildConfirmationMessage(
      `✅ User "${username}" berhasil ditolak.`,
      user,
      userNotified,
      userNotificationError
    );
    
    await bot.sendMessage(chatId, confirmationMessage);
    
  } catch (err) {
    console.error('[Telegram] Error handling deny command:', err);
    await bot.sendMessage(
      chatId, 
      `❌ Terjadi kesalahan: ${err.message}`
    );
  }
}

/**
 * Setup command handlers for the bot
 */
function setupCommandHandlers() {
  if (!bot) return;
  
  // Handle /approvedash command
  bot.onText(/\/approvedash/, handleApproveDashCommand);
  
  // Handle /denydash command
  bot.onText(/\/denydash/, handleDenyDashCommand);
  
  // Handle /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (isTelegramAdmin(chatId)) {
      await bot.sendMessage(
        chatId,
        'Selamat datang di Cicero Admin Bot!\n\n' +
        'Perintah yang tersedia:\n' +
        '/approvedash <username> - Setujui registrasi user\n' +
        '/denydash <username> - Tolak registrasi user'
      );
    } else {
      await bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    }
  });
  
  console.log('[Telegram] Command handlers registered');
}

/**
 * Setup callback query handlers for inline buttons
 */
function setupCallbackHandlers() {
  if (!bot) return;
  
  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    // Check if sender is admin
    if (!isTelegramAdmin(chatId)) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Anda tidak memiliki akses ke sistem ini.',
        show_alert: true
      });
      return;
    }
    
    // Parse callback data: "approve:username" or "deny:username"
    const [action, username] = data.split(':');
    
    if (!username) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Data tidak valid',
        show_alert: true
      });
      return;
    }
    
    // Answer callback query immediately
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `Memproses ${action === 'approve' ? 'persetujuan' : 'penolakan'}...`
    });
    
    // Process the action
    if (action === 'approve') {
      await processApproval(chatId, username);
    } else if (action === 'deny') {
      await processRejection(chatId, username);
    }
    
    // Edit the message to remove buttons
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId }
      );
    } catch (err) {
      console.warn('[Telegram] Failed to remove inline keyboard:', err.message);
    }
  });
  
  console.log('[Telegram] Callback handlers registered');
}

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
  sendUserRejectionConfirmation
};
