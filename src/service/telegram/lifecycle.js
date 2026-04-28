export function createTelegramLifecycle({
  TelegramBot,
  getBot,
  setBot,
  getBotReady,
  setBotReady,
  getIsInitializing,
  setIsInitializing,
  setupCommandHandlers,
  setupCallbackHandlers,
}) {
  function initializeTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || process.env.TELEGRAM_SERVICE_SKIP_INIT === 'true') {
      console.log('[Telegram] Bot initialization skipped (no token or skip flag set)');
      return null;
    }

    if (getIsInitializing()) {
      console.log('[Telegram] Bot initialization already in progress, skipping duplicate call');
      return getBot();
    }

    if (getBot() && getBotReady()) {
      console.log('[Telegram] Bot already initialized, returning existing instance');
      return getBot();
    }

    setIsInitializing(true);

    try {
      const existingBot = getBot();
      if (existingBot) {
        try {
          existingBot.stopPolling();
          console.log('[Telegram] Stopped existing bot polling');
        } catch (stopError) {
          console.warn('[Telegram] Error stopping existing bot:', stopError.message);
        }
      }

      const bot = new TelegramBot(token, {
        polling: {
          interval: 1000,
          autoStart: true,
          params: {
            timeout: 10,
          },
        },
      });

      setBot(bot);
      setBotReady(true);
      console.log('[Telegram] Bot initialized successfully (interactive mode with polling)');

      bot.on('polling_error', (error) => {
        console.error('[Telegram] Polling error:', error.message);

        const is409Conflict =
          (error.response && error.response.statusCode === 409) ||
          (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict'));

        if (is409Conflict) {
          console.warn('[Telegram] Detected 409 Conflict - another bot instance may be running');
          console.warn('[Telegram] Stopping this instance to prevent conflicts');

          setBotReady(false);

          try {
            bot.stopPolling();
            console.log('[Telegram] Polling stopped due to conflict');
          } catch (stopErr) {
            console.error('[Telegram] Error stopping polling:', stopErr.message);
          }
        }
      });

      setupCommandHandlers();
      setupCallbackHandlers();

      return bot;
    } catch (error) {
      console.error('[Telegram] Failed to initialize bot:', error.message);
      setBotReady(false);
      return null;
    } finally {
      setIsInitializing(false);
    }
  }

  function getTelegramBot() {
    return getBot();
  }

  function isTelegramReady() {
    return getBotReady() && getBot() !== null;
  }

  return {
    initializeTelegramBot,
    getTelegramBot,
    isTelegramReady,
  };
}
