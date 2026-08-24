import * as linkReportModel from '../model/linkReportKhususModel.js';
import { sendSuccess } from '../utils/response.js';
import { extractFirstUrl, extractInstagramShortcode } from '../utils/utilsHelper.js';
import { resolveClientIdForLinkReportKhusus } from '../service/userClientService.js';
import { findClientIdByUserId } from '../model/userModel.js';
import { sendDebug } from '../middleware/debugHandler.js';
import { generateExcelBuffer } from '../service/amplifyExportService.js';
import { resolveLinkReportMutationUserId } from '../service/linkReportIdentityService.js';

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
    const duplicateLinksRaw = req.query['links[]'] ?? req.query.links;
    const duplicateLinks = Array.isArray(duplicateLinksRaw)
      ? duplicateLinksRaw
      : duplicateLinksRaw
        ? [duplicateLinksRaw]
        : [];

    if (duplicateLinks.length > 0) {
      const duplicates = await linkReportModel.findDuplicateLinks(duplicateLinks);
      return sendSuccess(res, { duplicates });
    }

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

    const shortcode = instagramLink
      ? extractInstagramShortcode(instagramLink)
      : normalizeOptionalField(data.shortcode);

    if (instagramLink && !shortcode) {
      throw createHttpError(
        'instagram_link must be a valid Instagram post URL',
        400,
        'VALIDATION_INSTAGRAM_LINK_INVALID_POST'
      );
    }

    if (!shortcode) {
      throw createHttpError('shortcode is required when instagram_link is empty', 400, 'VALIDATION_SHORTCODE_REQUIRED');
    }

    data.instagram_link = instagramLink;
    data.shortcode = shortcode;

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

    ['facebook_link', 'twitter_link', 'tiktok_link', 'youtube_link'].forEach((field) => {
      if (bodyData[field]) bodyData[field] = extractFirstUrl(bodyData[field]);
    });

    const instagramLink = bodyData.instagram_link ? extractFirstUrl(bodyData.instagram_link) : null;

    if (instagramLink) {
      const shortcode = extractInstagramShortcode(instagramLink);
      if (!shortcode) {
        const error = new Error('instagram_link must be a valid Instagram post URL');
        error.statusCode = 400;
        throw error;
      }
      bodyData.instagram_link = instagramLink;
    } else if (bodyData.instagram_link) {
      const error = new Error('instagram_link must be a valid URL');
      error.statusCode = 400;
      throw error;
    }

    const report = await linkReportModel.updateLinkReport(
      req.params.shortcode,
      resolveLinkReportMutationUserId(req, bodyData.user_id),
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
      resolveLinkReportMutationUserId(req, req.query.user_id)
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function downloadLinkReportExcelByUserAndShortcode(req, res, next) {
  try {
    const userId = String(req.query.user_id || '').trim();
    const shortcode = String(req.query.shortcode || '').trim();
    const clientId = String(req.query.client_id || '').trim();

    if (!userId || !shortcode) {
      return res.status(400).json({
        success: false,
        message: 'user_id dan shortcode wajib diisi',
      });
    }

    const rows = await linkReportModel.findLinkReportsByUserAndShortcode({
      user_id: userId,
      shortcode,
      client_id: clientId || null,
    });

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Data pelaksanaan tugas khusus tidak ditemukan untuk user_id + shortcode tersebut.',
      });
    }

    const excelRows = rows.map((r, index) => ({
      no: index + 1,
      user_id: r.user_id || '',
      nama: [r.title, r.nama].filter(Boolean).join(' ').trim(),
      username: r.username ? `@${r.username}` : '',
      divisi_satfung: r.divisi || '',
      client_id: r.client_id || '',
      shortcode: r.shortcode || '',
      task_link: r.shortcode ? `https://www.instagram.com/p/${r.shortcode}/` : '',
      instagram_link: r.instagram_link || '',
      facebook_link: r.facebook_link || '',
      twitter_link: r.twitter_link || '',
      tiktok_link: r.tiktok_link || '',
      youtube_link: r.youtube_link || '',
      created_at: r.created_at || '',
      caption: r.caption || '',
    }));

    const buffer = await generateExcelBuffer(excelRows);
    const safeShortcode = shortcode.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="link_report_khusus_${safeUserId}_${safeShortcode}.xlsx"`
    );
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}
