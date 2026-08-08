// tests/telegramService.test.js

import { jest } from '@jest/globals';

// Mock telegram adapter before importing telegramService
const mockSendMessage = jest.fn();
const mockOnText = jest.fn();
const mockOn = jest.fn();
const mockAnswerCallbackQuery = jest.fn();
const mockEditMessageReplyMarkup = jest.fn();
const mockStartPolling = jest.fn().mockResolvedValue(undefined);

const mockBot = {
  sendMessage: mockSendMessage,
  onText: mockOnText,
  on: mockOn,
  answerCallbackQuery: mockAnswerCallbackQuery,
  editMessageReplyMarkup: mockEditMessageReplyMarkup,
  startPolling: mockStartPolling
};

jest.unstable_mockModule('../src/service/telegramBotAdapter.js', () => ({
  default: jest.fn(() => mockBot)
}));

const {
  initializeTelegramBot,
  getTelegramBot,
  isTelegramReady,
  isTelegramAdmin,
  sendTelegramMessage,
  sendTelegramAdminMessage,
  sendLoginLogNotification,
  sendUserApprovalRequest,
  sendUserApprovalConfirmation,
  sendUserRejectionConfirmation
} = await import('../src/service/telegramService.js');
const { sendTelegramAdminMessage: sendTelegramAdminMessageHelper } = await import(
  '../src/service/telegram/adminNotifications.js'
);

