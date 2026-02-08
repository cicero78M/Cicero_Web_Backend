// =======================
// IMPORTS & CONFIGURATION
// =======================
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { createTelegramClient } from './telegramAdapter.js';

// =======================
// TELEGRAM CLIENT SETUP
// =======================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ADMIN_CHAT_IDS = (process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

let telegramClient = null;
let isReady = false;
const readyPromises = [];
const messageQueue = new PQueue({ concurrency: 1 });
const adminNotificationQueue = [];

/**
 * Initialize Telegram client
 */
async function initializeTelegramClient() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN not configured. Telegram notifications disabled.');
    return null;
  }

  if (!TELEGRAM_ADMIN_CHAT_IDS.length) {
    console.warn('[TELEGRAM] TELEGRAM_ADMIN_CHAT_IDS not configured. Admin notifications will not be sent.');
  }

  try {
    console.log('[TELEGRAM] Initializing Telegram client...');
    telegramClient = await createTelegramClient(TELEGRAM_BOT_TOKEN);

    telegramClient.on('ready', (info) => {
      console.log(`[TELEGRAM] Client ready: @${info.username}`);
      isReady = true;
      
      // Resolve all waiting promises
      while (readyPromises.length > 0) {
        const resolve = readyPromises.shift();
        resolve();
      }
      
      // Send queued admin notifications
      flushAdminNotificationQueue();
    });

    telegramClient.on('message', handleIncomingMessage);

    telegramClient.on('error', (error) => {
      console.error('[TELEGRAM] Client error:', error.message);
      isReady = false;
    });

    telegramClient.on('disconnected', () => {
      console.log('[TELEGRAM] Client disconnected');
      isReady = false;
    });

    return telegramClient;
  } catch (error) {
    console.error('[TELEGRAM] Failed to initialize client:', error.message);
    return null;
  }
}

/**
 * Wait for Telegram client to be ready
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForTelegramReady(timeoutMs = 30000) {
  if (isReady) return;
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('[TELEGRAM] Timeout waiting for client to be ready'));
    }, timeoutMs);
    
    readyPromises.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Queue a message for sending
 * @param {string|number} chatId - Chat ID
 * @param {string} message - Message text
 * @param {object} options - Additional options
 */
export async function queueTelegramMessage(chatId, message, options = {}) {
  if (!telegramClient) {
    console.warn('[TELEGRAM] Client not initialized. Message not sent.');
    return;
  }

  return messageQueue.add(async () => {
    try {
      await telegramClient.sendMessage(chatId, message, options);
    } catch (error) {
      console.error(`[TELEGRAM] Failed to send message to ${chatId}:`, error.message);
    }
  });
}

/**
 * Queue admin notification
 * @param {string} message - Notification message
 */
export function queueAdminNotification(message) {
  adminNotificationQueue.push(message);
  
  if (isReady) {
    flushAdminNotificationQueue();
  } else {
    console.log('[TELEGRAM] Admin notification queued (client not ready)');
  }
}

/**
 * Send all queued admin notifications
 */
async function flushAdminNotificationQueue() {
  if (!TELEGRAM_ADMIN_CHAT_IDS.length) {
    console.warn('[TELEGRAM] No admin chat IDs configured');
    return;
  }

  while (adminNotificationQueue.length > 0) {
    const message = adminNotificationQueue.shift();
    
    for (const chatId of TELEGRAM_ADMIN_CHAT_IDS) {
      await queueTelegramMessage(chatId, message);
    }
  }
}

/**
 * Send message to admins
 * @param {string} message - Message text
 */
export async function notifyAdmin(message) {
  try {
    await waitForTelegramReady();
  } catch (err) {
    console.warn(`[TELEGRAM] Queueing admin notification: ${err.message}`);
    queueAdminNotification(message);
    return;
  }

  if (!TELEGRAM_ADMIN_CHAT_IDS.length) {
    console.warn('[TELEGRAM] No admin chat IDs configured');
    return;
  }

  for (const chatId of TELEGRAM_ADMIN_CHAT_IDS) {
    await queueTelegramMessage(chatId, message);
  }
}

/**
 * Send message to specific chat
 * @param {string|number} chatId - Chat ID
 * @param {string} message - Message text
 * @param {object} options - Additional options
 */
export async function sendTelegramMessage(chatId, message, options = {}) {
  if (!telegramClient || !isReady) {
    throw new Error('[TELEGRAM] Client not ready');
  }

  return await queueTelegramMessage(chatId, message, options);
}

/**
 * Handle incoming messages (for command processing)
 * @param {object} msg - Telegram message object
 */
