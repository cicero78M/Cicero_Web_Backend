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
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;

  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({
    createResetRequest: jest.fn(),
    findActiveByToken: jest.fn(),
    markTokenUsed: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimPasswordResetEmail: jest.fn(),
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

test('sukses request reset menyimpan token dan kirim notifikasi', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user1@cicero.id' });
  claimPasswordResetModel.createResetRequest.mockResolvedValue({ id: 1 });

  const req = { body: { nrp: '1', email: 'USER1@CICERO.ID' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(claimPasswordResetModel.createResetRequest).toHaveBeenCalledTimes(1);
  expect(emailService.sendClaimPasswordResetEmail).not.toHaveBeenCalled();
  expect(telegramService.sendTelegramAdminMessage).toHaveBeenCalledTimes(1);
});

test('email mismatch tetap respon netral dan tidak membuat token', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user1@cicero.id' });

  const req = { body: { nrp: '1', email: 'other@cicero.id' } };
  const res = createRes();

  await requestClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
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
