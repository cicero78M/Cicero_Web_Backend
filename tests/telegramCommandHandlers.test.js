import { jest } from '@jest/globals';
import {
  createTelegramCommandHandlers,
  parseDashboardCommandText,
} from '../src/service/telegram/commandHandlers.js';

describe('telegram command handlers', () => {
  describe('parseDashboardCommandText', () => {
    it.each([
      ['/approvedash user1', 'approvedash', 'user1'],
      ['/approvedash#user1', 'approvedash', 'user1'],
      ['approvedash#user1', 'approvedash', 'user1'],
      ['/denydash user1', 'denydash', 'user1'],
      ['/denydash#user1', 'denydash', 'user1'],
      ['denydash#user1', 'denydash', 'user1'],
    ])('parses %s with command %s', (text, commandName, expectedUsername) => {
      expect(parseDashboardCommandText(text, commandName)).toBe(
        expectedUsername
      );
    });

    it('returns null for text that does not match the requested command', () => {
      expect(
        parseDashboardCommandText('/approvedashboard user1', 'approvedash')
      ).toBeNull();
      expect(
        parseDashboardCommandText('/denydash user1', 'approvedash')
      ).toBeNull();
    });
  });

  it('calls processApproval with username from legacy approvedash hash command', async () => {
    const mockBot = { sendMessage: jest.fn() };
    const processApproval = jest.fn();
    const handlers = createTelegramCommandHandlers({
      getBot: () => mockBot,
      isTelegramAdmin: () => true,
      processApproval,
      processRejection: jest.fn(),
      processPremiumApproval: jest.fn(),
      processPremiumDenial: jest.fn(),
      handlePremiumPendingCommand: jest.fn(),
    });

    await handlers.handleApproveDashCommand({
      chat: { id: 'chat-123' },
      text: 'approvedash#user1',
    });

    expect(processApproval).toHaveBeenCalledWith('chat-123', 'user1');
    expect(mockBot.sendMessage).not.toHaveBeenCalled();
  });

  it('registers explicit dashboard command patterns anchored to the beginning of text', () => {
    const mockBot = { onText: jest.fn() };
    const handlers = createTelegramCommandHandlers({
      getBot: () => mockBot,
      isTelegramAdmin: jest.fn(),
      processApproval: jest.fn(),
      processRejection: jest.fn(),
      processPremiumApproval: jest.fn(),
      processPremiumDenial: jest.fn(),
      handlePremiumPendingCommand: jest.fn(),
    });

    handlers.setupCommandHandlers();

    const approveRegex = mockBot.onText.mock.calls[0][0];
    const denyRegex = mockBot.onText.mock.calls[1][0];

    expect(approveRegex.test('approvedash#user1')).toBe(true);
    expect(approveRegex.test('/approvedash user1')).toBe(true);
    expect(approveRegex.test('x /approvedash user1')).toBe(false);
    expect(approveRegex.test('/approvedashboard user1')).toBe(false);
    expect(denyRegex.test('denydash#user1')).toBe(true);
    expect(denyRegex.test('/denydash user1')).toBe(true);
    expect(denyRegex.test('x /denydash user1')).toBe(false);
    expect(denyRegex.test('/denydashboard user1')).toBe(false);
  });
});
