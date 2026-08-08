import { jest } from '@jest/globals';

import { createTelegramLifecycle } from '../src/service/telegram/lifecycle.js';

describe('Telegram lifecycle', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: 'test-token',
    };
    delete process.env.TELEGRAM_SERVICE_SKIP_INIT;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function createHarness({ launchError } = {}) {
    const registrations = [];
    const eventHandlers = new Map();
    let bot = null;
    let botReady = false;
    let isInitializing = false;

    const botInstance = {
      started: false,
      on: jest.fn((event, handler) => {
        registrations.push(event);
        eventHandlers.set(event, handler);
      }),
      startPolling: jest.fn(async () => {
        registrations.push('startPolling');
        if (launchError) throw launchError;
        botInstance.started = true;
      }),
      stopPolling: jest.fn(() => {
        botInstance.started = false;
      }),
    };
    const TelegramBot = jest.fn(() => botInstance);
    const lifecycle = createTelegramLifecycle({
      TelegramBot,
      getBot: () => bot,
      setBot: (value) => {
        bot = value;
      },
      getBotReady: () => botReady,
      setBotReady: (value) => {
        botReady = value;
      },
      getIsInitializing: () => isInitializing,
      setIsInitializing: (value) => {
        isInitializing = value;
      },
      setupCommandHandlers: () => registrations.push('commands'),
      setupCallbackHandlers: () => registrations.push('callbacks'),
    });

    return {
      lifecycle,
      TelegramBot,
      botInstance,
      registrations,
      eventHandlers,
    };
  }

  it('registers every handler before polling starts', async () => {
    const { lifecycle, TelegramBot, botInstance, registrations } =
      createHarness();

    await expect(lifecycle.initializeTelegramBot()).resolves.toBe(botInstance);

    expect(TelegramBot).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        polling: expect.objectContaining({ autoStart: false }),
      })
    );
    expect(registrations).toEqual([
      'polling_error',
      'commands',
      'callbacks',
      'startPolling',
    ]);
    expect(lifecycle.isTelegramReady()).toBe(true);
  });

  it('remains not ready and can retry when launch is rejected', async () => {
    const launchError = Object.assign(new Error('Unauthorized'), {
      response: { body: { error_code: 401 } },
    });
    const { lifecycle, botInstance } = createHarness({ launchError });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(lifecycle.initializeTelegramBot()).resolves.toBeNull();

    expect(lifecycle.isTelegramReady()).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Polling failed to start (Telegram code: 401)'),
      'Unauthorized'
    );

    botInstance.startPolling.mockResolvedValueOnce();
    await expect(lifecycle.initializeTelegramBot()).resolves.toBe(botInstance);
    expect(lifecycle.isTelegramReady()).toBe(true);
  });

  it('logs distinct startup states without exposing the bot token', async () => {
    const { lifecycle } = createHarness();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(lifecycle.initializeTelegramBot()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Telegram] Bot unavailable: TELEGRAM_BOT_TOKEN is not configured'
    );

    process.env.TELEGRAM_BOT_TOKEN = 'secret-token-value';
    process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
    await expect(lifecycle.initializeTelegramBot()).resolves.toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      '[Telegram] Polling intentionally disabled: TELEGRAM_SERVICE_SKIP_INIT=true'
    );

    expect(
      JSON.stringify([...warnSpy.mock.calls, ...logSpy.mock.calls])
    ).not.toContain('secret-token-value');
  });

  it('redacts the token when polling startup fails', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'secret-token-value';
    const launchError = new Error(
      'request to https://api.telegram.org/botsecret-token-value/getMe failed'
    );
    const { lifecycle } = createHarness({ launchError });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(lifecycle.initializeTelegramBot()).resolves.toBeNull();

    const loggedOutput = JSON.stringify(errorSpy.mock.calls);
    expect(loggedOutput).toContain('[REDACTED]');
    expect(loggedOutput).not.toContain('secret-token-value');
  });

  it('stops polling and clears readiness for a Telegraf 409 conflict', async () => {
    const { lifecycle, botInstance, eventHandlers } = createHarness();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await lifecycle.initializeTelegramBot();
    expect(lifecycle.isTelegramReady()).toBe(true);
    expect(botInstance.started).toBe(true);

    eventHandlers.get('polling_error')({
      response: {
        error_code: 409,
        description: 'Conflict: terminated by other getUpdates request',
      },
    });

    expect(botInstance.stopPolling).toHaveBeenCalledTimes(1);
    expect(botInstance.started).toBe(false);
    expect(lifecycle.isTelegramReady()).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('only one bot instance is active')
    );
  });
});
