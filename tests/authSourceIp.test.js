import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: { get: jest.fn() },
}));

const { authRequired } = await import('../src/middleware/authMiddleware.js');
const { trustedProxy } = await import('../src/config/trustedProxy.js');

function createSourceIpTestApp(remoteAddress) {
  const app = express();
  app.set('trust proxy', trustedProxy);
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', {
      configurable: true,
      value: remoteAddress,
    });
    next();
  });
  app.get('/protected', authRequired, (_req, res) => res.sendStatus(204));
  return app;
}

function getDeniedSourceIp(warnSpy) {
  expect(warnSpy).toHaveBeenCalledWith(
    'auth.middleware.denied',
    expect.objectContaining({ reason: 'missing_token' })
  );
  return warnSpy.mock.calls[0][1].sourceIp;
}

describe('authentication source IP logging', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('ignores spoofed forwarding headers from a direct, untrusted peer', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createSourceIpTestApp('203.0.113.50');

    const response = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '198.51.100.99')
      .set('X-Real-IP', '198.51.100.98');

    expect(response.status).toBe(401);
    expect(getDeniedSourceIp(warnSpy)).toBe('203.0.113.50');
  });

  test('uses the address appended by the approved loopback proxy', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createSourceIpTestApp('127.0.0.1');

    const response = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '198.51.100.99, 203.0.113.25')
      .set('X-Real-IP', '203.0.113.25');

    expect(response.status).toBe(401);
    expect(getDeniedSourceIp(warnSpy)).toBe('203.0.113.25');
  });
});
