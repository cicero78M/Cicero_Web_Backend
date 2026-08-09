import { getRekapLinkByClient } from '../model/linkReportModel.js';
import { sendConsoleDebug } from '../middleware/debugHandler.js';
import { normalizeClientId } from '../utils/utilsHelper.js';
import { generateExcelBuffer } from '../service/amplifyExportService.js';
import { query } from '../repository/db.js';
import { authorizeReportRequest } from '../service/reportAuthorizationService.js';

async function normalizeAmplifyContext(req) {
  const periode = req.query.periode || 'harian';
  const tanggal = req.query.tanggal;
  const startDate = req.query.start_date || req.query.tanggal_mulai;
  const endDate = req.query.end_date || req.query.tanggal_selesai;
  const requestedRole = req.query.role || req.user?.role;
  const requestedScope = req.query.scope;
  const requestedRegionalId = req.query.regional_id || req.user?.regional_id;
  const regionalId = requestedRegionalId
    ? String(requestedRegionalId).trim().toUpperCase()
    : null;
  const roleLower = requestedRole ? String(requestedRole).toLowerCase() : null;
  const scopeLower = requestedScope
    ? String(requestedScope).toLowerCase()
    : null;
  const usesStandardPayload = Boolean(requestedScope || req.query.role);

  let effectiveClientId = req.query.client_id;
  if (!usesStandardPayload && roleLower === 'ditbinmas') {
    effectiveClientId = 'ditbinmas';
  }

  const authorization = await authorizeReportRequest(req, {
    effectiveClientId,
    scope: requestedScope,
  });
  if (authorization.error) {
    const error = new Error(authorization.error.message);
    error.statusCode = authorization.error.status;
    throw error;
  }
  let client_id = authorization.clientId;

  const normalizedClientId = normalizeClientId(client_id);
  if (!normalizedClientId) {
    const error = new Error('client_id wajib diisi');
    error.statusCode = 400;
    throw error;
  }
  client_id = normalizedClientId;

  const directorateRoles = ['ditbinmas', 'ditlantas', 'bidhumas', 'ditsamapta'];
  let rekapOptions = { regionalId };
  let roleForQuery = requestedRole;

  if (usesStandardPayload) {
    const resolvedRole = roleLower || null;
    if (!resolvedRole) {
      const error = new Error('role wajib diisi');
      error.statusCode = 400;
      throw error;
    }
    const resolvedScope = scopeLower || 'org';
    if (!['org', 'direktorat'].includes(resolvedScope)) {
      const error = new Error('scope tidak valid');
      error.statusCode = 400;
      throw error;
    }

    let postClientId = client_id;
    let userClientId = client_id;
    let userRoleFilter = null;
    let includePostRoleFilter = false;
    let matchLinkClientId = true;

    if (resolvedScope === 'direktorat') {
      postClientId = client_id;
      userClientId = null;
      userRoleFilter = resolvedRole;
    } else if (resolvedScope === 'org') {
      if (resolvedRole === 'operator') {
        const tokenClientId = req.user?.client_id;
        if (!tokenClientId) {
          const error = new Error('client_id pengguna tidak ditemukan');
          error.statusCode = 400;
          throw error;
        }
        postClientId = tokenClientId;
        userClientId = tokenClientId;
        userRoleFilter = 'operator';
      } else if (directorateRoles.includes(resolvedRole)) {
        postClientId = resolvedRole;
        userClientId = req.user?.client_id || client_id;
        userRoleFilter = resolvedRole;
        matchLinkClientId = false;
      }
    }

    rekapOptions = {
      postClientId,
      userClientId,
      userRoleFilter,
      includePostRoleFilter,
      matchLinkClientId,
      regionalId,
    };
    roleForQuery = resolvedRole;
  }

  return {
    client_id,
    periode,
    tanggal,
    startDate,
    endDate,
    roleForQuery,
    scopeLower,
    regionalId,
    rekapOptions,
  };
}

async function fetchAmplifyRekapData(req) {
  const context = await normalizeAmplifyContext(req);
  const data = await getRekapLinkByClient(
    context.client_id,
    context.periode,
    context.tanggal,
    context.startDate,
    context.endDate,
    context.roleForQuery,
    context.rekapOptions
  );
  return { context, data };
}

function buildDateWhereClause(context, params) {
  const addParam = (value) => {
    params.push(value);
    return params.length;
  };

  if (context.startDate && context.endDate) {
    const startIdx = addParam(context.startDate);
    const endIdx = addParam(context.endDate);
    return `(r.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $${startIdx}::date AND $${endIdx}::date`;
  }

  if (context.periode === 'semua') {
    return '1=1';
  }

  if (context.periode === 'mingguan') {
    if (context.tanggal) {
      const idx = addParam(context.tanggal);
      return `date_trunc('week', r.created_at AT TIME ZONE 'Asia/Jakarta') = date_trunc('week', $${idx}::date)`;
    }
    return "date_trunc('week', r.created_at AT TIME ZONE 'Asia/Jakarta') = date_trunc('week', NOW() AT TIME ZONE 'Asia/Jakarta')";
  }

  if (context.periode === 'bulanan') {
    if (context.tanggal) {
      const monthDate =
        context.tanggal.length === 7
          ? `${context.tanggal}-01`
          : context.tanggal;
      const idx = addParam(monthDate);
      return `date_trunc('month', r.created_at AT TIME ZONE 'Asia/Jakarta') = date_trunc('month', $${idx}::date)`;
    }
    return "date_trunc('month', r.created_at AT TIME ZONE 'Asia/Jakarta') = date_trunc('month', NOW() AT TIME ZONE 'Asia/Jakarta')";
  }

  if (context.tanggal) {
    const idx = addParam(context.tanggal);
    return `(r.created_at AT TIME ZONE 'Asia/Jakarta')::date = $${idx}::date`;
  }

  return "(r.created_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date";
}

