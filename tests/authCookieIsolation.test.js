import { describe, expect, test } from '@jest/globals';
import {
  AUTH_COOKIE_NAMES,
  getAuthToken,
  getCookieToken,
  getRequestedAuthScope,
  hasAuthCookie,
} from '../src/config/authCookies.js';

function requestWith({ scope, cookies = {}, authorization } = {}) {
  return {
    cookies,
    headers: {
      ...(scope ? { 'x-cicero-auth-scope': scope } : {}),
      ...(authorization ? { authorization } : {}),
    },
  };
}

describe('auth cookie isolation', () => {
  test('selects only the cookie that belongs to the requested portal', () => {
    const req = requestWith({
      cookies: {
        [AUTH_COOKIE_NAMES.dashboard]: 'dashboard-token',
        [AUTH_COOKIE_NAMES.claim]: 'claim-token',
        [AUTH_COOKIE_NAMES.reposter]: 'reposter-token',
      },
    });

    expect(getCookieToken(req, 'dashboard')).toBe('dashboard-token');
    expect(getCookieToken(req, 'claim')).toBe('claim-token');
    expect(getCookieToken(req, 'reposter')).toBe('reposter-token');
  });

  test('never falls across to another portal cookie', () => {
    const req = requestWith({
      scope: 'reposter',
      cookies: { [AUTH_COOKIE_NAMES.dashboard]: 'dashboard-token' },
    });

    expect(getRequestedAuthScope(req)).toBe('reposter');
    expect(getAuthToken(req)).toBeNull();
  });

  test('never accepts the reposter cookie for an explicitly scoped claim request', () => {
    const req = requestWith({
      scope: 'claim',
      cookies: { [AUTH_COOKIE_NAMES.reposter]: 'reposter-token' },
    });

    expect(getRequestedAuthScope(req)).toBe('claim');
    expect(getAuthToken(req)).toBeNull();
  });

  test('keeps the legacy cookie only as a migration fallback', () => {
    const req = requestWith({
      cookies: { [AUTH_COOKIE_NAMES.legacy]: 'legacy-token' },
    });

    expect(getCookieToken(req, 'dashboard')).toBe('legacy-token');
    expect(getCookieToken(req, 'claim')).toBe('legacy-token');
    expect(getCookieToken(req, 'reposter')).toBe('legacy-token');
  });

  test('Bearer authentication remains explicit and takes precedence', () => {
    const req = requestWith({
      scope: 'dashboard',
      authorization: 'Bearer api-token',
      cookies: { [AUTH_COOKIE_NAMES.dashboard]: 'cookie-token' },
    });

    expect(getAuthToken(req)).toBe('api-token');
  });

  test('CSRF detection recognizes every scoped auth cookie', () => {
    for (const scope of ['dashboard', 'claim', 'reposter', 'penmas', 'client']) {
      expect(
        hasAuthCookie(
          requestWith({ cookies: { [AUTH_COOKIE_NAMES[scope]]: 'token' } }),
        ),
      ).toBe(true);
    }
  });
});
