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
  let initializationPromise = null;

  function getTelegramErrorMessage(error) {
    return [error?.message, error?.response?.description]
      .filter(Boolean)
      .join(' ');
  }

  function getTelegramErrorCode(error) {
    const messageCode =
      getTelegramErrorMessage(error).match(/\b(\d{3})\b/)?.[1];

    return (
      error?.response?.error_code ??
      error?.code ??
      messageCode ??
      error?.response?.body?.error_code ??
      error?.response?.statusCode ??
      'UNKNOWN'
    );
  }

  function is409Conflict(error) {
    const errorCodes = [
      error?.response?.error_code,
      error?.code,
      // Backward compatibility for older adapters and test doubles.
      error?.response?.body?.error_code,
      error?.response?.statusCode,
      error?.statusCode,
    ];

    return (
      errorCodes.some((code) => Number(code) === 409) ||
      /\b409\b|409\s+Conflict/i.test(getTelegramErrorMessage(error))
    );
  }

  async function initializeTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || process.env.TELEGRAM_SERVICE_SKIP_INIT === 'true') {
      console.log(
        '[Telegram] Bot initialization skipped (no token or skip flag set)'
      );
      return null;
    }

    if (getIsInitializing()) {
      console.log(
        '[Telegram] Bot initialization already in progress, skipping duplicate call'
      );
      return initializationPromise;
    }

    if (getBot() && getBotReady()) {
      console.log(
        '[Telegram] Bot already initialized, returning existing instance'
      );
      return getBot();
    }

    initializationPromise = (async () => {
      setIsInitializing(true);

      try {
        const existingBot = getBot();
        if (existingBot) {
          try {
            existingBot.stopPolling();
            console.log('[Telegram] Stopped existing bot polling');
          } catch (stopError) {
            console.warn(
              '[Telegram] Error stopping existing bot:',
              stopError.message
            );
          }
        }

        const bot = new TelegramBot(token, {
          polling: {
            interval: 1000,
            autoStart: false,
            params: {
              timeout: 10,
            },
          },
        });

        setBot(bot);
        setBotReady(false);

        bot.on('polling_error', (error) => {
          console.error(
            `[Telegram] Polling error (Telegram code: ${getTelegramErrorCode(error)}):`,
            error
          );

          if (is409Conflict(error)) {
            console.warn(
              '[Telegram] 409 Conflict: this bot token is being used for polling by another process'
            );
            console.warn(
              '[Telegram] Ensure only one bot instance is active for this token, then restart the intended instance'
            );

            setBotReady(false);

            try {
              bot.stopPolling();
              console.log('[Telegram] Polling stopped due to conflict');
            } catch (stopErr) {
              console.error(
                '[Telegram] Error stopping polling:',
                stopErr.message
              );
            }
          }
        });

        setupCommandHandlers();
        setupCallbackHandlers();

        await bot.startPolling();
        setBotReady(true);
        console.log(
          '[Telegram] Bot initialized successfully (interactive mode with polling)'
        );

        return bot;
      } catch (error) {
        setBotReady(false);
        console.error(
          `[Telegram] Failed to initialize bot (Telegram code: ${getTelegramErrorCode(error)}):`,
          error
        );
        return null;
      } finally {
        setIsInitializing(false);
        initializationPromise = null;
      }
    })();

    return initializationPromise;
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
