import { Telegraf } from 'telegraf';

function toTelegramMessage(ctx) {
  return {
    message_id: ctx.message?.message_id,
    date: ctx.message?.date,
    chat: {
      id: ctx.chat?.id,
      type: ctx.chat?.type,
      title: ctx.chat?.title,
      username: ctx.chat?.username,
      first_name: ctx.chat?.first_name,
      last_name: ctx.chat?.last_name,
    },
    from: ctx.from
      ? {
          id: ctx.from.id,
          is_bot: ctx.from.is_bot,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          username: ctx.from.username,
          language_code: ctx.from.language_code,
        }
      : undefined,
    text: ctx.message?.text,
  };
}

function toCallbackQuery(ctx) {
  const cq = ctx.callbackQuery || {};
  return {
    id: cq.id,
    from: cq.from,
    message: cq.message,
    data: cq.data,
    chat_instance: cq.chat_instance,
  };
}

export default class TelegramBotAdapter {
  constructor(token, options = {}) {
    this.bot = new Telegraf(token);
    this.options = options;
    this.textHandlers = [];
    this.eventHandlers = {
      callback_query: [],
      polling_error: [],
    };
    this.started = false;

    this.bot.catch((error) => {
      this.emit('polling_error', error);
    });

    this.bot.on('text', async (ctx) => {
      const msg = toTelegramMessage(ctx);
      const text = msg.text || '';

      for (const { regex, handler } of this.textHandlers) {
        const match = text.match(regex);
        if (!match) continue;

        await handler(msg, match);
      }
    });

    this.bot.on('callback_query', async (ctx) => {
      const callbackQuery = toCallbackQuery(ctx);
      for (const handler of this.eventHandlers.callback_query) {
        await handler(callbackQuery);
      }
    });

    const autoStart = options?.polling?.autoStart !== false;
    if (autoStart) {
      this.startPolling();
    }
  }

  emit(event, payload) {
    const handlers = this.eventHandlers[event] || [];
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        // no-op
      }
    });
  }

  async startPolling() {
    if (this.started) return;
    try {
      await this.bot.launch();
      this.started = true;
    } catch (error) {
      this.emit('polling_error', error);
      throw error;
    }
  }

  stopPolling() {
    if (!this.started) return;
    this.bot.stop('stopPolling');
    this.started = false;
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }

    this.eventHandlers[event].push(handler);
  }

  onText(regex, handler) {
    this.textHandlers.push({ regex, handler });
  }

  sendMessage(chatId, text, options = {}) {
    return this.bot.telegram.sendMessage(chatId, text, options);
  }

  answerCallbackQuery(callbackQueryId, options = {}) {
    if (!options || typeof options !== 'object') {
      return this.bot.telegram.answerCbQuery(callbackQueryId);
    }

    const { text, ...rest } = options;
    return this.bot.telegram.answerCbQuery(callbackQueryId, text, rest);
  }

  editMessageReplyMarkup(replyMarkup, options = {}) {
    const chatId = options.chat_id;
    const messageId = options.message_id;

    return this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, replyMarkup);
  }
}
