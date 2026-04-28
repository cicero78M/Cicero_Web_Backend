import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const mockQuery = jest.fn();
const mockRedis = {
  exists: jest.fn(),
};

jest.unstable_mockModule('../src/db/index.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: mockRedis,
}));

jest.unstable_mockModule('../src/routes/index.js', () => ({
  default: express.Router(),
}));

jest.unstable_mockModule('../src/routes/authRoutes.js', () => ({
  default: express.Router(),
}));

jest.unstable_mockModule('../src/routes/passwordResetAliasRoutes.js', () => ({
  default: express.Router(),
}));

jest.unstable_mockModule('../src/routes/claimRoutes.js', () => ({
  default: express.Router(),
}));

jest.unstable_mockModule('../src/middleware/authMiddleware.js', () => ({
  authRequired: (_req, _res, next) => next(),
}));

let createApp;

beforeAll(async () => {
  process.env.JWT_SECRET = 'testsecret';
  ({ createApp } = await import('../src/app/createApp.js'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockRedis.exists.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });
  mockRedis.exists.mockResolvedValue(0);
});

test('GET /healthz returns ok', async () => {
  const app = createApp();
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test('GET /readyz returns ok when db and redis checks succeed', async () => {
  const app = createApp();
  const res = await request(app).get('/readyz');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    status: 'ok',
    checks: {
      db: 'ok',
      redis: 'ok',
    },
  });
});

test('GET /readyz returns degraded when db check fails', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  const app = createApp();
  const res = await request(app).get('/readyz');
  expect(res.status).toBe(503);
  expect(res.body).toEqual({
    status: 'degraded',
    checks: {
      db: 'error',
      redis: 'ok',
    },
  });
});
