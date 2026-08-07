import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('claim routes credential flow', () => {
  let app;
  let userModelMocks;
  let claimPasswordResetModelMocks;
  let emailServiceMocks;
  let telegramServiceMocks;

  beforeEach(async () => {
    jest.resetModules();
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    userModelMocks = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: '1',
        password_hash: 'hashed-password',
        email: 'user1@cicero.id',
      }),
      setClaimCredentials: jest.fn().mockResolvedValue({
        user_id: '1',
      }),
      updateUser: jest.fn().mockResolvedValue({ success: true }),
      findUserSocialAccounts: jest.fn().mockResolvedValue({
        instagram: [],
        tiktok: [],
      }),
    };
    claimPasswordResetModelMocks = {
      createResetRequest: jest
        .fn()
        .mockResolvedValue({ reset_token: 'mock-token' }),
      findActiveByToken: jest.fn().mockResolvedValue({ user_id: '1' }),
      markTokenUsed: jest.fn().mockResolvedValue({}),
    };
    emailServiceMocks = {
      sendClaimPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendOtpEmail: jest.fn().mockResolvedValue(undefined),
    };
    telegramServiceMocks = {
      sendTelegramAdminMessage: jest.fn().mockResolvedValue(undefined),
    };

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('bcrypt', () => ({
        default: {
          compare: jest.fn(
            async (plain, hash) =>
              plain === 'Password1!' && hash === 'hashed-password'
          ),
          hash: jest.fn(async () => 'hashed-password'),
        },
      }));
      jest.unstable_mockModule(
        '../src/model/userModel.js',
        () => userModelMocks
      );
      jest.unstable_mockModule('../src/config/redis.js', () => ({
        default: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1),
          ttl: jest.fn().mockResolvedValue(60),
        },
      }));
      jest.unstable_mockModule(
        '../src/model/claimPasswordResetModel.js',
        () => claimPasswordResetModelMocks
      );
      jest.unstable_mockModule(
        '../src/service/emailService.js',
        () => emailServiceMocks
      );
      jest.unstable_mockModule(
        '../src/service/telegramService.js',
        () => telegramServiceMocks
      );
      jest.unstable_mockModule('../src/middleware/authMiddleware.js', () => ({
        authRequired: (req, res, next) => {
          const userId = req.get('x-test-user-id');
          if (!userId)
            return res
              .status(401)
              .json({ success: false, message: 'Token required' });
          req.user = { user_id: userId, role: 'user' };
          return next();
        },
      }));
      const claimMod = await import('../src/routes/claimRoutes.js');
      app = express();
      app.use(express.json());
      app.use('/api/claim', claimMod.default);
    });
  });

  test('registers credentials with nrp/password without OTP', async () => {
    const res = await request(app)
      .post('/api/claim/register')
      .send({ nrp: '1', password: 'Password1!' });

    expect(res.status).toBe(200);
    expect(userModelMocks.setClaimCredentials).toHaveBeenCalledWith('1', {
      passwordHash: 'hashed-password',
    });
  });

  test('rejects weak password for claim register', async () => {
    const res = await request(app)
      .post('/api/claim/register')
      .send({ nrp: '1', password: 'abcd1234' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message:
        'Password minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.',
    });
  });

  test('returns not registered message when nrp is not found during claim register', async () => {
    userModelMocks.findUserById.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/claim/register')
      .send({ nrp: '999', password: 'Password1!' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: 'NRP anda tidak terdaftar',
    });
  });

  test('reads user-data with nrp + password', async () => {
    const res = await request(app)
      .post('/api/claim/user-data')
      .send({ nrp: '1', password: 'Password1!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('creates claim password reset token for matching nrp/email', async () => {
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test';
    process.env.SMTP_PASS = 'test';
    process.env.SMTP_FROM = 'test@cicero.id';
    const res = await request(app)
      .post('/api/claim/password-reset/request')
      .send({ nrp: '1', email: 'USER1@CICERO.ID' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(emailServiceMocks.sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  test('confirms claim password reset and updates password hash', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { type: 'claim_password_reset', user_id: '1' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const res = await request(app)
      .post('/api/claim/password-reset/confirm')
      .send({
        token,
        password: 'Password1!',
        confirmPassword: 'Password1!',
      });

    expect(res.status).toBe(200);
    expect(userModelMocks.setClaimCredentials).toHaveBeenCalled();
    expect(claimPasswordResetModelMocks.markTokenUsed).toHaveBeenCalledWith(
      token
    );
  });

  test('updates user profile with nrp + password', async () => {
    const res = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', password: 'Password1!', nama: 'User 1' });

    expect(res.status).toBe(200);
    expect(userModelMocks.updateUser).toHaveBeenCalledWith('1', {
      nama: 'User 1',
    });
  });

  test('reads claim profile only from authenticated user identity', async () => {
    const res = await request(app)
      .get('/api/claim/me?nrp=attacker')
      .set('x-test-user-id', '12345')
      .send({ nrp: '67890' });

    expect(res.status).toBe(200);
    expect(userModelMocks.findUserById).toHaveBeenCalledWith('12345');
    expect(res.body.data.password_hash).toBeUndefined();
    expect(userModelMocks.findUserById).not.toHaveBeenCalledWith('67890');
  });

  test('updates claim profile only from authenticated user identity without password', async () => {
    const res = await request(app)
      .put('/api/claim/me?nrp=query-attacker')
      .set('x-test-user-id', '12345')
      .send({ nrp: '67890', user_id: '54321', nama: 'JWT User' });

    expect(res.status).toBe(200);
    expect(userModelMocks.updateUser).toHaveBeenCalledWith('12345', {
      nama: 'JWT User',
    });
    expect(userModelMocks.updateUser).not.toHaveBeenCalledWith(
      expect.stringMatching(/67890|54321/),
      expect.anything()
    );
  });

  test('requires authentication for claim self-service endpoints', async () => {
    const getResponse = await request(app).get('/api/claim/me');
    const putResponse = await request(app)
      .put('/api/claim/me')
      .send({ nama: 'User' });

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(userModelMocks.findUserById).not.toHaveBeenCalled();
    expect(userModelMocks.updateUser).not.toHaveBeenCalled();
  });
});
