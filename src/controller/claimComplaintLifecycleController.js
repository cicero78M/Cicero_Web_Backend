import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';
import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { deliverClaimComplaintNotification } from '../service/claimComplaintNotificationService.js';

function sendValidationError(res, errorCode, field, message) {
  return res.status(400).json({ success: false, error_code: errorCode, field, message });
}
export async function createClaimComplaint(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const triage = req.body?.triage;
    if (!userId || !triage || typeof triage !== 'object') {
      return sendValidationError(res, 'CLAIM_COMPLAINT_TRIAGE_REQUIRED', 'triage', 'DTO triase wajib diisi.');
    }
    const platform = triage.platform;
    const contentId = triage.content_id;
    if (!['instagram', 'tiktok'].includes(platform) || typeof contentId !== 'string' || !contentId.trim()) {
      return sendValidationError(res, 'CLAIM_COMPLAINT_TRIAGE_INVALID', 'triage', 'DTO triase tidak valid.');
    }
    const result = await claimComplaintModel.createComplaint({
      userId,
      platform,
      contentId: contentId.trim(),
      triage,
    });
    let notification = await claimComplaintModel.findNotification(result.complaint.complaint_id, 'created');
    if (result.created) {
      notification = await deliverClaimComplaintNotification(result.complaint, 'created');
    }
    return sendSuccess(res, {
      complaint_id: result.complaint.complaint_id,
      created: result.created,
      status: result.complaint.status,
      triage: result.complaint.triage_payload,
      notification,
    }, result.created ? 201 : 200);
  } catch (err) {
    return next(err);
  }
}

export async function escalateClaimComplaint(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const existing = await claimComplaintModel.findComplaintById(req.params.complaintId, userId);
    if (!existing) return res.status(404).json({ success: false, error_code: 'CLAIM_COMPLAINT_NOT_FOUND' });
    const complaint = await claimComplaintModel.escalateComplaint(req.params.complaintId, userId);
    let notification = await claimComplaintModel.findNotification(existing.complaint_id, 'escalated');
    if (complaint) notification = await deliverClaimComplaintNotification(complaint, 'escalated');
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
    const complaint = await claimComplaintModel.findComplaintById(req.params.complaintId, userId);
    if (!complaint) return res.status(404).json({ success: false, error_code: 'CLAIM_COMPLAINT_NOT_FOUND' });
    const eventType = complaint.status === 'escalated' ? 'escalated' : 'created';
    const notification = await deliverClaimComplaintNotification(complaint, eventType);
    return sendSuccess(res, { complaint_id: complaint.complaint_id, notification });
  } catch (err) {
    return next(err);
  }
}

