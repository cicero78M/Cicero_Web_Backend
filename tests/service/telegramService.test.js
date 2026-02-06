import { jest } from '@jest/globals';

describe('TelegramService - Chat ID Validation', () => {
  let telegramService;
  let mockBot;
  let originalEnv;

  beforeEach(async () => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset modules
    jest.resetModules();

    // Mock node-telegram-bot-api
    mockBot = {
      sendMessage: jest.fn().mockResolvedValue({}),
      onText: jest.fn(),
      on: jest.fn(),
      stopPolling: jest.fn(),
    };

    jest.unstable_mockModule('node-telegram-bot-api', () => ({
      default: jest.fn(() => mockBot),
    }));

    // Mock dependencies
    jest.unstable_mockModule('../../src/model/dashboardUserModel.js', () => ({
      findByUsername: jest.fn(),
      updateStatus: jest.fn(),
    }));

    jest.unstable_mockModule('../../src/utils/waHelper.js', () => ({
      formatToWhatsAppId: jest.fn(),
      safeSendMessage: jest.fn(),
    }));

    jest.unstable_mockModule('../../src/service/waService.js', () => ({
      default: {},
      waitForWaReady: jest.fn(),
    }));

    // Import after mocking
    telegramService = await import('../../src/service/telegramService.js');
  });

  afterEach(() => {
    // Restore env
    process.env = originalEnv;
    // Stop bot if initialized
    if (telegramService.isTelegramEnabled()) {
      telegramService.stopTelegramBot();
    }
  });

  describe('initTelegramBot', () => {
    test('should reject invalid chat ID format (non-numeric)', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = 'invalid-chat-id';

      const result = telegramService.initTelegramBot();

      expect(result).toBe(false);
      expect(telegramService.isTelegramEnabled()).toBe(false);
    });

    test('should accept valid positive numeric chat ID', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789';

      const result = telegramService.initTelegramBot();

      expect(result).toBe(true);
      expect(telegramService.isTelegramEnabled()).toBe(true);
    });

    test('should accept valid negative numeric chat ID (for groups)', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = '-123456789';

      const result = telegramService.initTelegramBot();

      expect(result).toBe(true);
      expect(telegramService.isTelegramEnabled()).toBe(true);
    });

    test('should return false when token is missing', () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789';

      const result = telegramService.initTelegramBot();

      expect(result).toBe(false);
    });

    test('should return false when chat ID is missing', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      delete process.env.TELEGRAM_ADMIN_CHAT_ID;

      const result = telegramService.initTelegramBot();

      expect(result).toBe(false);
    });
  });

  describe('sendTelegramApprovalRequest', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789';
      telegramService.initTelegramBot();
    });

    test('should send message when chat ID is valid', async () => {
      const userData = {
        username: 'testuser',
        dashboard_user_id: 'user123',
        role: 'admin',
        whatsapp: '628123456789',
        clientIds: ['CLIENT1', 'CLIENT2'],
      };

      const result = await telegramService.sendTelegramApprovalRequest(userData);

      expect(result).toBe(true);
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('testuser')
      );
    });

    test('should handle invalid chat ID format gracefully', async () => {
      // Stop and reinit with invalid chat ID
      telegramService.stopTelegramBot();
      process.env.TELEGRAM_ADMIN_CHAT_ID = 'invalid-id';
      telegramService.initTelegramBot();

      const userData = {
        username: 'testuser',
        dashboard_user_id: 'user123',
        role: 'admin',
        whatsapp: '628123456789',
        clientIds: [],
      };

      const result = await telegramService.sendTelegramApprovalRequest(userData);

      expect(result).toBe(false);
    });

    test('should handle chat not found error (400)', async () => {
      mockBot.sendMessage.mockRejectedValueOnce({
        response: {
          body: {
            error_code: 400,
            description: 'Bad Request: chat not found',
          },
        },
      });

      const userData = {
        username: 'testuser',
        dashboard_user_id: 'user123',
        role: 'admin',
        whatsapp: '628123456789',
        clientIds: [],
      };

      const result = await telegramService.sendTelegramApprovalRequest(userData);

      expect(result).toBe(false);
    });

    test('should return false when bot is not initialized', async () => {
      telegramService.stopTelegramBot();

      const userData = {
        username: 'testuser',
        dashboard_user_id: 'user123',
        role: 'admin',
        whatsapp: '628123456789',
        clientIds: [],
      };

      const result = await telegramService.sendTelegramApprovalRequest(userData);

      expect(result).toBe(false);
    });
  });

  describe('sendTelegramNotification', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789';
      telegramService.initTelegramBot();
    });

    test('should send notification when chat ID is valid', async () => {
      const message = 'Test notification';

      const result = await telegramService.sendTelegramNotification(message);

      expect(result).toBe(true);
      expect(mockBot.sendMessage).toHaveBeenCalledWith('123456789', message);
    });

    test('should handle invalid chat ID format gracefully', async () => {
      telegramService.stopTelegramBot();
      process.env.TELEGRAM_ADMIN_CHAT_ID = 'invalid-id';
      telegramService.initTelegramBot();

      const result = await telegramService.sendTelegramNotification('Test message');

      expect(result).toBe(false);
    });

    test('should handle chat not found error (400)', async () => {
      mockBot.sendMessage.mockRejectedValueOnce({
        response: {
          body: {
            error_code: 400,
            description: 'Bad Request: chat not found',
          },
        },
      });

      const result = await telegramService.sendTelegramNotification('Test message');

      expect(result).toBe(false);
    });
  });

  describe('Polling Error Handling', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789';
    });

    test('should initialize with polling error handling', () => {
      const result = telegramService.initTelegramBot();
      
      expect(result).toBe(true);
      expect(mockBot.on).toHaveBeenCalledWith('polling_error', expect.any(Function));
    });

    test('should track bot status correctly', () => {
      telegramService.initTelegramBot();
      const status = telegramService.getBotStatus();
      
      expect(status.isInitialized).toBe(true);
      expect(status.isPollingEnabled).toBe(true);
      expect(status.pollingErrorCount).toBe(0);
      expect(status.hasBot).toBe(true);
    });

    test('should reset polling errors after incrementing', () => {
      // Initialize bot
      telegramService.initTelegramBot();
      
      // Get the polling_error handler
      const pollingErrorHandler = mockBot.on.mock.calls.find(
        call => call[0] === 'polling_error'
      )?.[1];
      
      // Simulate a polling error
      if (pollingErrorHandler) {
        pollingErrorHandler({ code: 'ECONNREFUSED', message: 'Connection refused' });
      }
      
      // Verify error count increased
      let status = telegramService.getBotStatus();
      expect(status.pollingErrorCount).toBeGreaterThan(0);
      
      // Reset errors
      telegramService.resetPollingErrors();
      
      // Verify error count is reset
      status = telegramService.getBotStatus();
      expect(status.pollingErrorCount).toBe(0);
    });

    test('should distinguish between bot initialized and polling enabled', () => {
      telegramService.initTelegramBot();
      
      // Initially both should be true
      expect(telegramService.isBotInitialized()).toBe(true);
      expect(telegramService.isTelegramEnabled()).toBe(true);
      
      // Simulate 5 fatal errors to trigger auto-shutdown
      const pollingErrorHandler = mockBot.on.mock.calls.find(
        call => call[0] === 'polling_error'
      )?.[1];
      
      if (pollingErrorHandler) {
        for (let i = 0; i < 5; i++) {
          pollingErrorHandler({ code: 'EFATAL', message: 'Fatal error' });
        }
      }
      
      // Bot should still be initialized but polling should be disabled
      expect(telegramService.isBotInitialized()).toBe(true);
      expect(telegramService.isTelegramEnabled()).toBe(false);
    });
  });
});
