import { jest } from '@jest/globals';

let registerClaimCredentials;
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
    setClaimCredentials: jest.fn(),
  }));
  jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({}));
  jest.unstable_mockModule('../src/service/emailService.js', () => ({
    sendClaimPasswordResetEmail: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/telegramService.js', () => ({
    sendTelegramAdminMessage: jest.fn(),
  }));

  ({ registerClaimCredentials } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
});

test('returns 400 when nrp or password is missing', async () => {
  const req = { body: { nrp: '1' } };
  const res = createRes();

  await registerClaimCredentials(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'nrp dan password wajib diisi',
  });
});

test('returns 404 when user is not found', async () => {
  userModel.findUserById.mockResolvedValue(null);
  const req = { body: { nrp: '1', password: 'Password1!' } };
  const res = createRes();

  await registerClaimCredentials(req, res, () => {});

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'NRP anda tidak terdaftar',
  });
  expect(userModel.setClaimCredentials).not.toHaveBeenCalled();
});
