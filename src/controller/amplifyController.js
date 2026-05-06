import { getRekapLinkByClient } from '../model/linkReportModel.js';
import { sendConsoleDebug } from '../middleware/debugHandler.js';
import { normalizeClientId } from '../utils/utilsHelper.js';
import { generateExcelBuffer } from '../service/amplifyExportService.js';

function normalizeAmplifyContext(req) {
  let client_id =
    req.query.client_id || req.user?.client_id || req.user?.client_ids?.[0];
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
  const scopeLower = requestedScope ? String(requestedScope).toLowerCase() : null;
  const usesStandardPayload = Boolean(requestedScope || req.query.role);

  if (!usesStandardPayload && roleLower === 'ditbinmas') {
    client_id = 'ditbinmas';
  }

  const normalizedClientId = normalizeClientId(client_id);
  if (!normalizedClientId) {
    const error = new Error('client_id wajib diisi');
    error.statusCode = 400;
    throw error;
  }
  client_id = normalizedClientId;

  if (req.user?.client_ids) {
    const userClientIds = Array.isArray(req.user.client_ids)
      ? req.user.client_ids
      : [req.user.client_ids];
    const idsLower = userClientIds.map((c) => c.toLowerCase());
    if (!idsLower.includes(client_id.toLowerCase()) && roleLower !== client_id.toLowerCase()) {
      const error = new Error('client_id tidak diizinkan');
      error.statusCode = 403;
      throw error;
    }
  }
  if (
    req.user?.client_id &&
    req.user.client_id.toLowerCase() !== client_id.toLowerCase() &&
    roleLower !== client_id.toLowerCase()
  ) {
    const error = new Error('client_id tidak diizinkan');
    error.statusCode = 403;
    throw error;
  }

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
  const context = normalizeAmplifyContext(req);
  const data = await getRekapLinkByClient(
    context.client_id,
    context.periode,
    context.tanggal,
    context.startDate,
    context.endDate,
    context.roleForQuery,
    context.rekapOptions,
  );
  return { context, data };
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
    const { context, data } = await fetchAmplifyRekapData(req);
    const rows = (Array.isArray(data) ? data : []).map((u, index) => ({
      no: index + 1,
      client_id: u.client_id || '',
      client: u.nama_client || u.client_name || u.client || '',
      user_id: u.user_id || '',
      nama: [u.title, u.nama].filter(Boolean).join(' ').trim(),
      username_instagram: u.username ? `@${u.username}` : '',
      divisi_satfung: u.divisi || '',
      status_pelaksanaan: Number(u.jumlah_link || 0) > 0 ? 'Sudah' : 'Belum',
      jumlah_link: Number(u.jumlah_link || 0),
      instagram_link: u.instagram_link || u.instagram || '',
      facebook_link: u.facebook_link || u.facebook || '',
      twitter_link: u.twitter_link || u.twitter || '',
      tiktok_link: u.tiktok_link || u.tiktok || '',
      youtube_link: u.youtube_link || u.youtube || '',
    }));

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Data rekap amplifikasi kosong.' });
    }

    const buffer = await generateExcelBuffer(rows);
    const suffix = context.periode === 'custom' && context.startDate && context.endDate
      ? `${context.startDate}_${context.endDate}`
      : context.periode;
    const fileName = `rekap_amplifikasi_${context.client_id}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    const message = err?.message || 'Terjadi kesalahan internal server';
    const code = err.statusCode || err.response?.status || 500;
    return res.status(code).json({ success: false, message });
  }
}
