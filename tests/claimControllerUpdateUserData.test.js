import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'claim-update-test-secret';

let updateUserData;
let userModel;

describe('updateUserData', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      updateUser: jest.fn().mockResolvedValue({
        user_id: '1',
        nama: 'Test',
        password_hash: 'must-not-leak',
        reset_token: 'must-not-leak',
      }),
      findUserById: jest.fn().mockResolvedValue({
        user_id: '1',
        password_hash: 'hashed-password',
      }),
      findSocialUsernameConflict: jest.fn().mockResolvedValue(null),
      replaceUserSocialAccounts: jest.fn().mockResolvedValue(),
      findUserSocialAccounts: jest.fn().mockResolvedValue({ instagram: [], tiktok: [] }),
    }));
    jest.unstable_mockModule('bcrypt', () => ({
      default: {
        compare: jest.fn(async (plain, hash) => plain === 'Password1!' && hash === 'hashed-password'),
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

    ({ updateUserData } = await import('../src/controller/claimController.js'));
    userModel = await import('../src/model/userModel.js');
  });

  function createRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  }

  test('extracts usernames from links', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        insta: 'https://www.instagram.com/de_saputra88?igsh=MWJxMnY1YmtnZ3Rmeg==',
        tiktok: 'https://www.tiktok.com/@sidik.prayitno37?_t=ZS-8zPPyl5Q4SO&_r=1',
      },
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        insta: 'de_saputra88',
        tiktok: '@sidik.prayitno37',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const response = res.json.mock.calls[0][0];
    expect(response.data).not.toHaveProperty('password_hash');
    expect(response.data).not.toHaveProperty('reset_token');
  });

  test('normalizes and validates whatsapp number', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        whatsapp: '081234567890',
      },
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ whatsapp: '081234567890' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('rejects invalid whatsapp number with too few digits', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        whatsapp: '123',
      },
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'Nomor telepon tidak valid. Masukkan minimal 8 digit angka.',
      error_code: 'CLAIM_INVALID_WHATSAPP_FORMAT',
      field: 'whatsapp',
    }));
    expect(userModel.updateUser).not.toHaveBeenCalled();
  });

  test('normalizes email and updates user data', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        email: ' User@Example.com ',
      },
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith('1', expect.objectContaining({ email: 'user@example.com' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('rejects invalid email format', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        email: 'invalid-email',
      },
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'Format email tidak valid.',
      error_code: 'CLAIM_INVALID_EMAIL_FORMAT',
      field: 'email',
    }));
    expect(userModel.updateUser).not.toHaveBeenCalled();
  });

  test('normalizes, deduplicates, and saves two accounts per platform', async () => {
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        instagram_accounts: [
          'https://instagram.com/Primary.Ig',
          '@primary.ig',
          'secondary_ig',
          '',
        ],
        tiktok_accounts: [
          '@Primary.TT',
          'https://www.tiktok.com/@primary.tt',
          '@secondary.tt',
          null,
        ],
      },
    };
    const res = createRes();

    await updateUserData(req, res, () => {});

    expect(userModel.replaceUserSocialAccounts).toHaveBeenCalledWith(
      '1',
      'instagram',
      ['primary.ig', 'secondary_ig']
    );
    expect(userModel.replaceUserSocialAccounts).toHaveBeenCalledWith(
      '1',
      'tiktok',
      ['@primary.tt', '@secondary.tt']
    );
    expect(userModel.updateUser).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        insta: 'primary.ig',
        tiktok: '@primary.tt',
      })
    );
  });

  test('rejects a username owned by another user before changing profile data', async () => {
    userModel.findSocialUsernameConflict.mockResolvedValueOnce({
      platform: 'instagram',
      username: 'owned.username',
      user_id: 'another-user',
    });
    const req = {
      body: {
        nrp: '1',
        password: 'Password1!',
        nama: 'Must Not Be Saved',
        instagram_accounts: ['owned.username'],
      },
    };
    const res = createRes();

    await updateUserData(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error_code: 'CLAIM_SOCIAL_USERNAME_CONFLICT',
      message: 'Username social media sudah digunakan akun lain.',
      conflict: {
        platform: 'instagram',
        username: 'owned.username',
      },
    });
    expect(userModel.updateUser).not.toHaveBeenCalled();
    expect(userModel.replaceUserSocialAccounts).not.toHaveBeenCalled();
  });
});
