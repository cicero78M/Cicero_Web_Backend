import * as userModel from '../model/userModel.js';
import { diagnoseComplaint } from '../service/complaintDiagnosisService.js';
import { normalizeUserId } from '../utils/utilsHelper.js';
import { sendSuccess } from '../utils/response.js';
import { getComplaintContentForUser } from '../service/claimPendingContentService.js';
import { hasUserLikedShortcode } from '../model/instaLikeModel.js';
import { hasUserCommentedVideo } from '../model/tiktokCommentModel.js';
import { buildClaimTriageResponse } from '../service/claimTriageResponseService.js';
import { createOrGetActiveClaimComplaint } from '../service/claimComplaintLifecycleService.js';
import {
  validateDateRange,
  validateTanggalFilter,
} from '../utils/dateFilterValidation.js';

const allowedFields = new Set([
  'platform',
  'issue_type',
  'shortcode',
  'video_id',
  'performed_at',
  'periode',
  'tanggal',
  'start_date',
  'end_date',
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
    const identifierField =
      body.platform === 'instagram' ? 'shortcode' : 'video_id';
    const otherIdentifierField =
      body.platform === 'instagram' ? 'video_id' : 'shortcode';
    if (body[otherIdentifierField] !== undefined) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_PLATFORM_CONTENT_MISMATCH',
        otherIdentifierField,
        'Identifier konten tidak sesuai dengan platform komplain.'
      );
    }
    if (
      typeof body[identifierField] !== 'string' ||
      !body[identifierField].trim()
    ) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_CONTENT_ID_REQUIRED',
        identifierField,
        `${identifierField} wajib berupa teks yang tidak kosong.`
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

    const periode = String(body.periode || 'harian').toLowerCase();
    const validPeriods = new Set(['harian', 'mingguan', 'bulanan', 'semua']);
    const { error: tanggalError } = validateTanggalFilter(
      body.tanggal,
      periode
    );
    const { error: rangeError } = validateDateRange(
      body.start_date,
      body.end_date
    );
    if (
      !validPeriods.has(periode) ||
      tanggalError ||
      rangeError ||
      Boolean(body.start_date) !== Boolean(body.end_date)
    ) {
      return sendValidationError(
        res,
        'CLAIM_COMPLAINT_INVALID_DATE_FILTER',
        'periode',
        tanggalError || rangeError || 'Filter periode komplain tidak valid.'
      );
    }

    const contentId = body[identifierField].trim();
    const scopedContent = await getComplaintContentForUser(
      userId,
      body.platform,
      contentId,
      {
        periode,
        tanggal: body.tanggal,
        startDate: body.start_date,
        endDate: body.end_date,
      }
    );
    if (!scopedContent) {
      return res.status(403).json({
        success: false,
        error_code: 'CLAIM_COMPLAINT_CONTENT_OUT_OF_SCOPE',
        field: identifierField,
        message:
          'Konten tidak termasuk tugas pending user pada scope yang dipilih.',
      });
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
      `ID konten: ${contentId}.`,
      body.performed_at ? `Perkiraan pelaksanaan: ${body.performed_at}.` : '',
    ].filter(Boolean);
    const parsedComplaint = {
      raw: issueDetails.join(' '),
      nrp: userId,
      instagram: body.platform === 'instagram' ? user.insta || '' : '',
      tiktok: body.platform === 'tiktok' ? user.tiktok || '' : '',
      issues: [issueDetails.join(' ')],
    };
    const activityChecks = scopedContent.usernames.map((username) =>
      body.platform === 'instagram'
        ? hasUserLikedShortcode(username, contentId)
        : hasUserCommentedVideo(username, contentId)
    );
    const activityEvidence = await Promise.all(activityChecks);
    const hasSelectedActivity = activityEvidence.some(
      (item) => item.hasActivity
    );
    const collectedTimes = activityEvidence
      .flatMap((item) => [item.latestAudit?.capturedAt, item.updatedAt])
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left));
    const lastCollectedAt =
      collectedTimes[0] || scopedContent.item.snapshot_updated_at || null;
    const diagnosis = await diagnoseComplaint({
      user,
      userId,
      parsedComplaint,
      fallbackIssue: issueDetails.join(' '),
      claimPlatform: body.platform,
      selectedContent: {
        id: contentId,
        hasActivity: hasSelectedActivity,
        snapshotAvailable: Boolean(lastCollectedAt),
        snapshotUpdatedAt: lastCollectedAt,
        performedAt: body.performed_at || null,
      },
    });

    const triageDto = buildClaimTriageResponse({
      platform: body.platform,
      contentId,
      triageCode: diagnosis.triageCode,
      triageQuality: diagnosis.triageQuality,
      registeredUsername:
        body.platform === 'instagram' ? user.insta : user.tiktok,
      lastCollectedAt,
    });
    const triageSnapshot = {
      platform: body.platform,
      content_id: contentId,
      triage_code: diagnosis.triageCode,
      triage_quality: diagnosis.triageQuality,
      triage_evidence: {
        activity_recorded: hasSelectedActivity,
        snapshot_available: Boolean(lastCollectedAt),
        last_collected_at: lastCollectedAt,
        performed_at: body.performed_at || null,
      },
      diagnosed_at: new Date().toISOString(),
      ...triageDto,
    };
    // A recorded activity is a completed diagnosis, not an active complaint.
    if (diagnosis.triageCode === 'ACTIVITY_ALREADY_RECORDED') {
      return sendSuccess(res, {
        ...triageDto,
        complaint_id: null,
        complaint_created: false,
        complaint_status: null,
      });
    }
    const report = await createOrGetActiveClaimComplaint({
      userId,
      clientId: user.client_id,
      platform: body.platform,
      contentId,
      issueType: body.issue_type,
      triageSnapshot,
    });

    return sendSuccess(
      res,
      {
        ...triageDto,
        complaint_id: report.complaint.complaint_id,
        complaint_created: report.created,
        complaint_status: report.complaint.status,
      },
      report.created ? 201 : 200
    );
  } catch (err) {
    return next(err);
  }
}
