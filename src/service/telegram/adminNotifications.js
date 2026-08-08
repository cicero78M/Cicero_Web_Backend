import { DEFAULT_TIMEZONE, escapeMarkdown } from './formatters.js';

export async function sendTelegramAdminMessage(sendTelegramMessage, message, options = {}) {
  const adminChatIds = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (adminChatIds.length === 0) {
    console.warn('[Telegram] TELEGRAM_ADMIN_CHAT_ID not configured');
    return {
      totalTargets: 0,
      sentCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const results = await Promise.allSettled(
    adminChatIds.map((chatId) => sendTelegramMessage(chatId, message, options)),
  );

  const deliveryResults = results.map((result, index) => {
    const chatId = adminChatIds[index];

    if (result.status === 'fulfilled' && result.value?.status === 'sent') {
      return result.value;
    }

    if (result.status === 'fulfilled' && result.value?.status === 'bot_not_ready') {
      return result.value;
    }

    console.error(`[Telegram] Failed to send message to admin ${chatId}`);
    return {
      chatId,
      status: 'failed',
      error: {
        code: result.status === 'rejected' ? 'SEND_REJECTED' : 'INVALID_SEND_RESULT',
        message: 'Telegram message delivery failed',
      },
    };
  });

  const sentCount = deliveryResults.filter((result) => result.status === 'sent').length;

  return {
    totalTargets: adminChatIds.length,
    sentCount,
    failedCount: adminChatIds.length - sentCount,
    results: deliveryResults,
  };
}

export function buildLoginLogNotificationMessage(logData) {
  const { username, role, loginType, loginSource, timestamp, clientInfo } = logData;
  const time = new Date(timestamp || Date.now()).toLocaleString('id-ID', {
    timeZone: DEFAULT_TIMEZONE,
  });

  let message = `🔑 *Login Dashboard*\n\n`;
  message += `*Username:* ${escapeMarkdown(username)}\n`;
  if (role) message += `*Role:* ${escapeMarkdown(role)}\n`;
  if (clientInfo) message += `*${escapeMarkdown(clientInfo.label)}:* ${escapeMarkdown(clientInfo.value)}\n`;
  message += `*Tipe:* ${escapeMarkdown(loginType)}\n`;
  message += `*Sumber:* ${escapeMarkdown(loginSource)}\n`;
  message += `*Waktu:* ${escapeMarkdown(time)}`;
  return message;
}

export async function sendLoginLogNotification(sendAdminMessage, logData) {
  return sendAdminMessage(buildLoginLogNotificationMessage(logData));
}

export function buildUserApprovalRequestMessage(userData) {
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

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Setujui', callback_data: `approve:${username}` },
        { text: '❌ Tolak', callback_data: `deny:${username}` },
      ],
    ],
  };

  return { message, options: { reply_markup: inlineKeyboard } };
}

export async function sendUserApprovalRequest(sendAdminMessage, userData) {
  const payload = buildUserApprovalRequestMessage(userData);
  return sendAdminMessage(payload.message, payload.options);
}

export async function sendUserApprovalConfirmation(sendAdminMessage, userData) {
  const { username } = userData;
  const message = `✅ *Registrasi Dashboard Disetujui*\n\n*Username:* ${escapeMarkdown(username)}`;
  return sendAdminMessage(message);
}

export async function sendUserRejectionConfirmation(sendAdminMessage, userData) {
  const { username } = userData;
  const message = `❌ *Registrasi Dashboard Ditolak*\n\n*Username:* ${escapeMarkdown(username)}`;
  return sendAdminMessage(message);
}

export async function sendPasswordResetFailureNotification(sendAdminMessage, message) {
  return sendAdminMessage(message);
}
