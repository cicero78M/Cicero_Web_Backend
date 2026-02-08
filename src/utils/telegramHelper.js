/**
 * Telegram Helper Utilities
 * Provides helper functions for formatting and sending Telegram messages
 */

import {
  sendTelegramMessage,
  notifyAdmin,
  getAdminChatIds,
  isTelegramEnabled
} from '../service/telegramService.js';

/**
 * Escape HTML characters for Telegram HTML formatting
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a message with bold text
 * @param {string} text - Text to make bold
 * @returns {string} Formatted text
 */
export function bold(text) {
  return `<b>${escapeHtml(text)}</b>`;
}

/**
 * Format a message with italic text
 * @param {string} text - Text to make italic
 * @returns {string} Formatted text
 */
export function italic(text) {
  return `<i>${escapeHtml(text)}</i>`;
}

/**
 * Format a message with code text
 * @param {string} text - Text to format as code
 * @returns {string} Formatted text
 */
export function code(text) {
  return `<code>${escapeHtml(text)}</code>`;
}

/**
 * Send a safe message to a Telegram chat with error handling
 * @param {string|number} chatId - Chat ID
 * @param {string} message - Message text
 * @param {object} options - Additional options
 * @returns {Promise<boolean>} True if sent successfully
 */
export async function safeSendTelegramMessage(chatId, message, options = {}) {
  if (!isTelegramEnabled()) {
    console.warn('[TELEGRAM] Telegram not enabled. Message not sent.');
    return false;
  }

  if (!chatId) {
    console.warn('[TELEGRAM] No chat ID provided. Message not sent.');
    return false;
  }

  try {
    await sendTelegramMessage(chatId, message, options);
    return true;
  } catch (error) {
    console.error(`[TELEGRAM] Failed to send message to ${chatId}:`, error.message);
    return false;
  }
}

/**
 * Send a notification to all admin chats
 * @param {string} message - Notification message
 * @returns {Promise<boolean>} True if sent to at least one admin
 */
export async function sendAdminNotification(message) {
  if (!isTelegramEnabled()) {
    console.warn('[TELEGRAM] Telegram not enabled. Admin notification not sent.');
    return false;
  }

  const adminIds = getAdminChatIds();
  if (!adminIds.length) {
    console.warn('[TELEGRAM] No admin chat IDs configured. Notification not sent.');
    return false;
  }

  try {
    await notifyAdmin(message);
    return true;
  } catch (error) {
    console.error('[TELEGRAM] Failed to send admin notification:', error.message);
    return false;
  }
}

/**
 * Format a dashboard registration approval request
 * @param {object} user - Dashboard user object
 * @returns {string} Formatted message
 */
export function formatDashboardApprovalRequest(user) {
  return `
📋 ${bold('Permintaan User Approval')}

${bold('Username:')} ${escapeHtml(user.username)}
${bold('ID:')} ${code(user.dashboard_user_id)}
${bold('Role:')} ${escapeHtml(user.role || 'N/A')}
${bold('WhatsApp:')} ${escapeHtml(user.whatsapp || 'N/A')}

Balas ${code('approvedash#' + user.username)} untuk menyetujui
Atau ${code('denydash#' + user.username)} untuk menolak.
`.trim();
}

/**
 * Format a login notification message
 * @param {object} data - Login data
 * @returns {string} Formatted message
 */
export function formatLoginNotification(data) {
  const { type, username, userId, role, clientIds, time } = data;
  
  let icon = '🔑';
  let typeLabel = 'Login';
  
  if (type === 'penmas') typeLabel = 'Login Penmas';
  else if (type === 'dashboard') typeLabel = 'Login Dashboard';
  else if (type === 'user') typeLabel = 'Login User';
  else if (type === 'client') typeLabel = 'Login Client';
  
  let message = `${icon} ${bold(typeLabel)}\n\n`;
  
  if (username) {
    message += `${bold('Username:')} ${escapeHtml(username)}\n`;
  }
  
  if (userId) {
    message += `${bold('User ID:')} ${code(userId)}\n`;
  }
  
  if (role) {
    message += `${bold('Role:')} ${escapeHtml(role)}\n`;
  }
  
  if (clientIds && clientIds.length > 0) {
    message += `${bold('Client ID(s):')} ${escapeHtml(clientIds.join(', '))}\n`;
  }
  
  message += `${bold('Waktu:')} ${escapeHtml(time)}`;
  
  return message;
}

/**
 * Format a premium subscription request notification
 * @param {object} request - Premium request object
 * @returns {string} Formatted message
 */
export function formatPremiumRequestNotification(request) {
  return `
💎 ${bold('Permintaan Premium Subscription')}

${bold('User:')} ${escapeHtml(request.username)}
${bold('Client ID:')} ${code(request.client_id)}
${bold('Tier:')} ${escapeHtml(request.tier)}

Balas ${code('grantdashsub#' + request.username)} untuk menyetujui
Atau ${code('denydashsub#' + request.username)} untuk menolak.
`.trim();
}

/**
 * Format a password reset notification
 * @param {string} username - Username
 * @param {string} token - Reset token
 * @param {string} resetUrl - Reset URL
 * @returns {string} Formatted message
 */
export function formatPasswordResetNotification(username, token, resetUrl) {
  return `
🔐 ${bold('Reset Password Dashboard')}

${bold('Username:')} ${escapeHtml(username)}
${bold('Token:')} ${code(token)}

Silakan buka tautan berikut untuk mengatur ulang password Anda:
${escapeHtml(resetUrl)}

Token berlaku selama 15 menit.
`.trim();
}

/**
 * Format a generic error notification
 * @param {string} context - Error context
 * @param {Error} error - Error object
 * @returns {string} Formatted message
 */
export function formatErrorNotification(context, error) {
  return `
⚠️ ${bold('Error Notification')}

${bold('Context:')} ${escapeHtml(context)}
${bold('Error:')} ${code(error.message)}

${italic('Timestamp:')} ${escapeHtml(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))}
`.trim();
}

/**
 * Format a simple notification message
 * @param {string} icon - Emoji icon
 * @param {string} title - Notification title
 * @param {object} data - Key-value pairs of data to display
 * @returns {string} Formatted message
 */
export function formatSimpleNotification(icon, title, data) {
  let message = `${icon} ${bold(title)}\n\n`;
  
  for (const [key, value] of Object.entries(data)) {
    message += `${bold(key + ':')} ${escapeHtml(value)}\n`;
  }
  
  return message.trim();
}

export default {
  escapeHtml,
  bold,
  italic,
  code,
  safeSendTelegramMessage,
  sendAdminNotification,
  formatDashboardApprovalRequest,
  formatLoginNotification,
  formatPremiumRequestNotification,
  formatPasswordResetNotification,
  formatErrorNotification,
  formatSimpleNotification
};
