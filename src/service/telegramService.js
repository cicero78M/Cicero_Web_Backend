// src/service/telegramService.js

import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let botReady = false;
let isInitializing = false;

// Configuration constants
const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

/**
 * Rejection reason options shown to admin in Telegram
 */
export const REJECTION_REASONS = [
  'Penggunaan username dan role tidak sesuai',
  'Penggunaan username tidak sesuai',
  'Role tidak sesuai',
  'Wilayah tidak sesuai',
];

/**
 * Escape Markdown special characters for Telegram
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for Markdown parsing
 */
function escapeMarkdown(text) {
  if (!text) return '';
  
  // Convert to string if not already
  const str = String(text);
  
  // Escape special Markdown characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Note: We need to be careful with backslashes - escape them first
  return str
    .replace(/\\/g, '\\\\')  // Backslash must be escaped first
    .replace(/_/g, '\\_')     // Underscore
    .replace(/\*/g, '\\*')    // Asterisk
    .replace(/\[/g, '\\[')    // Left bracket
    .replace(/\]/g, '\\]')    // Right bracket
    .replace(/\(/g, '\\(')    // Left parenthesis
    .replace(/\)/g, '\\)')    // Right parenthesis
    .replace(/~/g, '\\~')     // Tilde
    .replace(/`/g, '\\`')     // Backtick
    .replace(/>/g, '\\>')     // Greater than
    .replace(/#/g, '\\#')     // Hash
    .replace(/\+/g, '\\+')    // Plus
    .replace(/-/g, '\\-')     // Minus
    .replace(/=/g, '\\=')     // Equal
    .replace(/\|/g, '\\|')    // Pipe
    .replace(/\{/g, '\\{')    // Left brace
    .replace(/\}/g, '\\}')    // Right brace
    .replace(/\./g, '\\.')    // Dot
    .replace(/!/g, '\\!');    // Exclamation mark
}

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
    
    // If parse error, retry without Markdown formatting
    if (error.message && error.message.includes("can't parse entities")) {
      console.warn(`[Telegram] Retrying message to ${chatId} without Markdown formatting`);
      try {
        // Remove parse_mode from options and retry
        const { parse_mode, ...optionsWithoutParseMode } = options;
        const result = await bot.sendMessage(chatId, message, optionsWithoutParseMode);
        console.log(`[Telegram] Message sent to ${chatId} (plain text)`);
        return result;
      } catch (retryError) {
        console.error(`[Telegram] Failed to send plain text message to ${chatId}:`, retryError.message);
        return null;
      }
    }
    
    return null;
  }
}

/**
 * Send a message to admin chat(s)
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<Array<object|null>>} Array of results for each admin chat
 */
export async function sendTelegramAdminMessage(message, options = {}) {
  const adminChatIds = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  
  if (adminChatIds.length === 0) {
    console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_ID not configured');
    return [];
  }

  // Send message to all admin chat IDs
  const results = await Promise.allSettled(
    adminChatIds.map(chatId => sendTelegramMessage(chatId, message, options))
  );
  
  // Log any failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[Telegram] Failed to send message to admin ${adminChatIds[index]}:`, result.reason);
    }
  });
  
  // Return array of successful results
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
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
  const { request_id, user_id, sender_name, account_number, bank_name } = requestData;
  
  let message = `🔔 *Permintaan Subscription Premium*\n\n`;
  message += `*User:* ${escapeMarkdown(String(user_id))}\n`;
  message += `*Nama:* ${escapeMarkdown(sender_name)}\n`;
  message += `*Rekening:* ${escapeMarkdown(account_number)}\n`;
  message += `*Bank:* ${escapeMarkdown(bank_name)}\n`;
  message += `*Request ID:* ${escapeMarkdown(String(request_id))}\n`;
  
  return sendTelegramAdminMessage(message);
}

/**
 * Format currency in Indonesian Rupiah
 * @param {number} amount - Amount to format
 * @returns {string}
 */
function formatCurrencyId(amount) {
  if (!amount) return 'Rp 0';
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch (err) {
    return `Rp ${amount}`;
  }
}

/**
 * Send dashboard premium request notification to admin via Telegram
 * @param {object} request - Premium request data
 * @returns {Promise<boolean>}
 */
