import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'system-admin-cookie-test-secret';

const mockRedisGet = jest.fn();
jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: { get: mockRedisGet },
}));

const { verifySystemAdminToken } = await import(
  '../src/middleware/systemAdminAuth.js'
);

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('authenticates admin through dedicated HttpOnly cookie', async () => {
  const token = jwt.sign(
    { role: 'system_admin', telegram_chat_id: '123', admin_role: 'super_admin' },
    process.env.JWT_SECRET,
  );
  mockRedisGet.mockResolvedValue('admin:123');
  const req = { cookies: { admin_system_token: token }, headers: {} };
  const res = createResponse();
  const next = jest.fn();

  await verifySystemAdminToken(req, res, next);

  expect(mockRedisGet).toHaveBeenCalledWith(`login_token:${token}`);
  expect(next).toHaveBeenCalledTimes(1);
  expect(req.systemAdmin.admin_role).toBe('super_admin');
});

test('does not treat the dashboard cookie as an admin credential', async () => {
  const req = { cookies: { token: 'dashboard-token' }, headers: {} };
  const res = createResponse();
  const next = jest.fn();

  await verifySystemAdminToken(req, res, next);

  expect(res.statusCode).toBe(401);
  expect(next).not.toHaveBeenCalled();
});
