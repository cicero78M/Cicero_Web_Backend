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
    let bot = null;
    let botReady = false;
    let isInitializing = false;

    const botInstance = {
      on: jest.fn((event) => registrations.push(event)),
      startPolling: jest.fn(async () => {
        registrations.push('startPolling');
        if (launchError) throw launchError;
      }),
      stopPolling: jest.fn(),
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

    return { lifecycle, TelegramBot, botInstance, registrations };
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
      expect.stringContaining('Telegram code: 401'),
      launchError
    );

    botInstance.startPolling.mockResolvedValueOnce();
    await expect(lifecycle.initializeTelegramBot()).resolves.toBe(botInstance);
    expect(lifecycle.isTelegramReady()).toBe(true);
  });
});
