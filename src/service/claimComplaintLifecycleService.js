import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { deliverClaimComplaintNotification } from './claimComplaintNotificationService.js';

/** Creates the active report once, or returns the report already active for the content. */
export async function createOrGetActiveClaimComplaint({
  userId,
  clientId,
  platform,
  contentId,
  issueType,
  triageSnapshot,
}) {
  const result = await claimComplaintModel.createComplaint({
    userId,
    clientId,
    platform,
    contentId,
    issueType,
    triage: triageSnapshot,
  });
  let notification = await claimComplaintModel.findNotification(
    result.complaint.complaint_id,
    'created'
  );
  if (result.created) {
    notification = await deliverClaimComplaintNotification(
      result.complaint,
      'created'
    );
  }
  return { ...result, notification };
}
