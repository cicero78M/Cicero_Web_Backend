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
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test';
    process.env.SMTP_PASS = 'test';

    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      findUserById: jest.fn(),
      findUserByEmail: jest.fn().mockResolvedValue(null),
    }));
    jest.unstable_mockModule('../src/config/redis.js', () => ({
      default: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        ttl: jest.fn().mockResolvedValue(60),
      },
    }));
    jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({
      createResetRequest: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/emailService.js', () => ({
      sendClaimPasswordResetEmail: jest.fn(),
      sendClaimRecoveryEmailConfirmation: jest.fn(),
      sendOtpEmail: jest.fn(),
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

  test('does not replace an already verified email from the recovery form', async () => {
    userModel.findUserById.mockResolvedValue({
      user_id: '1',
      email: 'user@example.com',
      email_verified_at: '2026-09-01T00:00:00.000Z',
    });
    const req = { body: { nrp: '1', email: 'other@example.com' } };
    const res = createRes();

    await requestClaimPasswordReset(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const { sendOtpEmail, sendClaimRecoveryEmailConfirmation } = await import(
      '../src/service/emailService.js'
    );
    expect(sendOtpEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/)
    );
    expect(sendClaimRecoveryEmailConfirmation).not.toHaveBeenCalled();
  });
});