export async function sendDashboardPremiumRequestNotification(request) {
  if (!request) return false;
  
  const commandUsername = request.username || request.dashboard_user_id || 'unknown';
  const paymentProofStatus = request.proof_url
    ? '✅ sudah upload bukti transfer'
    : '⚠️ belum upload bukti transfer';
  const paymentProofLink = request.proof_url || 'Belum upload bukti';
  
  let message = `📢 *Permintaan Akses Premium*\n\n`;
  message += `*User Dashboard:*\n`;
  message += `• Username: ${escapeMarkdown(commandUsername)}\n`;
  message += `• WhatsApp: ${escapeMarkdown(request.whatsapp || '-')}\n`;
  message += `• User ID: ${escapeMarkdown(String(request.dashboard_user_id || '-'))}\n\n`;
  
  message += `*Detail Permintaan:*\n`;
  message += `• Tier: ${escapeMarkdown(request.premium_tier || '-')}\n`;
  message += `• Client ID: ${escapeMarkdown(String(request.client_id || '-'))}\n`;
  message += `• Request Token: ${escapeMarkdown(request.request_token || '-')}\n`;
  message += `• Status Bukti: ${escapeMarkdown(paymentProofStatus)}\n\n`;
  
  message += `*Detail Transfer:*\n`;
  message += `• Bank: ${escapeMarkdown(request.bank_name || '-')}\n`;
  message += `• Nomor Rekening: ${escapeMarkdown(request.account_number || '-')}\n`;
  message += `• Nama Pengirim: ${escapeMarkdown(request.sender_name || '-')}\n`;
  message += `• Jumlah: ${escapeMarkdown(formatCurrencyId(request.transfer_amount))}\n`;
  
  if (request.proof_url) {
    // For URLs in Markdown, we need to escape the URL text but not the URL itself
    message += `• [Lihat Bukti Transfer](${paymentProofLink})\n`;
  }
  
  message += `\n*Request ID:* ${escapeMarkdown(String(request.request_id || '-'))}`;
  
  try {
    const result = await sendTelegramAdminMessage(message);
    return result !== null;
  } catch (err) {
    console.warn(
      `[Telegram] Failed to send dashboard premium request ${request.request_id}: ${err?.message || err}`
    );
    return false;
  }
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
async function processApproval(chatId, username) {
  try {
    const { findByUsername, updateStatus } = await import('../model/dashboardUserModel.js');
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
    
    // Check if user is already approved (status = true means approved)
    // Note: status = false means either pending or rejected (no distinction in DB)
    if (user.status) {
      await bot.sendMessage(
        chatId, 
        `✅ User "${escapeMarkdown(username)}" sudah disetujui sebelumnya.`
      );
      return;
    }
    
    // Approve user (set status to true)
    await updateStatus(user.dashboard_user_id, true);
    
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
async function processRejection(chatId, username) {
  try {
    const { findByUsername } = await import('../model/dashboardUserModel.js');
    
    // Find user by username
    const user = await findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId, 
        `❌ User dengan username "${escapeMarkdown(username)}" tidak ditemukan.`
      );
      return;
    }
    
    // Check if user is not approved (status = false means either pending or already rejected)
    if (!user.status) {
      await bot.sendMessage(
        chatId, 
        `✅ User "${escapeMarkdown(username)}" sudah ditolak sebelumnya.`
      );
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
async function finalizeRejection(chatId, username, reason) {
  try {
    const { findByUsername, updateStatus } = await import('../model/dashboardUserModel.js');
    const { sendRejectionEmail } = await import('./emailService.js');
    
    const user = await findByUsername(username);
    if (!user) {
      await bot.sendMessage(
        chatId,
        `❌ User dengan username "${escapeMarkdown(username)}" tidak ditemukan.`
      );
      return;
    }
    
    if (!user.status) {
      await bot.sendMessage(
        chatId,
        `✅ User "${escapeMarkdown(username)}" sudah ditolak sebelumnya.`
      );
      return;
    }
    
    // Reject user (set status to false)
    await updateStatus(user.dashboard_user_id, false);
    
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
    
    // Handle reject_reason:username:index callback
    if (data.startsWith('reject_reason:')) {
      const parts = data.split(':');
      // parts = ['reject_reason', ...usernameParts, index]
      const reasonIndex = parseInt(parts[parts.length - 1], 10);
      const username = parts.slice(1, parts.length - 1).join(':');
      
      if (!username || isNaN(reasonIndex) || reasonIndex < 0 || reasonIndex >= REJECTION_REASONS.length) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Data tidak valid',
          show_alert: true
        });
        return;
      }
      
      const reason = REJECTION_REASONS[reasonIndex];
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Memproses penolakan dengan alasan: ${reason}...`
      });
      
      await finalizeRejection(chatId, username, reason);
      
      // Edit the message to remove buttons
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: messageId }
        );
      } catch (err) {
        console.warn('[Telegram] Failed to remove inline keyboard:', err.message);
      }
      return;
    }
    
    // Parse callback data: "approve:username" or "deny:username"
    const colonIndex = data.indexOf(':');
    if (colonIndex === -1) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Data tidak valid',
        show_alert: true
      });
      return;
    }
    const action = data.slice(0, colonIndex);
    const username = data.slice(colonIndex + 1);
    
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
      // Edit the message to remove buttons
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: messageId }
        );
      } catch (err) {
        console.warn('[Telegram] Failed to remove inline keyboard:', err.message);
      }
    } else if (action === 'deny') {
      await processRejection(chatId, username);
      // Remove original buttons - rejection reason list will appear in new message
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: messageId }
        );
      } catch (err) {
        console.warn('[Telegram] Failed to remove inline keyboard:', err.message);
      }
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
  sendUserRejectionConfirmation,
  sendPremiumRequestNotification,
  sendDashboardPremiumRequestNotification,
  sendComplaintNotification,
  sendPasswordResetToken,
  sendPasswordResetFailureNotification,
  REJECTION_REASONS
};
