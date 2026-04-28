export function createTelegramCallbackHandlers({
  getBot,
  isTelegramAdmin,
  rejectionReasons,
  finalizeRejection,
  processPremiumApproval,
  processPremiumDenial,
  processApproval,
  processRejection,
}) {
  async function clearInlineKeyboard(chatId, messageId, warningMessage) {
    const bot = getBot();
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: messageId },
      );
    } catch (err) {
      console.warn(warningMessage, err.message);
    }
  }

  function setupCallbackHandlers() {
    const bot = getBot();
    if (!bot) return;

    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const data = callbackQuery.data;

      if (!isTelegramAdmin(chatId)) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Anda tidak memiliki akses ke sistem ini.',
          show_alert: true,
        });
        return;
      }

      if (data.startsWith('reject_reason:')) {
        const parts = data.split(':');
        const reasonIndex = parseInt(parts[parts.length - 1], 10);
        const username = parts.slice(1, parts.length - 1).join(':');

        if (!username || Number.isNaN(reasonIndex) || reasonIndex < 0 || reasonIndex >= rejectionReasons.length) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Data tidak valid',
            show_alert: true,
          });
          return;
        }

        const reason = rejectionReasons[reasonIndex];

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `Memproses penolakan dengan alasan: ${reason}...`,
        });

        await finalizeRejection(chatId, username, reason);
        await clearInlineKeyboard(chatId, messageId, '[Telegram] Failed to remove inline keyboard:');
        return;
      }

      if (data.startsWith('premium_approve:') || data.startsWith('premium_deny:')) {
        const [action, token] = data.split(':');
        if (!token) {
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Token tidak valid',
            show_alert: true,
          });
          return;
        }

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: action === 'premium_approve' ? 'Memproses approve premium...' : 'Memproses deny premium...',
        });

        if (action === 'premium_approve') {
          await processPremiumApproval(chatId, token);
        } else {
          await processPremiumDenial(chatId, token);
        }

        await clearInlineKeyboard(chatId, messageId, '[Telegram] Failed to remove premium inline keyboard:');
        return;
      }

      const colonIndex = data.indexOf(':');
      if (colonIndex === -1) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Data tidak valid',
          show_alert: true,
        });
        return;
      }

      const action = data.slice(0, colonIndex);
      const username = data.slice(colonIndex + 1);

      if (!username) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Data tidak valid',
          show_alert: true,
        });
        return;
      }

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Memproses ${action === 'approve' ? 'persetujuan' : 'penolakan'}...`,
      });

      if (action === 'approve') {
        await processApproval(chatId, username);
        await clearInlineKeyboard(chatId, messageId, '[Telegram] Failed to remove inline keyboard:');
      } else if (action === 'deny') {
        await processRejection(chatId, username);
        await clearInlineKeyboard(chatId, messageId, '[Telegram] Failed to remove inline keyboard:');
      }
    });

    console.log('[Telegram] Callback handlers registered');
  }

  return {
    setupCallbackHandlers,
  };
}
