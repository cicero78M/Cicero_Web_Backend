import { jest } from '@jest/globals';

let requestClaimPasswordReset;
let userModel;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('claim password reset request validation', () => {
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
  });

  test('returns 400 when nrp/email is missing', async () => {
    const req = { body: { nrp: '', email: '' } };
    const res = createRes();

    await requestClaimPasswordReset(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Permintaan reset password tidak valid. Periksa kembali data yang dimasukkan.',
    });
  });

  test('returns neutral success when user email does not match', async () => {
    userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user@example.com' });
    const req = { body: { nrp: '1', email: 'other@example.com' } };
    const res = createRes();

    await requestClaimPasswordReset(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        message:
          'Jika data valid dan terdaftar, instruksi reset password akan dikirim melalui kanal yang tersedia.',
      },
    });
  });
});
