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

  it('sends pending dashboard user list to admin', async () => {
    const mockBot = { sendMessage: jest.fn() };
    const findPendingDashboardUsers = jest.fn().mockResolvedValue([
      {
        username: 'pending_user',
        dashboard_user_id: 'dash-1',
        role: 'operator',
        client_ids: ['JOMBANG', 'KEDIRI'],
        created_at: '2026-01-02T03:04:05.000Z',
      },
    ]);
    const buildDashboardPendingListMessage = jest.fn().mockReturnValue('pending-list-message');
    const handlers = createTelegramCommandHandlers({
      getBot: () => mockBot,
      isTelegramAdmin: () => true,
      processApproval: jest.fn(),
      processRejection: jest.fn(),
      processPremiumApproval: jest.fn(),
      processPremiumDenial: jest.fn(),
      handlePremiumPendingCommand: jest.fn(),
      findPendingDashboardUsers,
      buildDashboardPendingListMessage,
    });

    await handlers.handleDashPendingCommand({
      chat: { id: 'admin-chat' },
      text: '/dashpending',
    });

    expect(findPendingDashboardUsers).toHaveBeenCalledWith(20);
    expect(buildDashboardPendingListMessage).toHaveBeenCalledWith([
      expect.objectContaining({ username: 'pending_user' }),
    ]);
    expect(mockBot.sendMessage).toHaveBeenCalledWith('admin-chat', 'pending-list-message', {
      parse_mode: 'Markdown',
    });
  });

  it('rejects pending dashboard user list for non-admin', async () => {
    const mockBot = { sendMessage: jest.fn() };
    const findPendingDashboardUsers = jest.fn();
    const handlers = createTelegramCommandHandlers({
      getBot: () => mockBot,
      isTelegramAdmin: () => false,
      processApproval: jest.fn(),
      processRejection: jest.fn(),
      processPremiumApproval: jest.fn(),
      processPremiumDenial: jest.fn(),
      handlePremiumPendingCommand: jest.fn(),
      findPendingDashboardUsers,
      buildDashboardPendingListMessage: jest.fn(),
    });

    await handlers.handleDashPendingCommand({
      chat: { id: 'user-chat' },
      text: '/pendingdash',
    });

    expect(findPendingDashboardUsers).not.toHaveBeenCalled();
    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      'user-chat',
      '❌ Anda tidak memiliki akses ke sistem ini.',
    );
  });

});
