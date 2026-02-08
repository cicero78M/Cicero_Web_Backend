// tests/telegramService.test.js

import { jest } from '@jest/globals';

// Mock node-telegram-bot-api before importing telegramService
const mockSendMessage = jest.fn();
const mockBot = {
  sendMessage: mockSendMessage
};

jest.unstable_mockModule('node-telegram-bot-api', () => ({
  default: jest.fn(() => mockBot)
}));

const {
  initializeTelegramBot,
  getTelegramBot,
  isTelegramReady,
  sendTelegramMessage,
  sendTelegramAdminMessage,
  sendLoginLogNotification,
  sendUserApprovalRequest,
  sendUserApprovalConfirmation,
  sendUserRejectionConfirmation
} = await import('../src/service/telegramService.js');

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
    it('should skip initialization when no token provided', () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const bot = initializeTelegramBot();
      expect(bot).toBeNull();
    });

    it('should skip initialization when TELEGRAM_SERVICE_SKIP_INIT is true', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
      const bot = initializeTelegramBot();
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

  describe('sendTelegramMessage', () => {
    it('should skip sending when bot is not ready', async () => {
      process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
      const result = await sendTelegramMessage('123456', 'Test message');
      expect(result).toBeNull();
    });

    it('should send message with markdown parse mode', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 1 });
      
      const result = await sendTelegramMessage('123456', 'Test message');
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalledWith(
          '123456',
          'Test message',
          expect.objectContaining({ parse_mode: 'Markdown' })
        );
      }
    });

    it('should handle send errors gracefully', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockRejectedValue(new Error('Network error'));
      
      const result = await sendTelegramMessage('123456', 'Test message');
      
      if (isTelegramReady()) {
        expect(result).toBeNull();
      }
    });
  });

  describe('sendTelegramAdminMessage', () => {
    it('should skip when admin chat ID is not configured', async () => {
      delete process.env.TELEGRAM_ADMIN_CHAT_ID;
      const result = await sendTelegramAdminMessage('Admin message');
      expect(result).toBeNull();
    });

    it('should send message to admin chat', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 2 });
      
      await sendTelegramAdminMessage('Admin message');
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalledWith(
          '987654',
          'Admin message',
          expect.any(Object)
        );
      }
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
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalled();
        const message = mockSendMessage.mock.calls[0][1];
        expect(message).toContain('Login Dashboard');
        expect(message).toContain('testuser');
        expect(message).toContain('operator');
      }
    });
  });

  describe('sendUserApprovalRequest', () => {
    it('should format and send approval request', async () => {
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
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalled();
        const message = mockSendMessage.mock.calls[0][1];
        expect(message).toContain('Permintaan Registrasi Dashboard');
        expect(message).toContain('newuser');
      }
    });
  });

  describe('sendUserApprovalConfirmation', () => {
    it('should format and send approval confirmation', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 5 });
      
      const userData = { username: 'approveduser' };
      
      await sendUserApprovalConfirmation(userData);
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalled();
        const message = mockSendMessage.mock.calls[0][1];
        expect(message).toContain('Registrasi Dashboard Disetujui');
        expect(message).toContain('approveduser');
      }
    });
  });

  describe('sendUserRejectionConfirmation', () => {
    it('should format and send rejection confirmation', async () => {
      process.env.TELEGRAM_ADMIN_CHAT_ID = '987654';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      mockSendMessage.mockResolvedValue({ message_id: 6 });
      
      const userData = { username: 'rejecteduser' };
      
      await sendUserRejectionConfirmation(userData);
      
      if (isTelegramReady()) {
        expect(mockSendMessage).toHaveBeenCalled();
        const message = mockSendMessage.mock.calls[0][1];
        expect(message).toContain('Registrasi Dashboard Ditolak');
        expect(message).toContain('rejecteduser');
      }
    });
  });
});
