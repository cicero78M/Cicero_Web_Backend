import { jest } from '@jest/globals';

const mockSendMessage = jest.fn();
const mockOnText = jest.fn();
const mockOn = jest.fn();
const mockAnswerCallbackQuery = jest.fn();
const mockEditMessageReplyMarkup = jest.fn();
const mockFindByUsername = jest.fn();
const mockUpdateApprovalStatus = jest.fn();
const getEffectiveApprovalStatus = user => {
  if (user?.status === true || user?.approval_status === 'approved') return 'approved';
  if (user?.approval_status === 'rejected') return 'rejected';
  return 'pending';
};
const mockSendApprovalEmail = jest.fn();
const mockSendRejectionEmail = jest.fn();

const mockBot = {
  sendMessage: mockSendMessage,
  onText: mockOnText,
  on: mockOn,
  answerCallbackQuery: mockAnswerCallbackQuery,
  editMessageReplyMarkup: mockEditMessageReplyMarkup,
};

jest.unstable_mockModule('../src/service/telegramBotAdapter.js', () => ({
  default: jest.fn(() => mockBot),
}));

jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => ({
  findByUsername: mockFindByUsername,
  updateApprovalStatus: mockUpdateApprovalStatus,
  getEffectiveApprovalStatus,
}));

jest.unstable_mockModule('../src/service/emailService.js', () => ({
  sendApprovalEmail: mockSendApprovalEmail,
  sendRejectionEmail: mockSendRejectionEmail,
}));

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_ADMIN_CHAT_ID = 'admin-chat';

const {
  initializeTelegramBot,
  processApproval,
  processRejection,
  finalizeRejection,
} = await import('../src/service/telegramService.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  initializeTelegramBot();
});

test('processApproval approves only pending dashboard users', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'pending_user',
    approval_status: 'pending',
  });
  mockUpdateApprovalStatus.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    status: true,
    approval_status: 'approved',
  });

  await processApproval('admin-chat', 'pending_user');

  expect(mockUpdateApprovalStatus).toHaveBeenCalledWith('dash-1', 'approved', {
    onlyPending: true,
  });
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('berhasil disetujui'),
  );
});

test('processApproval sends user Telegram notification when telegram_chat_id exists', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'telegram_user',
    approval_status: 'pending',
    telegram_chat_id: 'user-chat-123',
  });
  mockUpdateApprovalStatus.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    status: true,
    approval_status: 'approved',
  });
  mockSendMessage.mockResolvedValue({ message_id: 10 });

  await processApproval('admin-chat', 'telegram_user');

  expect(mockSendMessage).toHaveBeenCalledWith(
    'user-chat-123',
    expect.stringContaining('Registrasi dashboard Anda telah disetujui.'),
    expect.objectContaining({ parse_mode: 'Markdown' }),
  );
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('Notifikasi telah dikirim ke Telegram user'),
  );
});

test('processApproval succeeds without user Telegram notification when telegram_chat_id is empty', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'no_telegram_user',
    approval_status: 'pending',
    telegram_chat_id: null,
  });
  mockUpdateApprovalStatus.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    status: true,
    approval_status: 'approved',
  });
  mockSendMessage.mockResolvedValue({ message_id: 11 });

  await processApproval('admin-chat', 'no_telegram_user');

  expect(mockSendMessage).not.toHaveBeenCalledWith(
    null,
    expect.any(String),
    expect.any(Object),
  );
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('User tidak memiliki Telegram chat ID terdaftar'),
  );
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('berhasil disetujui'),
  );
});

test('processApproval does not reapprove legacy active dashboard users', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-legacy',
    username: 'legacy_user',
    status: true,
    approval_status: 'pending',
  });

  await processApproval('admin-chat', 'legacy_user');

  expect(mockUpdateApprovalStatus).not.toHaveBeenCalled();
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('sudah disetujui sebelumnya'),
  );
});

test('processApproval does not approve rejected dashboard users', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'rejected_user',
    approval_status: 'rejected',
  });

  await processApproval('admin-chat', 'rejected_user');

  expect(mockUpdateApprovalStatus).not.toHaveBeenCalled();
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('sudah ditolak sebelumnya'),
  );
});

test('processRejection shows reason choices only for pending dashboard users', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'pending_user',
    approval_status: 'pending',
  });

  await processRejection('admin-chat', 'pending_user');

  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('Pilih alasan penolakan'),
    expect.objectContaining({ reply_markup: expect.any(Object) }),
  );
});

test('finalizeRejection rejects only pending dashboard users', async () => {
  mockFindByUsername.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    username: 'pending_user',
    approval_status: 'pending',
  });
  mockUpdateApprovalStatus.mockResolvedValue({
    dashboard_user_id: 'dash-1',
    status: false,
    approval_status: 'rejected',
  });

  await finalizeRejection('admin-chat', 'pending_user', 'Data tidak valid');

  expect(mockUpdateApprovalStatus).toHaveBeenCalledWith('dash-1', 'rejected', {
    onlyPending: true,
  });
  expect(mockSendMessage).toHaveBeenCalledWith(
    'admin-chat',
    expect.stringContaining('berhasil ditolak'),
  );
});
