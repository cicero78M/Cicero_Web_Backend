import * as linkReportModel from '../model/linkReportModel.js';
import * as linkReportKhususModel from '../model/linkReportKhususModel.js';
import { findPostByShortcodeInsensitive } from '../model/instaPostKhususModel.js';
import { sendSuccess } from '../utils/response.js';
import { extractFirstUrl } from '../utils/utilsHelper.js';
import {
  generateExcelBuffer,
  generateLinkReportExcelBuffer,
} from '../service/amplifyExportService.js';
import { resolveLinkReportMutationUserId } from '../service/linkReportIdentityService.js';

export async function getAllLinkReports(req, res, next) {
  try {
    const duplicateLinksRaw = req.query['links[]'] ?? req.query.links;
    const duplicateLinks = Array.isArray(duplicateLinksRaw)
      ? duplicateLinksRaw
      : duplicateLinksRaw
        ? [duplicateLinksRaw]
        : [];

    if (duplicateLinks.length > 0) {
      const [regularDuplicates, specialDuplicates] = await Promise.all([
        linkReportModel.findDuplicateLinks(duplicateLinks),
        linkReportKhususModel.findDuplicateLinks(duplicateLinks),
      ]);
      const duplicates = Array.from(new Set([...regularDuplicates, ...specialDuplicates]));
      return sendSuccess(res, { duplicates });
    }

    const DEFAULT_LIMIT = 20;
    const DEFAULT_PAGE = 1;
    const userId = req.query.user_id;
    const postId = req.query.post_id || req.query.shortcode;

    const requestedLimit = parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_LIMIT;

    let offset;
    if (req.query.offset !== undefined) {
      const requestedOffset = parseInt(req.query.offset, 10);
      offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
    } else {
      const requestedPage = parseInt(req.query.page, 10);
      const page =
        Number.isFinite(requestedPage) && requestedPage > 0
          ? requestedPage
          : DEFAULT_PAGE;
      offset = (page - 1) * limit;
    }

    const result = await linkReportModel.getLinkReports({
      limit,
      offset,
      userId,
      postId
    });

    const page = Math.floor(result.offset / result.limit) + 1;
    const totalPages = result.totalCount > 0 ? Math.ceil(result.totalCount / result.limit) : 0;

    sendSuccess(res, {
      items: result.rows,
      pagination: {
        total: result.totalCount,
        limit: result.limit,
        offset: result.offset,
        page,
        totalPages
      }
    });
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

export async function createLinkReport(req, res) {
  try {
    const data = { ...req.body };
    data.user_id = resolveLinkReportMutationUserId(req, data.user_id);
    [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link'
    ].forEach((f) => {
      if (data[f]) data[f] = extractFirstUrl(data[f]);
    });
    const specialPost = await findPostByShortcodeInsensitive(data.shortcode);
    const report = specialPost
      ? await linkReportKhususModel.createLinkReport(data)
      : await linkReportModel.createLinkReport(data);

    // Note: User notification for amplification link submission has been removed
    // as per requirement: "pada mekanisme yang berkaitan dengan amplifikasi 
    // buang fitur pengiriman pesan ke user" (for amplification mechanisms, 
    // remove the feature of sending messages to users)
    // This was part of the WhatsApp to Telegram refactor (Feb 2026)

    sendSuccess(res, report, 201);
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function updateLinkReport(req, res, next) {
  try {
    const bodyData = { ...req.body };
    [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link'
    ].forEach((f) => {
      if (bodyData[f]) bodyData[f] = extractFirstUrl(bodyData[f]);
    });
    const userId = resolveLinkReportMutationUserId(req, bodyData.user_id);
    const specialPost = await findPostByShortcodeInsensitive(req.params.shortcode);
    const resolvedShortcode = specialPost?.shortcode || req.params.shortcode;
    const report = specialPost
      ? await linkReportKhususModel.updateLinkReport(resolvedShortcode, userId, bodyData)
      : await linkReportModel.updateLinkReport(req.params.shortcode, userId, bodyData);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function deleteLinkReport(req, res, next) {
  try {
    const userId = resolveLinkReportMutationUserId(req, req.query.user_id);
    const specialPost = await findPostByShortcodeInsensitive(req.params.shortcode);
    const resolvedShortcode = specialPost?.shortcode || req.params.shortcode;
    const report = specialPost
      ? await linkReportKhususModel.deleteLinkReport(resolvedShortcode, userId)
      : await linkReportModel.deleteLinkReport(req.params.shortcode, userId);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function downloadMonthlyLinkReportExcel(req, res, next) {
  try {
    const clientId = req.query.client_id;
    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }
    const rows = await linkReportModel.getReportsThisMonthByClient(clientId);
    const buffer = await generateLinkReportExcelBuffer(rows);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="link_report.xlsx"'
    );
    res.send(buffer);
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
        message: 'Data pelaksanaan tugas tidak ditemukan untuk user_id + shortcode tersebut.',
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
      `attachment; filename="link_report_${safeUserId}_${safeShortcode}.xlsx"`
    );
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}
