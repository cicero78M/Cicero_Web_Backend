import { jest } from '@jest/globals';

let confirmClaimPasswordReset;
let userModel;
let claimPasswordResetModel;
let bcrypt;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(async () => {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-secret';

  jest.unstable_mockModule('bcrypt', () => ({
    default: {
      compare: jest.fn(),
      hash: jest.fn().mockResolvedValue('hashed-password'),
    },
  }));
  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
    setClaimCredentials: jest.fn(),
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
    sendTelegramAdminMessage: jest.fn(),
  }));

  ({ confirmClaimPasswordReset } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
  claimPasswordResetModel = await import('../src/model/claimPasswordResetModel.js');
  bcrypt = await import('bcrypt');
});

test('token invalid ditolak', async () => {
  const req = { body: { token: 'invalid-token', password: 'Password1!', confirmPassword: 'Password1!' } };
  const res = createRes();

  await confirmClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(400);
  expect(userModel.setClaimCredentials).not.toHaveBeenCalled();
});

test('token expired/used ditolak saat record tidak aktif', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ type: 'claim_password_reset', user_id: '1' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  claimPasswordResetModel.findActiveByToken.mockResolvedValue(null);

  const req = { body: { token, password: 'Password1!', confirmPassword: 'Password1!' } };
  const res = createRes();

  await confirmClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(400);
  expect(userModel.setClaimCredentials).not.toHaveBeenCalled();
});

test('password lemah ditolak', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ type: 'claim_password_reset', user_id: '1' }, process.env.JWT_SECRET, { expiresIn: '15m' });

  const req = { body: { token, password: 'weakpass', confirmPassword: 'weakpass' } };
  const res = createRes();

  await confirmClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(400);
  expect(claimPasswordResetModel.findActiveByToken).not.toHaveBeenCalled();
  expect(bcrypt.default.hash).not.toHaveBeenCalled();
});

test('confirm success update hash dan tandai token used', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ type: 'claim_password_reset', user_id: '1' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  claimPasswordResetModel.findActiveByToken.mockResolvedValue({ user_id: '1' });
  userModel.setClaimCredentials.mockResolvedValue({ user_id: '1' });
  claimPasswordResetModel.markTokenUsed.mockResolvedValue({ used_at: new Date().toISOString() });

  const req = { body: { token, password: 'Password1!', confirmPassword: 'Password1!' } };
  const res = createRes();

  await confirmClaimPasswordReset(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(200);
  expect(bcrypt.default.hash).toHaveBeenCalledWith('Password1!', 10);
  expect(userModel.setClaimCredentials).toHaveBeenCalledWith('1', { passwordHash: 'hashed-password' });
  expect(claimPasswordResetModel.markTokenUsed).toHaveBeenCalledWith(token);
});
