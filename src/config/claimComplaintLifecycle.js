/**
 * A non-resolved complaint suppresses an equivalent report for this duration.
 * After the window expires, the same user may open a fresh complaint even when
 * the older complaint has not yet been resolved. This is intentionally a code
 * constant: there is no verified operational need for runtime configuration.
 */
export const claimComplaintDeduplicationWindowMs = 24 * 60 * 60 * 1000;
