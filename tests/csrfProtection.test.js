import { jest } from '@jest/globals';
import { createCsrfProtection } from '../src/middleware/csrfProtection.js';

function runMiddleware(overrides = {}) {
  const req = {
    method: 'POST',
    headers: {},
    cookies: { token: 'cookie-token' },
    ...overrides,
  };
  const res = {
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
  const next = jest.fn();
  createCsrfProtection(['https://papiqo.com'])(req, res, next);
  return { res, next };
}

test('rejects cross-site cookie-authenticated mutations', () => {
  const { res, next } = runMiddleware({
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  expect(res.statusCode).toBe(403);
  expect(next).not.toHaveBeenCalled();
});

test('allows configured same-origin cookie requests', () => {
  const { next } = runMiddleware({
    headers: { origin: 'https://papiqo.com', 'sec-fetch-site': 'same-origin' },
  });
  expect(next).toHaveBeenCalledTimes(1);
});

test('allows bearer-authenticated API clients', () => {
  const { next } = runMiddleware({
    headers: {
      authorization: 'Bearer api-token',
      origin: 'https://evil.example',
    },
  });
  expect(next).toHaveBeenCalledTimes(1);
});