async function fetchAmplifyLinkRowsForExport(context) {
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return params.length;
  };

  const joins = [
    'JOIN "user" u ON u.user_id = r.user_id',
    'LEFT JOIN clients c ON c.client_id = u.client_id',
    'LEFT JOIN insta_post p ON p.shortcode = r.shortcode',
  ];

  const filters = [];
  const { rekapOptions = {}, regionalId } = context;

  if (rekapOptions.userClientId) {
    const idx = addParam(rekapOptions.userClientId);
    filters.push(`LOWER(u.client_id) = LOWER($${idx})`);
  }

  if (rekapOptions.userRoleFilter) {
    joins.push('JOIN user_roles ur ON ur.user_id = u.user_id');
    joins.push('JOIN roles ro ON ro.role_id = ur.role_id');
    const idx = addParam(rekapOptions.userRoleFilter);
    filters.push(`LOWER(ro.role_name) = LOWER($${idx})`);
  }

  if (rekapOptions.postClientId) {
    const idx = addParam(rekapOptions.postClientId);
    filters.push(`LOWER(p.client_id) = LOWER($${idx})`);
  }

  if (regionalId) {
    const idx = addParam(regionalId);
    filters.push(`UPPER(c.regional_id) = UPPER($${idx})`);
  }

  filters.push(buildDateWhereClause(context, params));
  filters.push(`(
    COALESCE(NULLIF(r.instagram_link, ''), NULL) IS NOT NULL OR
    COALESCE(NULLIF(r.facebook_link, ''), NULL) IS NOT NULL OR
    COALESCE(NULLIF(r.twitter_link, ''), NULL) IS NOT NULL OR
    COALESCE(NULLIF(r.tiktok_link, ''), NULL) IS NOT NULL OR
    COALESCE(NULLIF(r.youtube_link, ''), NULL) IS NOT NULL
  )`);

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sql = `
    SELECT
      r.user_id,
      COALESCE(u.title, '') AS title,
      COALESCE(u.nama, '') AS nama,
      COALESCE(u.insta, '') AS username,
      COALESCE(u.divisi, '') AS divisi,
      COALESCE(u.client_id, '') AS client_id,
      COALESCE(u.client_id, '') AS client_name,
      r.shortcode,
      r.instagram_link,
      r.facebook_link,
      r.twitter_link,
      r.tiktok_link,
      r.youtube_link,
      r.created_at
    FROM link_report r
    ${joins.join('\n')}
    ${whereClause}
    ORDER BY r.created_at DESC, u.nama ASC, r.shortcode ASC
  `;

  const result = await query(sql, params);
  return result.rows || [];
}

export async function getAmplifyRekap(req, res) {
  try {
    const { context, data } = await fetchAmplifyRekapData(req);
    const length = Array.isArray(data) ? data.length : 0;
    const chartHeight = Math.max(length * 30, 300);

    sendConsoleDebug({
      tag: 'AMPLIFY',
      msg: JSON.stringify({
        stage: 'after_query',
        rowCount: length,
        chartHeight,
        client_id: context.client_id,
        periode: context.periode,
        tanggal: context.tanggal,
      }),
    });

    res.json({ success: true, data, chartHeight });
  } catch (err) {
    const message = err?.message || 'Terjadi kesalahan internal server';
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message });
  }
}

export async function exportAmplifyRekapExcel(req, res) {
  try {
    const context = await normalizeAmplifyContext(req);
    const exportRows = await fetchAmplifyLinkRowsForExport(context);

    const rows = exportRows.map((item, index) => ({
      no: index + 1,
      client_id: item.client_id || '',
      client: item.client_name || '',
      user_id: item.user_id || '',
      nama: [item.title, item.nama].filter(Boolean).join(' ').trim(),
      username_instagram: item.username ? `@${item.username}` : '',
      divisi_satfung: item.divisi || '',
      shortcode: item.shortcode || '',
      task_link: item.shortcode
        ? `https://www.instagram.com/p/${item.shortcode}/`
        : '',
      instagram_link: item.instagram_link || '',
      facebook_link: item.facebook_link || '',
      twitter_link: item.twitter_link || '',
      tiktok_link: item.tiktok_link || '',
      youtube_link: item.youtube_link || '',
      created_at: item.created_at || '',
    }));

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Tidak ada link pelaksanaan pada rentang waktu ini.',
      });
    }

    const buffer = await generateExcelBuffer(rows);
    const suffix =
      context.startDate && context.endDate
        ? `${context.startDate}_${context.endDate}`
        : context.tanggal || context.periode;
    const fileName =
      `rekap_link_pelaksanaan_${context.client_id}_${suffix}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}.xlsx"`
    );
    return res.send(buffer);
  } catch (err) {
    const message = err?.message || 'Terjadi kesalahan internal server';
    const code = err.statusCode || err.response?.status || 500;
    return res.status(code).json({ success: false, message });
  }
}
