import * as claimComplaintModel from '../model/claimComplaintModel.js';

const maxAttempts = 3;

export async function deliverClaimComplaintNotification(complaint, eventType) {
  const reservation = await claimComplaintModel.reserveNotification(
    complaint.complaint_id,
    eventType,
    maxAttempts
  );
  if (!reservation) {
    return claimComplaintModel.findNotification(complaint.complaint_id, eventType);
  }

  return claimComplaintModel.finishNotification(complaint.complaint_id, eventType, {
    status: 'skipped',
    attemptCount: reservation.attempt_count,
  });
}
