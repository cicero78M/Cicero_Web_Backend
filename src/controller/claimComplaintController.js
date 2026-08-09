import * as userModel from '../model/userModel.js';
import { diagnoseComplaint } from '../service/complaintDiagnosisService.js';
import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';

const allowedFields = new Set([
  'platform',
  'issue_type',
  'content_id',
  'performed_at',
]);
const identityFields = new Set([
  'nrp',
  'user_id',
  'client_id',
  'username',
  'insta',
  'tiktok',
  'instagram_username',
  'tiktok_username',
]);

function sendValidationError(res, errorCode, field, message) {
  return res
    .status(400)
    .json({ success: false, error_code: errorCode, field, message });
}

export async function triageClaimComplaint(req, res, next) {
  try {
    const userId = normalizeUserId(req.user?.user_id);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error_code: 'CLAIM_AUTH_USER_REQUIRED',
        message: 'Token user tidak valid',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const suppliedIdentityField = Object.keys(body).find((field) =>
      identityFields.has(field)
    );
    if (suppliedIdentityField) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_IDENTITY_FIELD_FORBIDDEN',
        suppliedIdentityField,
        'Identitas user hanya boleh berasal dari token autentikasi.'
      );
    }
    const unsupportedField = Object.keys(body).find(
      (field) => !allowedFields.has(field)
    );
    if (unsupportedField) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_UNSUPPORTED_FIELD',
        unsupportedField,
        'Field payload tidak didukung.'
      );
    }
    if (!['instagram', 'tiktok'].includes(body.platform)) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_INVALID_PLATFORM',
        'platform',
        'Platform harus instagram atau tiktok.'
      );
    }
    if (body.issue_type !== 'activity_not_recorded') {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_INVALID_ISSUE_TYPE',
        'issue_type',
        'Tipe kendala harus activity_not_recorded.'
      );
    }
    if (
      body.content_id !== undefined &&
      (typeof body.content_id !== 'string' || !body.content_id.trim())
    ) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_INVALID_CONTENT_ID',
        'content_id',
        'ID konten harus berupa teks yang tidak kosong.'
      );
    }
    if (
      body.performed_at !== undefined &&
      (typeof body.performed_at !== 'string' ||
        !body.performed_at.trim() ||
        Number.isNaN(Date.parse(body.performed_at)))
    ) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_INVALID_PERFORMED_AT',
        'performed_at',
        'Waktu perkiraan pelaksanaan harus berupa tanggal/waktu yang valid.'
      );
    }

    const user = await userModel.findClaimProfileById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error_code: 'CLAIM_USER_NOT_FOUND',
        message: 'User tidak ditemukan',
      });
    }
    const platformLabel =
      body.platform === 'instagram' ? 'Instagram' : 'TikTok';
    const issueDetails = [
      `Sudah melaksanakan ${platformLabel} tetapi belum terdata.`,
      body.content_id ? `ID konten: ${String(body.content_id).trim()}.` : '',
      body.performed_at ? `Perkiraan pelaksanaan: ${body.performed_at}.` : '',
    ].filter(Boolean);
    const parsedComplaint = {
      raw: issueDetails.join(' '),
      nrp: userId,
      instagram: body.platform === 'instagram' ? user.insta || '' : '',
      tiktok: body.platform === 'tiktok' ? user.tiktok || '' : '',
      issues: [issueDetails.join(' ')],
    };
    const diagnosis = await diagnoseComplaint({
      user,
      userId,
      parsedComplaint,
      fallbackIssue: issueDetails.join(' '),
    });

    return sendSuccess(res, {
      complaint_id: null,
      platform: body.platform,
      triage_code: diagnosis.triageCode,
      triage_quality: diagnosis.triageQuality,
      summary: diagnosis.issue,
      evidence: diagnosis.evidence,
      solutions: diagnosis.solution ? [diagnosis.solution] : [],
      can_escalate: diagnosis.canEscalate,
    });
  } catch (err) {
    return next(err);
  }
}
