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
  let handlersRegistered = false;

  function getTelegramErrorMessage(error) {
    return [error?.message, error?.response?.description]
      .filter(Boolean)
      .join(' ');
  }

  function getSafeTelegramErrorMessage(error, token) {
    const message = getTelegramErrorMessage(error) || 'Unknown Telegram error';

    return token ? message.split(token).join('[REDACTED]') : message;
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

    if (!token) {
      console.warn(
        '[Telegram] Bot unavailable: TELEGRAM_BOT_TOKEN is not configured'
      );
      return null;
    }

    if (getIsInitializing()) {
      console.log(
        '[Telegram] Bot initialization already in progress, skipping duplicate call'
      );
      return initializationPromise;
    }

    const skipPolling = process.env.TELEGRAM_SERVICE_SKIP_INIT === 'true';

    if (getBot() && (getBotReady() || skipPolling)) {
      if (skipPolling) {
        console.log(
          '[Telegram] Sending transport ready; polling intentionally disabled: TELEGRAM_SERVICE_SKIP_INIT=true'
        );
      }
      console.log(
        '[Telegram] Bot transport already initialized, returning existing instance'
      );
      return getBot();
    }

    initializationPromise = (async () => {
      setIsInitializing(true);

      try {
        let bot = getBot();
        if (!bot) {
          bot = new TelegramBot(token, {
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
              getSafeTelegramErrorMessage(error, token)
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
                  getSafeTelegramErrorMessage(stopErr, token)
                );
              }
            }
          });
        }

        if (skipPolling) {
          console.log(
            '[Telegram] Sending transport ready; polling intentionally disabled: TELEGRAM_SERVICE_SKIP_INIT=true'
          );
          return bot;
        }

        if (!handlersRegistered) {
          setupCommandHandlers();
          setupCallbackHandlers();
          handlersRegistered = true;
        }

        await bot.startPolling();
        setBotReady(true);
        console.log(
          '[Telegram] Bot initialized successfully (interactive mode with polling)'
        );

        return bot;
      } catch (error) {
        setBotReady(false);
        console.error(
          `[Telegram] Polling failed to start (Telegram code: ${getTelegramErrorCode(error)}):`,
          getSafeTelegramErrorMessage(error, token)
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
    return canSendTelegramMessages();
  }

  function canSendTelegramMessages() {
    return getBot() !== null;
  }

  function isTelegramPolling() {
    return getBotReady() && getBot() !== null;
  }

  return {
    initializeTelegramBot,
    getTelegramBot,
    isTelegramReady,
    canSendTelegramMessages,
    isTelegramPolling,
  };
}
