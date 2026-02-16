import * as linkReportModel from '../model/linkReportKhususModel.js';
import { sendSuccess } from '../utils/response.js';
import { extractFirstUrl, extractInstagramShortcode } from '../utils/utilsHelper.js';
import { resolveClientIdForLinkReportKhusus } from '../service/userClientService.js';
import { findClientIdByUserId } from '../model/userModel.js';
import { sendDebug } from '../middleware/debugHandler.js';

function normalizeOptionalField(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function createHttpError(message, statusCode, reasonCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (reasonCode) error.reasonCode = reasonCode;
  return error;
}

function logCreateLinkReportFailure(reasonCode, req, extra = {}) {
  sendDebug({
    tag: 'LINK_REPORT_KHUSUS_CREATE_FAILED',
    msg: {
      reason_code: reasonCode,
      path: req.originalUrl,
      method: req.method,
      auth_user_id: req.user?.user_id || null,
      auth_role: req.user?.role || null,
      ...extra,
    },
  });
}

async function resolveUserIdForCreateLinkReport(data, req, resolvedClientId) {
  const role = String(req.user?.role || '').toLowerCase();
  const bodyUserId = normalizeOptionalField(data.user_id);
  const targetUserId = normalizeOptionalField(data.target_user_id);

  if (role === 'user') {
    if (!req.user?.user_id) {
      throw createHttpError('user_id token tidak ditemukan', 401, 'AUTH_TOKEN_USER_ID_MISSING');
    }
    return req.user.user_id;
  }

  if (bodyUserId) {
    throw createHttpError(
      'Gunakan field target_user_id untuk menentukan user tujuan',
      400,
      'VALIDATION_USER_ID_FIELD_NOT_ALLOWED'
    );
  }

  if (!targetUserId) {
    throw createHttpError(
      'target_user_id is required untuk role non-user',
      400,
      'VALIDATION_TARGET_USER_ID_REQUIRED'
    );
  }

  const targetClientId = await findClientIdByUserId(targetUserId);
  if (!targetClientId) {
    throw createHttpError('target_user_id tidak ditemukan', 422, 'VALIDATION_TARGET_USER_NOT_FOUND');
  }

  if (String(targetClientId).toLowerCase() !== String(resolvedClientId).toLowerCase()) {
    throw createHttpError(
      'target_user_id tidak diizinkan untuk client_id ini',
      403,
      'AUTH_TARGET_USER_CLIENT_MISMATCH'
    );
  }

  return targetUserId;
}

export async function getAllLinkReports(req, res, next) {
  try {
    const userId = req.query.user_id;
    const postId = req.query.post_id || req.query.shortcode;
    const data = await linkReportModel.getLinkReports({ userId, postId });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getLinkReportByShortcode(req, res, next) {
  try {
    const report = await linkReportModel.findLinkReportByShortcode(
      req.params.shortcode,
      req.query.user_id
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function createLinkReport(req, res, next) {
  try {
    const data = { ...req.body };
    const resolvedClientId = await resolveClientIdForLinkReportKhusus({
      bodyClientId: data.client_id,
      queryClientId: req.query?.client_id,
      authUser: req.user,
    });

    data.client_id = resolvedClientId;
    data.user_id = await resolveUserIdForCreateLinkReport(data, req, resolvedClientId);
    delete data.target_user_id;

    const socialFields = [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link',
    ];

    for (const field of socialFields) {
      data[field] = normalizeOptionalField(data[field]);
    }

    const hasAnyLink = socialFields.some((field) => data[field]);
    if (!hasAnyLink) {
      throw createHttpError('At least one social media link is required', 400, 'VALIDATION_ALL_LINKS_EMPTY');
    }

    const instagramLink = data.instagram_link ? extractFirstUrl(data.instagram_link) : null;
    if (data.instagram_link && !instagramLink) {
      throw createHttpError('instagram_link must be a valid URL', 400, 'VALIDATION_INSTAGRAM_LINK_INVALID_URL');
    }

    if (!instagramLink) {
      throw createHttpError(
        'instagram_link wajib diisi sebagai referensi tugas khusus',
        400,
        'VALIDATION_INSTAGRAM_LINK_REQUIRED'
      );
    }

    const shortcode = extractInstagramShortcode(instagramLink);
    if (!shortcode) {
      throw createHttpError(
        'instagram_link must be a valid Instagram post URL',
        400,
        'VALIDATION_INSTAGRAM_LINK_INVALID_POST'
      );
    }

    data.instagram_link = instagramLink;
    data.shortcode = shortcode;
    data.assignment_id = null;

    const report = await linkReportModel.createLinkReport(data);
    sendSuccess(res, report, 201);
  } catch (err) {
    const fallbackReasonCode = (() => {
      if (err?.reasonCode) return err.reasonCode;
      if ((err?.statusCode || 500) === 401 || (err?.statusCode || 500) === 403) return 'AUTHORIZATION_FAILED';
      if ((err?.statusCode || 500) >= 400 && (err?.statusCode || 500) < 500) return 'VALIDATION_FAILED';
      return 'UNEXPECTED_ERROR';
    })();

    logCreateLinkReportFailure(fallbackReasonCode, req, {
      status_code: err?.statusCode || 500,
      message: err?.message || 'unknown error',
      ...(err?.logContext || {}),
    });
    next(err);
  }
}

export async function updateLinkReport(req, res, next) {
  try {
    const bodyData = { ...req.body };
    
    // Extract Instagram link from payload
    const instagramLink = bodyData.instagram_link ? extractFirstUrl(bodyData.instagram_link) : null;
    
    // Validate that the link is a valid Instagram post link if provided
    if (instagramLink) {
      const shortcode = extractInstagramShortcode(instagramLink);
      if (!shortcode) {
        const error = new Error('instagram_link must be a valid Instagram post URL');
        error.statusCode = 400;
        throw error;
      }
      bodyData.instagram_link = instagramLink;
    }
    
    // Ensure no other social media links are provided for special assignments
    const otherLinks = ['facebook_link', 'twitter_link', 'tiktok_link', 'youtube_link'];
    const hasOtherLinks = otherLinks.some(field => bodyData[field]);
    if (hasOtherLinks) {
      const error = new Error('Only instagram_link is allowed for special assignment updates');
      error.statusCode = 400;
      throw error;
    }
    
    // Set other social media links to null
    bodyData.facebook_link = null;
    bodyData.twitter_link = null;
    bodyData.tiktok_link = null;
    bodyData.youtube_link = null;
    
    const report = await linkReportModel.updateLinkReport(
      req.params.shortcode,
      bodyData.user_id,
      bodyData
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function deleteLinkReport(req, res, next) {
  try {
    const report = await linkReportModel.deleteLinkReport(
      req.params.shortcode,
      req.query.user_id
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}