async function handleIncomingMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const from = msg.from;

  console.log(`[TELEGRAM] Processing message from ${from.username || from.id}: ${text}`);

  // Check if sender is admin
  if (!TELEGRAM_ADMIN_CHAT_IDS.includes(chatId.toString())) {
    console.log(`[TELEGRAM] Ignoring message from non-admin chat: ${chatId}`);
    return;
  }

  // Handle approval commands
  if (text.startsWith('approvedash#')) {
    const username = text.substring('approvedash#'.length).trim();
    await handleDashboardApproval(chatId, username, 'approve');
  } else if (text.startsWith('denydash#')) {
    const username = text.substring('denydash#'.length).trim();
    await handleDashboardApproval(chatId, username, 'deny');
  } else if (text.startsWith('grantdashsub#')) {
    const username = text.substring('grantdashsub#'.length).trim();
    await handleDashboardSubscription(chatId, username, 'grant');
  } else if (text.startsWith('denydashsub#')) {
    const username = text.substring('denydashsub#'.length).trim();
    await handleDashboardSubscription(chatId, username, 'deny');
  } else if (text === '/start' || text === '/help') {
    await sendTelegramMessage(chatId, getHelpMessage());
  }
}

/**
 * Handle dashboard approval command
 * @param {number} chatId - Chat ID
 * @param {string} username - Username to approve/deny
 * @param {string} action - 'approve' or 'deny'
 */
async function handleDashboardApproval(chatId, username, action) {
  try {
    // Import the dashboard user model
    const { findByUsername, updateUser } = await import('../model/dashboardUserModel.js');
    
    const user = await findByUsername(username);
    if (!user) {
      await sendTelegramMessage(chatId, `❌ User ${username} tidak ditemukan`);
      return;
    }

    if (action === 'approve') {
      await updateUser(user.dashboard_user_id, { is_approved: true });
      await sendTelegramMessage(chatId, `✅ User ${username} telah disetujui`);
      
      // Notify user if they have a Telegram chat ID
      if (user.telegram_chat_id) {
        await sendTelegramMessage(
          user.telegram_chat_id,
          `✅ Akun dashboard Anda telah disetujui. Anda dapat login sekarang.`
        );
      }
    } else {
      await updateUser(user.dashboard_user_id, { is_approved: false });
      await sendTelegramMessage(chatId, `❌ User ${username} telah ditolak`);
      
      // Notify user if they have a Telegram chat ID
      if (user.telegram_chat_id) {
        await sendTelegramMessage(
          user.telegram_chat_id,
          `❌ Permintaan akun dashboard Anda telah ditolak.`
        );
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM] Error handling dashboard approval:`, error);
    await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
  }
}

/**
 * Handle dashboard subscription command
 * @param {number} chatId - Chat ID
 * @param {string} username - Username
 * @param {string} action - 'grant' or 'deny'
 */
async function handleDashboardSubscription(chatId, username, action) {
  try {
    const { findByUsername } = await import('../model/dashboardUserModel.js');
    
    const user = await findByUsername(username);
    if (!user) {
      await sendTelegramMessage(chatId, `❌ User ${username} tidak ditemukan`);
      return;
    }

    if (action === 'grant') {
      // Call the subscription service to grant premium
      const { grantPremium } = await import('./dashboardSubscriptionService.js');
      await grantPremium(user.dashboard_user_id);
      await sendTelegramMessage(chatId, `✅ Premium subscription granted untuk ${username}`);
    } else {
      await sendTelegramMessage(chatId, `❌ Premium subscription denied untuk ${username}`);
    }
  } catch (error) {
    console.error(`[TELEGRAM] Error handling subscription:`, error);
    await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
  }
}

/**
 * Get help message
 */
function getHelpMessage() {
  return `
🤖 <b>Cicero Telegram Bot - Admin Commands</b>

<b>Dashboard User Approval:</b>
• <code>approvedash#username</code> - Approve dashboard registration
• <code>denydash#username</code> - Deny dashboard registration

<b>Premium Subscription:</b>
• <code>grantdashsub#username</code> - Grant premium subscription
• <code>denydashsub#username</code> - Deny premium subscription

<b>Commands:</b>
• <code>/start</code> or <code>/help</code> - Show this help message
`;
}

/**
 * Get admin chat IDs
 */
export function getAdminChatIds() {
  return TELEGRAM_ADMIN_CHAT_IDS;
}

/**
 * Check if Telegram is enabled
 */
export function isTelegramEnabled() {
  return !!TELEGRAM_BOT_TOKEN;
}

// Initialize Telegram client on module load
const telegramClientPromise = initializeTelegramClient();

// Export the client (will be null if not configured)
export default telegramClient;
export { telegramClient, telegramClientPromise };
