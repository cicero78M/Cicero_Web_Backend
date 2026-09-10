import { jest } from '@jest/globals';

let requestClaimPasswordReset;
let confirmClaimRecoveryEmail;
let userModel;
let claimPasswordResetModel;
let emailService;
let redis;

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(async () => {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'test';
  process.env.SMTP_PASS = 'test';
  process.env.SMTP_FROM = 'test@cicero.id';
  process.env.CLAIM_PASSWORD_RESET_URL = 'https://claim.test/claim';

  const store = new Map();
  const redisMock = {
    get: jest.fn(async (key) => store.get(key) ?? null),
    getDel: jest.fn(async (key) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
    eval: jest.fn(async (_lua, options = {}) => {
      const key = options?.keys?.[0];
      const value = key ? (store.get(key) ?? null) : null;
      if (key) store.delete(key);
      return value;
    }),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
    ttl: jest.fn(async () => 60),
  };

  jest.unstable_mockModule('../src/config/redis.js', () => ({ default: redisMock }));
  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    updateVerifiedEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({
    createResetRequest: jest.fn(),
    findActiveByToken: jest.fn(),
    markTokenUsed: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimPasswordResetEmail: jest.fn(),
    sendClaimRecoveryEmailConfirmation: jest.fn(),
    sendOtpEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/telegramService.js', () => ({
    sendTelegramAdminMessage: jest.fn(),
  }));

  ({ requestClaimPasswordReset, confirmClaimRecoveryEmail } = await import(
    '../src/controller/claimController.js'
  ));
  userModel = await import('../src/model/userModel.js');
  claimPasswordResetModel = await import('../src/model/claimPasswordResetModel.js');
  emailService = await import('../src/service/emailService.js');
  redis = redisMock;
});

test('unverified account receives a one-time confirmation link at the new email', async () => {
  userModel.findUserById.mockResolvedValue({
    user_id: '1', email: 'old@example.com', email_verified_at: null,
  });
  const res = createRes();

  await requestClaimPasswordReset(
    { body: { nrp: '1', email: 'New@Example.com ' } }, res, jest.fn()
  );

  expect(emailService.sendClaimRecoveryEmailConfirmation).toHaveBeenCalledWith(
    'new@example.com', expect.any(String), expect.objectContaining({
      nrp: '1', expiryMinutes: 30,
      confirmationBaseUrl: 'https://claim.test/claim',
    })
  );
  expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
  expect(userModel.updateVerifiedEmail).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: expect.objectContaining({
      recovery_mode: 'email_confirmation',
      confirmation_required: true,
      email: 'new@example.com',
    }),
  });
});

test('verified account cannot switch recovery email and receives OTP at verified address', async () => {
  userModel.findUserById.mockResolvedValue({
    user_id: '1', email: 'verified@example.com',
    email_verified_at: '2026-09-01T00:00:00.000Z',
  });
  const res = createRes();

  await requestClaimPasswordReset(
    { body: { nrp: '1', email: 'attacker@example.com' } }, res, jest.fn()
  );

  expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
    'verified@example.com', expect.stringMatching(/^\d{6}$/)
  );
  expect(emailService.sendClaimRecoveryEmailConfirmation).not.toHaveBeenCalled();
  expect(
    [...redis.set.mock.calls].find(([key]) => String(key).startsWith('claim_reset_otp:'))
  ).toBeDefined();
});

test('confirmation verifies new email before issuing the reset token', async () => {
  const account = { user_id: '1', email: 'old@example.com', email_verified_at: null };
  userModel.findUserById.mockResolvedValue(account);
  userModel.updateVerifiedEmail.mockResolvedValue({
    ...account, email: 'new@example.com',
    email_verified_at: '2026-09-08T00:00:00.000Z',
  });
  const requestRes = createRes();
  await requestClaimPasswordReset(
    { body: { nrp: '1', email: 'new@example.com' } }, requestRes, jest.fn()
  );
  const confirmationToken = emailService.sendClaimRecoveryEmailConfirmation.mock.calls[0][1];
  const confirmRes = createRes();
  redis.getDel.mockImplementationOnce(async () => {
    throw new Error("ERR unknown command `GETDEL`");
  });

  await confirmClaimRecoveryEmail(
    { body: { token: confirmationToken } }, confirmRes, jest.fn()
  );

  expect(userModel.updateVerifiedEmail).toHaveBeenCalledWith('1', 'new@example.com');
  expect(claimPasswordResetModel.createResetRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: '1', deliveryTarget: 'new@example.com', resetToken: expect.any(String),
    })
  );
  expect(confirmRes.status).toHaveBeenCalledWith(200);
  expect(redis.eval).toHaveBeenCalledTimes(1);
  expect(confirmRes.json).toHaveBeenCalledWith({
    success: true,
    data: expect.objectContaining({ reset_token: expect.any(String), email_verified: true }),
  });

  const reusedRes = createRes();
  await confirmClaimRecoveryEmail(
    { body: { token: confirmationToken } }, reusedRes, jest.fn()
  );
  expect(reusedRes.status).toHaveBeenCalledWith(400);
  expect(claimPasswordResetModel.createResetRequest).toHaveBeenCalledTimes(1);
});

test('confirmation is denied if account became verified before link use', async () => {
  userModel.findUserById
    .mockResolvedValueOnce({ user_id: '1', email_verified_at: null })
    .mockResolvedValueOnce({
      user_id: '1', email: 'verified@example.com',
      email_verified_at: '2026-09-08T00:00:00.000Z',
    });
  const requestRes = createRes();
  await requestClaimPasswordReset(
    { body: { nrp: '1', email: 'new@example.com' } }, requestRes, jest.fn()
  );
  const confirmationToken = emailService.sendClaimRecoveryEmailConfirmation.mock.calls[0][1];
  const confirmRes = createRes();

  await confirmClaimRecoveryEmail(
    { body: { token: confirmationToken } }, confirmRes, jest.fn()
  );

  expect(confirmRes.status).toHaveBeenCalledWith(403);
  expect(userModel.updateVerifiedEmail).not.toHaveBeenCalled();
  expect(claimPasswordResetModel.createResetRequest).not.toHaveBeenCalled();
});

test('new recovery email cannot already belong to another account', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email_verified_at: null });
  userModel.findUserByEmail.mockResolvedValue({ user_id: '2' });
  const res = createRes();

  await requestClaimPasswordReset(
    { body: { nrp: '1', email: 'used@example.com' } }, res, jest.fn()
  );

  expect(res.status).toHaveBeenCalledWith(409);
  expect(emailService.sendClaimRecoveryEmailConfirmation).not.toHaveBeenCalled();
});
