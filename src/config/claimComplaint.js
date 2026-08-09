import { cleanEnv, num } from 'envalid/dist/index.js';

const config = cleanEnv(process.env, {
  CLAIM_COMPLAINT_STALE_AFTER_MS: num({ default: 7200000 }),
});

if (config.CLAIM_COMPLAINT_STALE_AFTER_MS <= 0) {
  throw new Error('CLAIM_COMPLAINT_STALE_AFTER_MS must be greater than zero');
}

export const claimComplaintConfig = Object.freeze({
  staleAfterMs: config.CLAIM_COMPLAINT_STALE_AFTER_MS,
});
