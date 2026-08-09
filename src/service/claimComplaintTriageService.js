export const TRIAGE_CODES = Object.freeze({
  ACTIVITY_ALREADY_RECORDED: 'ACTIVITY_ALREADY_RECORDED',
  SOCIAL_USERNAME_MISSING: 'SOCIAL_USERNAME_MISSING',
  SOCIAL_USERNAME_MISMATCH: 'SOCIAL_USERNAME_MISMATCH',
  SOCIAL_PROFILE_PRIVATE: 'SOCIAL_PROFILE_PRIVATE',
  SOCIAL_PROFILE_NOT_FOUND: 'SOCIAL_PROFILE_NOT_FOUND',
  SOCIAL_PROFILE_SUSPICIOUS: 'SOCIAL_PROFILE_SUSPICIOUS',
  ENGAGEMENT_NOT_IN_SNAPSHOT: 'ENGAGEMENT_NOT_IN_SNAPSHOT',
  DATA_COLLECTION_STALE: 'DATA_COLLECTION_STALE',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
});

export const RAPID_API_OUTCOMES = Object.freeze({
  AVAILABLE: 'available',
  NOT_FOUND: 'not_found',
  UNAVAILABLE: 'unavailable',
});

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function areAllAvailableMetricsZero(metrics) {
  const values = Object.values(metrics || {}).filter(
    (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  );
  return values.length > 0 && values.every((value) => Number(value) === 0);
}

function isSnapshotStale(updatedAt, now, staleAfterMs) {
  const timestamp = Date.parse(updatedAt);
  return (
    !Number.isFinite(timestamp) ||
    now.getTime() - timestamp > staleAfterMs
  );
}

/**
 * Maps an upstream exception to a stable outcome without exposing its message.
 * Only non-sensitive metadata is logged; request config, URL, headers and body are omitted.
 */
export function mapRapidApiError(error, logger = console) {
  const status = Number(error?.response?.status || error?.status);
  const upstreamCode = String(error?.response?.data?.code || error?.code || 'UNKNOWN');
  const notFound = status === 404 || ['USER_NOT_FOUND', 'PROFILE_NOT_FOUND'].includes(upstreamCode);
  logger.error?.('RapidAPI profile check failed', {
    errorName: error?.name || 'Error',
    status: Number.isFinite(status) ? status : null,
    upstreamCode,
  });
  return notFound ? RAPID_API_OUTCOMES.NOT_FOUND : RAPID_API_OUTCOMES.UNAVAILABLE;
}

/**
 * Produces deterministic triage from verified, structured evidence only.
 */
export function triageClaimComplaintEvidence({
  registeredUsername,
  actorUsername,
  actorUsernameVerified = false,
  activityRecorded = false,
  snapshotAvailable = false,
  snapshotUpdatedAt,
  profile = {},
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}) {
  const registered = normalizeUsername(registeredUsername);
  const actor = normalizeUsername(actorUsername);

  if (activityRecorded) {
    return { triageCode: TRIAGE_CODES.ACTIVITY_ALREADY_RECORDED, triageQuality: 'high' };
  }
  if (!registered) {
    return { triageCode: TRIAGE_CODES.SOCIAL_USERNAME_MISSING, triageQuality: 'low' };
  }
  if (actorUsernameVerified && actor && actor !== registered) {
    return { triageCode: TRIAGE_CODES.SOCIAL_USERNAME_MISMATCH, triageQuality: 'high' };
  }
  if (snapshotAvailable && isSnapshotStale(snapshotUpdatedAt, now, staleAfterMs)) {
    return { triageCode: TRIAGE_CODES.DATA_COLLECTION_STALE, triageQuality: 'low' };
  }
  if (profile.outcome === RAPID_API_OUTCOMES.UNAVAILABLE) {
    return { triageCode: TRIAGE_CODES.UPSTREAM_UNAVAILABLE, triageQuality: 'low' };
  }
  if (profile.outcome === RAPID_API_OUTCOMES.NOT_FOUND) {
    return { triageCode: TRIAGE_CODES.SOCIAL_PROFILE_NOT_FOUND, triageQuality: snapshotAvailable ? 'medium' : 'low' };
  }
  if (profile.outcome === RAPID_API_OUTCOMES.AVAILABLE && profile.isPrivate) {
    return { triageCode: TRIAGE_CODES.SOCIAL_PROFILE_PRIVATE, triageQuality: snapshotAvailable ? 'medium' : 'low' };
  }
  if (
    profile.outcome === RAPID_API_OUTCOMES.AVAILABLE &&
    profile.exists === true &&
    areAllAvailableMetricsZero(profile.metrics)
  ) {
    return { triageCode: TRIAGE_CODES.SOCIAL_PROFILE_SUSPICIOUS, triageQuality: snapshotAvailable ? 'medium' : 'low' };
  }
  if (
    profile.outcome === RAPID_API_OUTCOMES.AVAILABLE &&
    profile.exists === true &&
    snapshotAvailable
  ) {
    return { triageCode: TRIAGE_CODES.ENGAGEMENT_NOT_IN_SNAPSHOT, triageQuality: 'medium' };
  }
  return { triageCode: TRIAGE_CODES.MANUAL_REVIEW_REQUIRED, triageQuality: 'low' };
}