describe('telegramService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initializeTelegramBot', () => {
    it('should skip initialization when no token provided', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const bot = await initializeTelegramBot();
      expect(bot).toBeNull();
    });

    it('should skip initialization when TELEGRAM_SERVICE_SKIP_INIT is true', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
      const bot = await initializeTelegramBot();
      expect(bot).toBeNull();
    });
  });

  describe('getTelegramBot', () => {
    it('should return bot instance', () => {
      const bot = getTelegramBot();
      expect(bot).toBeDefined();
    });
  });

  describe('isTelegramReady', () => {
    it('should return boolean indicating bot readiness', () => {
      const ready = isTelegramReady();
      expect(typeof ready).toBe('boolean');
    });
  });

  describe('isTelegramAdmin', () => {
    it('should return true for authorized chat ID', () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456,789012';
      expect(isTelegramAdmin('123456')).toBe(true);
      expect(isTelegramAdmin(123456)).toBe(true);
    });

    it('should return false for unauthorized chat ID', () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '123456';
      expect(isTelegramAdmin('999999')).toBe(false);
    });

    it('should handle negative chat IDs for groups', () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '-987654321';
      expect(isTelegramAdmin('-987654321')).toBe(true);
      expect(isTelegramAdmin(-987654321)).toBe(true);
    });

    it('should return false when no admin chat IDs configured', () => {
      delete process.env.TELEGRAM_ADMIN_CHAT_ID;
      expect(isTelegramAdmin('123456')).toBe(false);
    });
  });

  describe('sendTelegramMessage', () => {
    it('should skip sending when bot is not ready', async () => {
      process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
      const result = await sendTelegramMessage('123456', 'Test message');
      expect(result).toEqual({ chatId: '123456', status: 'bot_not_ready' });
    });

    it('should send message with markdown parse mode', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 1 });
      await initializeTelegramBot();

      const result = await sendTelegramMessage('123456', 'Test message');

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123456',
        'Test message',
        expect.objectContaining({ parse_mode: 'Markdown' })
      );
      expect(result).toEqual({
        chatId: '123456',
        status: 'sent',
        message: { message_id: 1 }
      });
    });

    it('should handle send errors gracefully', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockRejectedValue(new Error('Network error'));

      const result = await sendTelegramMessage('123456', 'Test message');

      expect(result).toEqual({
        chatId: '123456',
        status: 'failed',
        error: { code: 'SEND_FAILED', message: 'Telegram message delivery failed' }
      });
    });

    it('should retry without Markdown when entity parsing fails', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';

      // First call fails with parse error, second succeeds
      mockSendMessage
        .mockRejectedValueOnce(new Error("ETELEGRAM: 400 Bad Request: can't parse entities"))
        .mockResolvedValueOnce({ message_id: 1 });

      const result = await sendTelegramMessage('123456', 'Test message with (special) chars');

      // Should be called twice - once with Markdown, once without
      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      // First call with Markdown
      expect(mockSendMessage).toHaveBeenNthCalledWith(
        1,
        '123456',
        'Test message with (special) chars',
        expect.objectContaining({ parse_mode: 'Markdown' })
      );

      // Second call without parse_mode - verify parse_mode is not in the options
      const secondCallOptions = mockSendMessage.mock.calls[1][2];
      expect(secondCallOptions).not.toHaveProperty('parse_mode');

      expect(result).toEqual({
        chatId: '123456',
        status: 'sent',
        message: { message_id: 1 }
      });
    });

    it('should return a failed result if retry also fails', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';

      // Both calls fail
      mockSendMessage
        .mockRejectedValueOnce(new Error("ETELEGRAM: 400 Bad Request: can't parse entities"))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await sendTelegramMessage('123456', 'Test message');

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        chatId: '123456',
        status: 'failed',
        error: { code: 'SEND_FAILED', message: 'Telegram message delivery failed' }
      });
    });
  });

  describe('sendTelegramAdminMessage', () => {
    it('should return an empty summary when admin chat ID is not configured', async () => {
      delete process.env.TELEGRAM_ADMIN_CHAT_ID;
      const result = await sendTelegramAdminMessage('Admin message');
      expect(result).toEqual({
        totalTargets: 0,
        sentCount: 0,
        failedCount: 0,
        results: []
      });
    });

    it('should send message to single admin chat', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 2 });

      const result = await sendTelegramAdminMessage('Admin message');

      expect(mockSendMessage).toHaveBeenCalledWith(
        '987654',
        'Admin message',
        expect.any(Object)
      );
      expect(result).toEqual({
        totalTargets: 1,
        sentCount: 1,
        failedCount: 0,
        results: [{ chatId: '987654', status: 'sent', message: { message_id: 2 } }]
      });
    });

    it('should send message to multiple admin chats', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654,123456,789012';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 2 });

      const result = await sendTelegramAdminMessage('Admin message');

      expect(mockSendMessage).toHaveBeenCalledTimes(3);
      expect(mockSendMessage).toHaveBeenCalledWith('987654', 'Admin message', expect.any(Object));
      expect(mockSendMessage).toHaveBeenCalledWith('123456', 'Admin message', expect.any(Object));
      expect(mockSendMessage).toHaveBeenCalledWith('789012', 'Admin message', expect.any(Object));
      expect(result.totalTargets).toBe(3);
      expect(result.sentCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.results).toHaveLength(3);
    });

    it('should handle whitespace in chat IDs', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = ' 987654 , 123456 ';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 2 });

      const result = await sendTelegramAdminMessage('Admin message');

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledWith('987654', 'Admin message', expect.any(Object));
      expect(mockSendMessage).toHaveBeenCalledWith('123456', 'Admin message', expect.any(Object));
      expect(result).toMatchObject({ totalTargets: 2, sentCount: 2, failedCount: 0 });
    });

    it('should count a bot-not-ready delivery as failed', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      const sendMessage = jest.fn().mockResolvedValue({
        chatId: '987654',
        status: 'bot_not_ready'
      });

      const result = await sendTelegramAdminMessageHelper(sendMessage, 'Admin message');

      expect(result).toEqual({
        totalTargets: 1,
        sentCount: 0,
        failedCount: 1,
        results: [{ chatId: '987654', status: 'bot_not_ready' }]
      });
    });

    it('should count a fulfilled null result as failed without exposing the token', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'secret-bot-token';

      const result = await sendTelegramAdminMessageHelper(
        jest.fn().mockResolvedValue(null),
        'Admin message'
      );

      expect(result).toEqual({
        totalTargets: 1,
        sentCount: 0,
        failedCount: 1,
        results: [{
          chatId: '987654',
          status: 'failed',
          error: {
            code: 'INVALID_SEND_RESULT',
            message: 'Telegram message delivery failed'
          }
        }]
      });
      expect(JSON.stringify(result)).not.toContain(process.env.TELEGRAM_BOT_TOKEN);
    });
  });

  describe('sendLoginLogNotification', () => {
    it('should format and send login notification', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 3 });

      const logData = {
        username: 'testuser',
        role: 'operator',
        loginType: 'operator',
        loginSource: 'web',
        timestamp: new Date(),
        clientInfo: { label: 'Client ID', value: 'test-client' }
      };

      await sendLoginLogNotification(logData);

      expect(mockSendMessage).toHaveBeenCalled();
      const message = mockSendMessage.mock.calls[0][1];
      expect(message).toContain('Login Dashboard');
      expect(message).toContain('testuser');
      expect(message).toContain('operator');
    });

    it('should escape special characters in login notification', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 3 });

      const logData = {
        username: 'test_user-2024',
        role: 'operator',
        loginType: 'operator',
        loginSource: 'web',
        timestamp: new Date(),
        clientInfo: { label: 'Client (Test)', value: 'test-client_123' }
      };

      await sendLoginLogNotification(logData);

      expect(mockSendMessage).toHaveBeenCalled();
      const message = mockSendMessage.mock.calls[0][1];
      // Special characters should be escaped
      expect(message).toContain('test\\_user\\-2024');
      expect(message).toContain('Client \\(Test\\)');
    });
  });

  describe('sendUserApprovalRequest', () => {
    it('should format and send approval request with inline buttons', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 4 });

      const userData = {
        dashboard_user_id: 'user-123',
        username: 'newuser',
        whatsapp: '628123456789',
        email: 'test@example.com',
        role: 'operator'
      };

      await sendUserApprovalRequest(userData);

      expect(mockSendMessage).toHaveBeenCalled();
      const [chatId, message, options] = mockSendMessage.mock.calls[0];
      expect(message).toContain('Permintaan Registrasi Dashboard');
      expect(message).toContain('newuser');
      expect(message).toContain('/approvedash');
      expect(message).toContain('/denydash');

      // Check for inline keyboard
      expect(options.reply_markup).toBeDefined();
      expect(options.reply_markup.inline_keyboard).toBeDefined();
      expect(options.reply_markup.inline_keyboard[0]).toEqual([
        { text: '✅ Setujui', callback_data: 'approve:newuser' },
        { text: '❌ Tolak', callback_data: 'deny:newuser' }
      ]);
    });
  });

  describe('sendUserApprovalConfirmation', () => {
    it('should format and send approval confirmation', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 5 });

      const userData = { username: 'approveduser' };

      await sendUserApprovalConfirmation(userData);

      expect(mockSendMessage).toHaveBeenCalled();
      const message = mockSendMessage.mock.calls[0][1];
      expect(message).toContain('Registrasi Dashboard Disetujui');
      expect(message).toContain('approveduser');
    });
  });

  describe('sendUserRejectionConfirmation', () => {
    it('should format and send rejection confirmation', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 6 });

      const userData = { username: 'rejecteduser' };

      await sendUserRejectionConfirmation(userData);

      expect(mockSendMessage).toHaveBeenCalled();
      const message = mockSendMessage.mock.calls[0][1];
      expect(message).toContain('Registrasi Dashboard Ditolak');
      expect(message).toContain('rejecteduser');
    });
  });
});
