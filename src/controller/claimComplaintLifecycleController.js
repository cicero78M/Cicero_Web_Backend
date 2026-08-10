import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';
import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { deliverClaimComplaintNotification } from '../service/claimComplaintNotificationService.js';

export async function escalateClaimComplaint(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const existing = await claimComplaintModel.findComplaintById(
      req.params.complaintId,
      userId
    );
    if (!existing)
      return res
        .status(404)
        .json({ success: false, error_code: 'CLAIM_COMPLAINT_NOT_FOUND' });
    const complaint = await claimComplaintModel.escalateComplaint(
      req.params.complaintId,
      userId
    );
    let notification = await claimComplaintModel.findNotification(
      existing.complaint_id,
      'escalated'
    );
    if (complaint)
      notification = await deliverClaimComplaintNotification(
        complaint,
        'escalated'
      );
    return sendSuccess(res, {
      complaint_id: existing.complaint_id,
      escalated: Boolean(complaint),
      status: complaint?.status || existing.status,
      triage: complaint?.triage_payload || existing.triage_payload,
      notification,
    });
  } catch (err) {
    return next(err);
  }
}

export async function retryClaimComplaintNotification(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const complaint = await claimComplaintModel.findComplaintById(
      req.params.complaintId,
      userId
    );
    if (!complaint)
      return res
        .status(404)
        .json({ success: false, error_code: 'CLAIM_COMPLAINT_NOT_FOUND' });
    const eventType =
      complaint.status === 'escalated' ? 'escalated' : 'created';
    const notification = await deliverClaimComplaintNotification(
      complaint,
      eventType
    );
    return sendSuccess(res, {
      complaint_id: complaint.complaint_id,
      notification,
    });
  } catch (err) {
    return next(err);
  }
}
