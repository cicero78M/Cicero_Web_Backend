import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';
import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { deliverClaimComplaintNotification } from '../service/claimComplaintNotificationService.js';

function buildComplaintLifecycleDto(complaint) {
  const evidence = complaint.triage_evidence || {};
  return {
    complaint_id: complaint.complaint_id,
    platform: complaint.platform,
    content_id: complaint.content_id,
    issue_type: complaint.issue_type,
    status: complaint.status,
    triage: {
      code: complaint.triage_code,
      quality: complaint.triage_quality,
      evidence: {
        activity_recorded: evidence.activity_recorded,
        snapshot_available: evidence.snapshot_available,
        last_collected_at: evidence.last_collected_at,
        performed_at: evidence.performed_at,
      },
    },
    created_at: complaint.created_at,
    updated_at: complaint.updated_at,
    escalated_at: complaint.escalated_at,
    resolved_at: complaint.resolved_at,
  };
}

export async function getClaimComplaints(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const complaintId = req.params.complaintId;
    if (complaintId) {
      const complaint = await claimComplaintModel.findComplaintLifecycleById(
        complaintId,
        userId
      );
      if (!complaint)
        return res
          .status(404)
          .json({ success: false, error_code: 'CLAIM_COMPLAINT_NOT_FOUND' });
      return sendSuccess(res, buildComplaintLifecycleDto(complaint));
    }

    const complaints = await claimComplaintModel.findComplaintsByUserId(userId);
    return sendSuccess(res, complaints.map(buildComplaintLifecycleDto));
  } catch (err) {
    return next(err);
  }
}

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

export async function resolveClaimComplaint(req, res, next) {
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
    const complaint = await claimComplaintModel.resolveComplaint(
      req.params.complaintId,
      userId
    );
    return sendSuccess(res, {
      complaint_id: existing.complaint_id,
      resolved: Boolean(complaint),
      status: complaint?.status || existing.status,
    });
  } catch (err) {
    return next(err);
  }
}
