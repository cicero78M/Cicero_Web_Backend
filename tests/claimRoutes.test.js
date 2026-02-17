import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('claim routes credential flow', () => {
  let app;
  let userModelMocks;

  beforeEach(async () => {
    jest.resetModules();
    userModelMocks = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: '1',
        password_hash: 'hashed-password',
      }),
      setClaimCredentials: jest.fn().mockResolvedValue({
        user_id: '1',
      }),
      updateUser: jest.fn().mockResolvedValue({ success: true }),
    };

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('bcrypt', () => ({
        default: {
          compare: jest.fn(async (plain, hash) => plain === 'Password1!' && hash === 'hashed-password'),
          hash: jest.fn(async () => 'hashed-password'),
        },
      }));
      jest.unstable_mockModule('../src/model/userModel.js', () => userModelMocks);
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
      message: 'Password minimal 8 karakter dan wajib kombinasi huruf, angka, serta tanda baca.',
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

  test('updates user profile with nrp + password', async () => {
    const res = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', password: 'Password1!', nama: 'User 1' });

    expect(res.status).toBe(200);
    expect(userModelMocks.updateUser).toHaveBeenCalledWith('1', { nama: 'User 1' });
  });
});
