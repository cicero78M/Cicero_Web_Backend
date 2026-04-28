import { jest } from '@jest/globals';

let requestClaimPasswordReset;
let userModel;
let claimPasswordResetModel;
let sendTelegramAdminMessage;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(async () => {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret';

  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({
    createResetRequest: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimPasswordResetEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/telegramService.js', () => ({
    sendTelegramAdminMessage: jest.fn(),
  }));

  ({ requestClaimPasswordReset } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
  claimPasswordResetModel = await import('../src/model/claimPasswordResetModel.js');
  ({ sendTelegramAdminMessage } = await import('../src/service/telegramService.js'));
});

test('creates reset request when nrp and email match', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'User@Example.com' });

  const req = { body: { nrp: '1', email: 'user@example.com ' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(claimPasswordResetModel.createResetRequest).toHaveBeenCalledTimes(1);
  expect(sendTelegramAdminMessage).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: {
      message:
        'Jika data valid dan terdaftar, instruksi reset password akan dikirim melalui kanal yang tersedia.',
    },
  });
});

test('returns neutral success and skips reset creation when email does not match', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user@example.com' });

  const req = { body: { nrp: '1', email: 'other@example.com' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
});

test('returns 503 when database connection is unavailable', async () => {
  const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
  userModel.findUserById.mockRejectedValue(err);

  const req = { body: { nrp: '1', email: 'user@example.com' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Database tidak tersedia' });
});
