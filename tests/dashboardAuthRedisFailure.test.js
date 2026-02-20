import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mockRedis = { get: jest.fn() };
const mockDashboardUserModel = { findById: jest.fn() };
const mockQuery = jest.fn();

jest.unstable_mockModule('../src/config/redis.js', () => ({ default: mockRedis }));
jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => mockDashboardUserModel);
jest.unstable_mockModule('../src/repository/db.js', () => ({ query: mockQuery }));

let verifyDashboardToken;
let verifyDashboardOrClientToken;
let verifyPenmasToken;

beforeAll(async () => {
  process.env.JWT_SECRET = 'testsecret';
  ({ verifyDashboardToken, verifyDashboardOrClientToken } = await import(
    '../src/middleware/dashboardAuth.js'
  ));
  ({ verifyPenmasToken } = await import('../src/middleware/penmasAuth.js'));
});

beforeEach(() => {
  mockRedis.get.mockReset();
  mockDashboardUserModel.findById.mockReset();
  mockQuery.mockReset();
});

function makeApp(middleware) {
  const app = express();
  app.use(express.json());
  app.get('/protected', middleware, (req, res) => res.json({ success: true }));
  return app;
}

describe('verifyDashboardToken - Redis failure', () => {
  test('returns 503 when Redis throws an error', async () => {
    const token = jwt.sign(
      { dashboard_user_id: 'u1', role: 'operator' },
      process.env.JWT_SECRET
    );
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection refused'));

    const app = makeApp(verifyDashboardToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  test('returns 401 when Redis key is missing (not a Redis failure)', async () => {
    const token = jwt.sign(
      { dashboard_user_id: 'u1', role: 'operator' },
      process.env.JWT_SECRET
    );
    mockRedis.get.mockResolvedValueOnce(null);

    const app = makeApp(verifyDashboardToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('verifyDashboardOrClientToken - Redis failure', () => {
  test('returns 503 when Redis throws an error', async () => {
    const token = jwt.sign({ client_id: 'CLIENT1', role: 'client' }, process.env.JWT_SECRET);
    mockRedis.get.mockRejectedValueOnce(new Error('Redis timeout'));

    const app = makeApp(verifyDashboardOrClientToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  test('returns 401 when Redis key is missing', async () => {
    const token = jwt.sign({ client_id: 'CLIENT1', role: 'client' }, process.env.JWT_SECRET);
    mockRedis.get.mockResolvedValueOnce(null);

    const app = makeApp(verifyDashboardOrClientToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('passes through for valid client token', async () => {
    const token = jwt.sign({ client_id: 'CLIENT1', role: 'client' }, process.env.JWT_SECRET);
    mockRedis.get.mockResolvedValueOnce('CLIENT1');

    const app = makeApp(verifyDashboardOrClientToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('verifyPenmasToken - Redis failure', () => {
  test('returns 503 when Redis throws an error', async () => {
    const token = jwt.sign({ user_id: 'p1', role: 'penulis' }, process.env.JWT_SECRET);
    mockRedis.get.mockRejectedValueOnce(new Error('Redis unavailable'));

    const app = makeApp(verifyPenmasToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  test('returns 401 when Redis key is missing', async () => {
    const token = jwt.sign({ user_id: 'p1', role: 'penulis' }, process.env.JWT_SECRET);
    mockRedis.get.mockResolvedValueOnce(null);

    const app = makeApp(verifyPenmasToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('returns 401 when Redis key is not penmas', async () => {
    const token = jwt.sign({ user_id: 'p1', role: 'penulis' }, process.env.JWT_SECRET);
    mockRedis.get.mockResolvedValueOnce('dashboard:some-id');

    const app = makeApp(verifyPenmasToken);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
