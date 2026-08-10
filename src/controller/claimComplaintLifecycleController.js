import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';
import * as claimComplaintModel from '../model/claimComplaintModel.js';
import {
  ClaimComplaintLifecycleError,
  transitionClaimComplaint,
} from '../service/claimComplaintLifecycleService.js';

function sendLifecycleError(res, error) {
  if (!(error instanceof ClaimComplaintLifecycleError)) return false;
  const status =
    error.code === 'CLAIM_COMPLAINT_NOT_FOUND'
      ? 404
      : error.code === 'CLAIM_COMPLAINT_STATUS_CONFLICT'
        ? 409
        : 422;
  res.status(status).json({ success: false, error_code: error.code });
  return true;
}

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
    const complaint = await transitionClaimComplaint({
      complaintId: req.params.complaintId,
      userId,
      expectedStatus: req.body?.expected_status,
      nextStatus: 'escalated',
      actor: 'user',
    });
    return sendSuccess(res, {
      complaint_id: complaint.complaint_id,
      escalated: true,
      status: complaint.status,
      triage: complaint.triage_payload,
    });
  } catch (err) {
    if (sendLifecycleError(res, err)) return;
    return next(err);
  }
}

export async function resolveClaimComplaint(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    const complaint = await transitionClaimComplaint({
      complaintId: req.params.complaintId,
      userId,
      expectedStatus: req.body?.expected_status,
      nextStatus: 'resolved',
      actor: 'user',
    });
    return sendSuccess(res, {
      complaint_id: complaint.complaint_id,
      resolved: true,
      status: complaint.status,
    });
  } catch (err) {
    if (sendLifecycleError(res, err)) return;
    return next(err);
  }
}
