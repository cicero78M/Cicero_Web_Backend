import {
  buildPremiumPendingListMessage,
  escapeMarkdown,
  formatCurrencyId,
} from './formatters.js';

export async function sendPremiumRequestNotification(sendAdminMessage, requestData) {
  const { request_id, user_id, sender_name, account_number, bank_name } = requestData;

  let message = `🔔 *Permintaan Subscription Premium*\n\n`;
  message += `*User:* ${escapeMarkdown(String(user_id))}\n`;
  message += `*Nama:* ${escapeMarkdown(sender_name)}\n`;
  message += `*Rekening:* ${escapeMarkdown(account_number)}\n`;
  message += `*Bank:* ${escapeMarkdown(bank_name)}\n`;
  message += `*Request ID:* ${escapeMarkdown(String(request_id))}\n`;

  return sendAdminMessage(message);
}

export async function sendDashboardPremiumRequestNotification(sendAdminMessage, request) {
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
    message += `• [Lihat Bukti Transfer](${paymentProofLink})\n`;
  }

  const requestToken = request.request_token || '-';
  message += `\n*Request ID:* ${escapeMarkdown(String(request.request_id || '-'))}\n`;
  message += `*Token:* \`${escapeMarkdown(requestToken)}\`\n\n`;
  message += `Gunakan tombol di bawah atau ketik:\n`;
  message += `\`/approvepremium ${escapeMarkdown(requestToken)}\` untuk menyetujui\n`;
  message += `\`/denypremium ${escapeMarkdown(requestToken)}\` untuk menolak`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve Premium', callback_data: `premium_approve:${requestToken}` },
        { text: '❌ Deny Premium', callback_data: `premium_deny:${requestToken}` },
      ],
    ],
  };

  try {
    const result = await sendAdminMessage(message, { reply_markup: inlineKeyboard });
    return result !== null;
  } catch (err) {
    console.warn(
      `[Telegram] Failed to send dashboard premium request ${request.request_id}: ${err?.message || err}`,
    );
    return false;
  }
}

export async function processPremiumApproval(sendBotMessage, chatId, token) {
  try {
    const { approveDashboardPremiumRequest } = await import('../dashboardPremiumRequestService.js');
    const result = await approveDashboardPremiumRequest(token, {
      actor: 'telegram_admin',
      channel: 'telegram',
    });
    const approvedRequest = result?.request;
    await sendBotMessage(
      chatId,
      `✅ Premium request berhasil disetujui.\n` +
        `• Token: \`${escapeMarkdown(token)}\`\n` +
        `• Username: ${escapeMarkdown(approvedRequest?.username || '-')}\n` +
        `• Tier: ${escapeMarkdown(approvedRequest?.premium_tier || 'premium')}`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendBotMessage(chatId, `❌ Gagal approve premium request: ${escapeMarkdown(err.message)}`);
  }
}

export async function processPremiumDenial(sendBotMessage, chatId, token) {
  try {
    const { denyDashboardPremiumRequest } = await import('../dashboardPremiumRequestService.js');
    const deniedRequest = await denyDashboardPremiumRequest(token, {
      actor: 'telegram_admin',
      channel: 'telegram',
      note: 'Denied via Telegram',
      metadata: { denied_via: 'telegram' },
    });

    await sendBotMessage(
      chatId,
      `✅ Premium request berhasil ditolak.\n` +
        `• Token: \`${escapeMarkdown(token)}\`\n` +
        `• Username: ${escapeMarkdown(deniedRequest?.username || '-')}`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendBotMessage(chatId, `❌ Gagal deny premium request: ${escapeMarkdown(err.message)}`);
  }
}

export async function handlePremiumPendingCommand(sendBotMessage, isTelegramAdmin, msg) {
  const chatId = msg.chat.id;
  if (!isTelegramAdmin(chatId)) {
    await sendBotMessage(chatId, '❌ Anda tidak memiliki akses ke sistem ini.');
    return;
  }
  try {
    const { listPendingDashboardPremiumRequests } = await import('../dashboardPremiumRequestService.js');
    const requests = await listPendingDashboardPremiumRequests(20);
    await sendBotMessage(chatId, buildPremiumPendingListMessage(requests), { parse_mode: 'Markdown' });
  } catch (err) {
    await sendBotMessage(chatId, `❌ Gagal mengambil premium pending: ${escapeMarkdown(err.message)}`);
  }
}
