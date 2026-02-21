import { jest } from '@jest/globals';

import {
  CHAKRANARAYANA_CLIENT_ID,
  CHAKRANARAYANA_MAIN_MENU_KEY,
  buildChakranarayanaDirektoratMenu,
  buildChakranarayanaJajaranMenu,
  handleDirrequestCommandEntrypoint,
} from '../../../src/handler/menu/dirRequestHandlers.js';

describe('dirRequestHandlers chakranarayana menu', () => {
  test('shows chakranarayana menu in main menu', async () => {
    const session = {};
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: 'dirrequest',
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });

    expect(session.step).toBe('dirrequest_main');
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      'chat-id',
      expect.stringContaining(`${CHAKRANARAYANA_MAIN_MENU_KEY}️⃣ chakranarayana`)
    );
  });

  test('shows Direktorat and Jajaran submenu options', async () => {
    const session = { step: 'dirrequest_main' };
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: CHAKRANARAYANA_MAIN_MENU_KEY,
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });

    expect(session.step).toBe('dirrequest_chakranarayana_submenu');
    expect(session.dirrequest_client_id).toBe(CHAKRANARAYANA_CLIENT_ID);
    expect(session.selected_client_id).toBe(CHAKRANARAYANA_CLIENT_ID);
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      'chat-id',
      expect.stringContaining('1️⃣ Direktorat')
    );
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      'chat-id',
      expect.stringContaining('2️⃣ Jajaran')
    );
  });

  test('renders Direktorat menu numbers in ascending order', () => {
    const text = buildChakranarayanaDirektoratMenu();
    expect(text).toContain('3. Menu Dirrequest 3');
    expect(text).toContain('53. Menu Dirrequest 53');

    const expectedOrder = [3, 6, 9, 46, 47, 50, 51, 53];
    const positions = expectedOrder.map((menuNumber) =>
      text.indexOf(`${menuNumber}. Menu Dirrequest ${menuNumber}`)
    );

    positions.forEach((position) => {
      expect(position).toBeGreaterThan(-1);
    });

    const sortedPositions = [...positions].sort((left, right) => left - right);
    expect(positions).toEqual(sortedPositions);
  });

  test('renders Jajaran menu numbers in ascending order', () => {
    const text = buildChakranarayanaJajaranMenu();
    const expectedOrder = [1, 48, 49];
    const positions = expectedOrder.map((menuNumber) =>
      text.indexOf(`${menuNumber}. Menu Dirrequest ${menuNumber}`)
    );

    positions.forEach((position) => {
      expect(position).toBeGreaterThan(-1);
    });

    const sortedPositions = [...positions].sort((left, right) => left - right);
    expect(positions).toEqual(sortedPositions);
  });

  test('maps Direktorat selection to existing dirrequest dispatcher', async () => {
    const session = { step: 'dirrequest_chakranarayana_direktorat' };
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };
    const dispatchDirrequestNumber = jest.fn().mockResolvedValue();

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: '46',
      waClient,
      dispatchDirrequestNumber,
    });

    expect(dispatchDirrequestNumber).toHaveBeenCalledWith(
      46,
      expect.objectContaining({
        session,
        chatId: 'chat-id',
        client_id: CHAKRANARAYANA_CLIENT_ID,
        clientId: CHAKRANARAYANA_CLIENT_ID,
      })
    );
  });

  test('maps Jajaran selection to existing dirrequest dispatcher', async () => {
    const session = { step: 'dirrequest_chakranarayana_jajaran' };
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };
    const dispatchDirrequestNumber = jest.fn().mockResolvedValue();

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: '48',
      waClient,
      dispatchDirrequestNumber,
    });

    expect(dispatchDirrequestNumber).toHaveBeenCalledWith(
      48,
      expect.objectContaining({
        session,
        chatId: 'chat-id',
        client_id: CHAKRANARAYANA_CLIENT_ID,
        clientId: CHAKRANARAYANA_CLIENT_ID,
      })
    );
  });

  test('accepts submenu label input and routes to the correct submenu', async () => {
    const session = { step: 'dirrequest_chakranarayana_submenu' };
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: 'direktorat',
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });

    expect(session.step).toBe('dirrequest_chakranarayana_direktorat');
  });

  test('handles invalid number, back and batal consistently', async () => {
    const session = { step: 'dirrequest_chakranarayana_jajaran' };
    const waClient = { sendMessage: jest.fn().mockResolvedValue() };

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: '99',
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });

    expect(waClient.sendMessage).toHaveBeenCalledWith(
      'chat-id',
      expect.stringContaining('Pilihan tidak valid')
    );

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: 'back',
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });
    expect(session.step).toBe('dirrequest_chakranarayana_submenu');

    await handleDirrequestCommandEntrypoint({
      session,
      chatId: 'chat-id',
      text: 'batal',
      waClient,
      dispatchDirrequestNumber: jest.fn(),
    });
    expect(session.step).toBe('main');
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      'chat-id',
      expect.stringContaining('dibatalkan')
    );
  });
});
