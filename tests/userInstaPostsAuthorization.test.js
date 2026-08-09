import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'user-insta-authorization-secret';

const mockRedisGet = jest.fn();
const mockFindTodayByClientId = jest.fn();

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: { get: mockRedisGet },
}));

jest.unstable_mockModule('../src/service/instaPostService.js', () => ({
  findTodayByClientId: mockFindTodayByClientId,
}));

const { default: instaRoutes } = await import('../src/routes/instaRoutes.js');

describe('GET /api/insta/posts authorization for role user', () => {
  const jwtSecret = 'user-insta-authorization-secret';
  let app;
  let token;

  beforeAll(() => {
    app = express();
    app.use('/api/insta', instaRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    token = jwt.sign(
      { user_id: 'u1', role: 'user', client_id: 'CLIENT_TOKEN' },
      jwtSecret
    );
    mockRedisGet.mockResolvedValue('user:u1');
    mockFindTodayByClientId.mockResolvedValue([]);
  });

  test('allows the client_id authenticated in the user token', async () => {
    const res = await request(app)
      .get('/api/insta/posts?client_id=CLIENT_TOKEN')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockRedisGet).toHaveBeenCalledWith(`login_token:${token}`);
    expect(mockFindTodayByClientId).toHaveBeenCalledWith('CLIENT_TOKEN');
  });

  test('rejects a different client_id instead of trusting the query', async () => {
    const res = await request(app)
      .get('/api/insta/posts?client_id=OTHER_CLIENT')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: 'client_id tidak diizinkan',
    });
    expect(mockFindTodayByClientId).not.toHaveBeenCalled();
  });
});
