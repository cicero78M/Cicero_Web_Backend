import { jest } from '@jest/globals';
import {
  RAPID_API_OUTCOMES,
  TRIAGE_CODES,
  mapRapidApiError,
  triageClaimComplaintEvidence,
} from '../src/service/claimComplaintTriageService.js';

const freshSnapshot = '2026-08-09T11:00:00.000Z';
const now = new Date('2026-08-09T12:00:00.000Z');
const availableProfile = {
  outcome: RAPID_API_OUTCOMES.AVAILABLE,
  exists: true,
  metrics: { posts: 2, followers: 10, following: null },
};

describe('claim complaint evidence triage', () => {
  test.each([
    ['recorded local activity', { activityRecorded: true }, TRIAGE_CODES.ACTIVITY_ALREADY_RECORDED, 'high'],
    ['missing platform username', { registeredUsername: '' }, TRIAGE_CODES.SOCIAL_USERNAME_MISSING, 'low'],
    ['verified actor mismatch', { actorUsername: 'other', actorUsernameVerified: true }, TRIAGE_CODES.SOCIAL_USERNAME_MISMATCH, 'high'],
    ['private Instagram profile', { profile: { ...availableProfile, isPrivate: true } }, TRIAGE_CODES.SOCIAL_PROFILE_PRIVATE, 'medium'],
    ['mapped profile not found', { profile: { outcome: RAPID_API_OUTCOMES.NOT_FOUND } }, TRIAGE_CODES.SOCIAL_PROFILE_NOT_FOUND, 'medium'],
    ['all available metrics zero', { profile: { ...availableProfile, metrics: { posts: 0, followers: 0, following: 0 } } }, TRIAGE_CODES.SOCIAL_PROFILE_SUSPICIOUS, 'medium'],
    ['username absent from snapshot', {}, TRIAGE_CODES.ENGAGEMENT_NOT_IN_SNAPSHOT, 'medium'],
    ['stale collection timestamp', { snapshotUpdatedAt: '2026-08-09T08:00:00.000Z' }, TRIAGE_CODES.DATA_COLLECTION_STALE, 'low'],
    ['upstream unavailable', { profile: { outcome: RAPID_API_OUTCOMES.UNAVAILABLE } }, TRIAGE_CODES.UPSTREAM_UNAVAILABLE, 'low'],
    ['insufficient evidence', { snapshotAvailable: false, profile: {} }, TRIAGE_CODES.MANUAL_REVIEW_REQUIRED, 'low'],
  ])('%s => %s/%s', (_name, override, triageCode, triageQuality) => {
    expect(triageClaimComplaintEvidence({
      registeredUsername: 'stored.user',
      snapshotAvailable: true,
      snapshotUpdatedAt: freshSnapshot,
      profile: availableProfile,
      now,
      ...override,
    })).toEqual({ triageCode, triageQuality });
  });

  test('waits for synchronization when collection predates performed activity', () => {
    expect(triageClaimComplaintEvidence({
      registeredUsername: 'stored.user',
      snapshotAvailable: true,
      snapshotUpdatedAt: '2026-08-09T10:00:00.000Z',
      performedAt: '2026-08-09T10:30:00.000Z',
      profile: availableProfile,
      now,
    })).toEqual({
      triageCode: TRIAGE_CODES.DATA_COLLECTION_STALE,
      triageQuality: 'low',
    });
  });

  test.each([
    [404, 'UNKNOWN', RAPID_API_OUTCOMES.NOT_FOUND],
    [400, 'PROFILE_NOT_FOUND', RAPID_API_OUTCOMES.NOT_FOUND],
    [401, 'UNKNOWN', RAPID_API_OUTCOMES.UNAVAILABLE],
    [429, 'UNKNOWN', RAPID_API_OUTCOMES.UNAVAILABLE],
    [503, 'UNKNOWN', RAPID_API_OUTCOMES.UNAVAILABLE],
  ])('maps RapidAPI status %s/code %s safely', (status, code, expected) => {
    const logger = { error: jest.fn() };
    const error = new Error('secret-key https://upstream.example/profile');
    error.response = { status, data: { code }, config: { headers: { key: 'secret' } } };
    expect(mapRapidApiError(error, logger)).toBe(expected);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-key');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('upstream.example');
  });
});
