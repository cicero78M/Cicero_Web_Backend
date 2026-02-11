import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockUpdateStatus = jest.fn();
const mockSendTelegramMessage = jest.fn();
const mockSendUserApprovalConfirmation = jest.fn();
const mockSendUserRejectionConfirmation = jest.fn();

jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => ({
  findById: mockFindById,
  updateStatus: mockUpdateStatus
}));

jest.unstable_mockModule('../src/service/telegramService.js', () => ({
  sendTelegramMessage: mockSendTelegramMessage,
  sendUserApprovalConfirmation: mockSendUserApprovalConfirmation,
  sendUserRejectionConfirmation: mockSendUserRejectionConfirmation
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

test('rejectDashboardUser sends rejection message', async () => {
  mockFindById.mockResolvedValue({ dashboard_user_id: '1', username: 'user', telegram_chat_id: '123456' });
  mockUpdateStatus.mockResolvedValue({ dashboard_user_id: '1', status: false });
  mockSendTelegramMessage.mockResolvedValue({ ok: true });
  mockSendUserRejectionConfirmation.mockResolvedValue({ ok: true });

  const req = { dashboardUser: { role: 'admin' }, params: { id: '1' } };
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
