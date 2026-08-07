import { jest } from '@jest/globals';

let getUserData;
let userModel;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(async () => {
  jest.resetModules();

  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
    findClaimProfileById: jest.fn(),
  }));
  jest.unstable_mockModule('bcrypt', () => ({
    default: {
      compare: jest.fn(),
    },
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({}));
  jest.unstable_mockModule('../src/config/redis.js', () => ({
    default: {},
  }));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimPasswordResetEmail: jest.fn(),
    sendOtpEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/telegramService.js', () => ({
    sendTelegramAdminMessage: jest.fn(),
  }));

  ({ getUserData } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
});

test('returns user data when nrp/password are valid', async () => {
  const bcrypt = (await import('bcrypt')).default;
  userModel.findUserById.mockResolvedValue({ user_id: '1', nama: 'Test', password_hash: 'hash' });
  userModel.findClaimProfileById.mockResolvedValue({
    user_id: '1',
    nama: 'Test',
    password_hash: 'must-not-leak',
    reset_token: 'must-not-leak',
  });
  bcrypt.compare.mockResolvedValue(true);

  const req = { body: { nrp: '1', password: 'Password1!' } };
  const res = createRes();

  await getUserData(req, res, () => {});

  expect(userModel.findUserById).toHaveBeenCalledWith('1');
  expect(userModel.findClaimProfileById).toHaveBeenCalledWith('1');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '1', nama: 'Test' },
  });
  const response = res.json.mock.calls[0][0];
  expect(response.data).not.toHaveProperty('password_hash');
  expect(response.data).not.toHaveProperty('reset_token');
});

test('returns 401 when credentials are invalid', async () => {
  const bcrypt = (await import('bcrypt')).default;
  userModel.findUserById.mockResolvedValue({ user_id: '1', password_hash: 'hash' });
  bcrypt.compare.mockResolvedValue(false);

  const req = { body: { nrp: '1', password: 'wrong' } };
  const res = createRes();

  await getUserData(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'NRP atau password tidak valid',
  });
});

test('returns 400 when nrp/password is missing', async () => {
  const req = { body: { nrp: '1' } };
  const res = createRes();

  await getUserData(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'nrp dan password wajib diisi',
  });
});
