import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockUpdateStatus = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockSendUserApprovalConfirmation = jest.fn();
const mockSendUserRejectionConfirmation = jest.fn();
const mockSendApprovalEmail = jest.fn();
const mockSendRejectionEmail = jest.fn();

jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => ({
  findById: mockFindById,
  updateStatus: mockUpdateStatus
}));

jest.unstable_mockModule('../src/service/telegramService.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendUserApprovalConfirmation: mockSendUserApprovalConfirmation,
  sendUserRejectionConfirmation: mockSendUserRejectionConfirmation
}));

jest.unstable_mockModule('../src/service/emailService.js', () => ({
  sendApprovalEmail: mockSendApprovalEmail,
  sendRejectionEmail: mockSendRejectionEmail
}));

let controller;

beforeAll(async () => {
  controller = await import('../src/controller/dashboardUserController.js');
});

beforeEach(() => {
  mockFindById.mockReset();
  mockUpdateStatus.mockReset();
  mockSendTelegramMessage.mockReset();
  mockSendUserApprovalConfirmation.mockReset();
  mockSendUserRejectionConfirmation.mockReset();
  mockSendApprovalEmail.mockReset();
  mockSendRejectionEmail.mockReset();
});

test('approveDashboardUser sends approval message', async () => {
  mockFindById.mockResolvedValue({ dashboard_user_id: '1', username: 'user', telegram_chat_id: '123456' });
  mockUpdateStatus.mockResolvedValue({ dashboard_user_id: '1', status: true });
  mockSendTelegramMessage.mockResolvedValue({ ok: true });
  mockSendUserApprovalConfirmation.mockResolvedValue({ ok: true });

  const req = { dashboardUser: { role: 'admin' }, params: { id: '1' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await controller.approveDashboardUser(req, res, next);

  expect(mockUpdateStatus).toHaveBeenCalledWith('1', true);
  expect(mockSendTelegramMessage).toHaveBeenCalledWith(
    '123456',
    expect.stringContaining('disetujui')
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { dashboard_user_id: '1', status: true } });
});

test('approveDashboardUser sends approval email when email present', async () => {
  mockFindById.mockResolvedValue({ dashboard_user_id: '1', username: 'user', email: 'user@example.com' });
  mockUpdateStatus.mockResolvedValue({ dashboard_user_id: '1', status: true });
  mockSendUserApprovalConfirmation.mockResolvedValue({ ok: true });
  mockSendApprovalEmail.mockResolvedValue();

  const req = { dashboardUser: { role: 'admin' }, params: { id: '1' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await controller.approveDashboardUser(req, res, next);

  // Give the fire-and-forget promise time to resolve
  await new Promise(r => setTimeout(r, 10));

  expect(mockUpdateStatus).toHaveBeenCalledWith('1', true);
  expect(mockSendApprovalEmail).toHaveBeenCalledWith('user@example.com', 'user');
  expect(res.status).toHaveBeenCalledWith(200);
});

test('rejectDashboardUser sends rejection message', async () => {
  mockFindById.mockResolvedValue({ dashboard_user_id: '1', username: 'user', telegram_chat_id: '123456' });
  mockUpdateStatus.mockResolvedValue({ dashboard_user_id: '1', status: false });
  mockSendTelegramMessage.mockResolvedValue({ ok: true });
  mockSendUserRejectionConfirmation.mockResolvedValue({ ok: true });

  const req = { dashboardUser: { role: 'admin' }, params: { id: '1' }, body: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await controller.rejectDashboardUser(req, res, next);

  expect(mockUpdateStatus).toHaveBeenCalledWith('1', false);
  expect(mockSendTelegramMessage).toHaveBeenCalledWith(
    '123456',
    expect.stringContaining('ditolak')
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { dashboard_user_id: '1', status: false } });
});

test('rejectDashboardUser sends rejection email with reason when email present', async () => {
  mockFindById.mockResolvedValue({ dashboard_user_id: '1', username: 'user', email: 'user@example.com' });
  mockUpdateStatus.mockResolvedValue({ dashboard_user_id: '1', status: false });
  mockSendUserRejectionConfirmation.mockResolvedValue({ ok: true });
  mockSendRejectionEmail.mockResolvedValue();

  const req = {
    dashboardUser: { role: 'admin' },
    params: { id: '1' },
    body: { reason: 'Role tidak sesuai' }
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await controller.rejectDashboardUser(req, res, next);

  // Give the fire-and-forget promise time to resolve
  await new Promise(r => setTimeout(r, 10));

  expect(mockUpdateStatus).toHaveBeenCalledWith('1', false);
  expect(mockSendRejectionEmail).toHaveBeenCalledWith('user@example.com', 'user', 'Role tidak sesuai');
  expect(res.status).toHaveBeenCalledWith(200);
});
