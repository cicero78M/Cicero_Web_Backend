import * as linkReportModel from '../model/linkReportModel.js';
import { sendSuccess } from '../utils/response.js';
import { extractFirstUrl } from '../utils/utilsHelper.js';
import { generateLinkReportExcelBuffer } from '../service/amplifyExportService.js';

export async function getAllLinkReports(req, res, next) {
  try {
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
    [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link'
    ].forEach((f) => {
      if (data[f]) data[f] = extractFirstUrl(data[f]);
    });
    const report = await linkReportModel.createLinkReport(data);

    // Note: User notification for amplification link submission has been removed
    // as per requirement to remove user message sending in amplification mechanisms

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

export async function downloadMonthlyLinkReportExcel(req, res, next) {
  try {
    const clientId = req.query.client_id;
    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }
    const rows = await linkReportModel.getReportsThisMonthByClient(clientId);
    const buffer = generateLinkReportExcelBuffer(rows);
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
