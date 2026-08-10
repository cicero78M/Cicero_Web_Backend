import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { TRIAGE_CODES } from './claimComplaintTriageService.js';

const initialStatusByTriageCode = Object.freeze({
  [TRIAGE_CODES.ACTIVITY_ALREADY_RECORDED]: 'triaged',
  [TRIAGE_CODES.SOCIAL_USERNAME_MISSING]: 'needs_user_action',
  [TRIAGE_CODES.SOCIAL_USERNAME_MISMATCH]: 'needs_user_action',
  [TRIAGE_CODES.SOCIAL_PROFILE_PRIVATE]: 'needs_user_action',
  [TRIAGE_CODES.SOCIAL_PROFILE_NOT_FOUND]: 'needs_user_action',
  [TRIAGE_CODES.SOCIAL_PROFILE_SUSPICIOUS]: 'triaged',
  [TRIAGE_CODES.ENGAGEMENT_NOT_IN_SNAPSHOT]: 'triaged',
  [TRIAGE_CODES.DATA_COLLECTION_STALE]: 'waiting_sync',
  [TRIAGE_CODES.UPSTREAM_UNAVAILABLE]: 'waiting_sync',
  [TRIAGE_CODES.MANUAL_REVIEW_REQUIRED]: 'triaged',
});

/** Maps every stable triage decision to its initial complaint lifecycle state. */
export function getInitialClaimComplaintStatus(triageCode) {
  const status = initialStatusByTriageCode[triageCode];
  if (!status) {
    throw new ClaimComplaintLifecycleError('CLAIM_COMPLAINT_TRIAGE_INVALID');
  }
  return status;
}

export const claimComplaintTransitionMatrix = Object.freeze({
  triaged: Object.freeze([
    'waiting_sync',
    'needs_user_action',
    'escalated',
    'resolved',
  ]),
  waiting_sync: Object.freeze([
    'triaged',
    'needs_user_action',
    'escalated',
    'resolved',
  ]),
  needs_user_action: Object.freeze([
    'triaged',
    'waiting_sync',
    'escalated',
    'resolved',
  ]),
  escalated: Object.freeze([
    'triaged',
    'waiting_sync',
    'needs_user_action',
    'resolved',
  ]),
  resolved: Object.freeze([]),
});

const userAllowedTargetStatuses = new Set(['escalated', 'resolved']);

export class ClaimComplaintLifecycleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ClaimComplaintLifecycleError';
    this.code = code;
  }
}

/**
 * Applies one compare-and-set lifecycle transition. Internal callers may drive
 * operational states; claim API users may only escalate or resolve their own report.
 */
export async function transitionClaimComplaint({
  complaintId,
  userId,
  expectedStatus,
  nextStatus,
  actor = 'internal',
}) {
  const allowedTargets = claimComplaintTransitionMatrix[expectedStatus];
  if (!allowedTargets || !allowedTargets.includes(nextStatus)) {
    throw new ClaimComplaintLifecycleError(
      'CLAIM_COMPLAINT_TRANSITION_INVALID'
    );
  }
  if (actor === 'user' && !userAllowedTargetStatuses.has(nextStatus)) {
    throw new ClaimComplaintLifecycleError(
      'CLAIM_COMPLAINT_TRANSITION_FORBIDDEN'
    );
  }

  const existing = await claimComplaintModel.findComplaintById(
    complaintId,
    userId
  );
  if (!existing) {
    throw new ClaimComplaintLifecycleError('CLAIM_COMPLAINT_NOT_FOUND');
  }

  const complaint = await claimComplaintModel.transitionComplaintStatus({
    complaintId,
    userId,
    expectedStatus,
    nextStatus,
  });
  if (!complaint) {
    throw new ClaimComplaintLifecycleError('CLAIM_COMPLAINT_STATUS_CONFLICT');
  }
  return complaint;
}

/** Creates the active report once, or returns the report already active for the content. */
export async function createOrGetActiveClaimComplaint({
  userId,
  clientId,
  platform,
  contentId,
  issueType,
  triageSnapshot,
}) {
  const status = getInitialClaimComplaintStatus(triageSnapshot.triage_code);
  return claimComplaintModel.createComplaint({
    userId,
    clientId,
    platform,
    contentId,
    issueType,
    triage: triageSnapshot,
    status,
  });
}
