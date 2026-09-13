import { jest } from '@jest/globals';

let requestClaimPasswordReset;
let userModel;
let claimPasswordResetModel;
let emailService;
let telegramService;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(async () => {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'test-user';
  process.env.SMTP_PASS = 'test-password';
  process.env.SMTP_FROM = 'test@example.com';

  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({
    createResetRequest: jest.fn(),
    findActiveByToken: jest.fn(),
    markTokenUsed: jest.fn(),
  }));
  jest.unstable_mockModule('../src/config/redis.js', () => ({
    default: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      ttl: jest.fn().mockResolvedValue(60),
    },
  }));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimRecoveryEmailConfirmation: jest.fn(),
    sendClaimPasswordResetEmail: jest.fn(),
    sendOtpEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/telegramService.js', () => ({
    sendTelegramAdminMessage: jest.fn().mockResolvedValue(undefined),
  }));

  ({ requestClaimPasswordReset } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
  claimPasswordResetModel = await import('../src/model/claimPasswordResetModel.js');
  emailService = await import('../src/service/emailService.js');
  telegramService = await import('../src/service/telegramService.js');
});

test('sukses request reset mengirim OTP ke email terverifikasi', async () => {
  userModel.findUserById.mockResolvedValue({
    user_id: '1',
    email: 'user1@cicero.id',
    email_verified_at: '2026-01-01T00:00:00.000Z',
  });

  const req = { body: { nrp: '1', email: 'USER1@CICERO.ID' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
  expect(emailService.sendClaimPasswordResetEmail).not.toHaveBeenCalled();
  expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
    'user1@cicero.id',
    expect.stringMatching(/^\d{6}$/),
  );
  expect(telegramService.sendTelegramAdminMessage).not.toHaveBeenCalled();
});

test('email input berbeda tetap mengirim OTP hanya ke email terverifikasi', async () => {
  userModel.findUserById.mockResolvedValue({
    user_id: '1',
    email: 'user1@cicero.id',
    email_verified_at: '2026-01-01T00:00:00.000Z',
  });

  const req = { body: { nrp: '1', email: 'other@cicero.id' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
  expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
    'user1@cicero.id',
    expect.stringMatching(/^\d{6}$/),
  );
  expect(telegramService.sendTelegramAdminMessage).not.toHaveBeenCalled();
});

test('user tidak ditemukan tetap respon netral dan tidak membuat token', async () => {
  userModel.findUserById.mockResolvedValue(null);

  const req = { body: { nrp: '999', email: 'user1@cicero.id' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
  expect(telegramService.sendTelegramAdminMessage).not.toHaveBeenCalled();
});
