import { getRekapLinkByClient } from '../model/linkReportModel.js';
import { sendConsoleDebug } from '../middleware/debugHandler.js';
import { normalizeClientId } from '../utils/utilsHelper.js';

export async function getAmplifyRekap(req, res) {
  let client_id =
    req.query.client_id || req.user?.client_id || req.user?.client_ids?.[0];
  const periode = req.query.periode || 'harian';
  const tanggal = req.query.tanggal;
  const startDate =
    req.query.start_date || req.query.tanggal_mulai;
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
  const directorateRoles = [
    'ditbinmas',
    'ditlantas',
    'bidhumas',
    'ditsamapta'
  ];
  const usesStandardPayload = Boolean(requestedScope || req.query.role);

  sendConsoleDebug({
    tag: 'AMPLIFY',
    msg: JSON.stringify({
      stage: 'handler_start',
      handler: 'getAmplifyRekap',
      client_id,
      periode,
      tanggal,
      start_date: startDate,
      end_date: endDate,
      role: requestedRole,
      scope: requestedScope,
      regional_id: requestedRegionalId,
      user_client_id: req.user?.client_id || null
    })
  });

  if (!usesStandardPayload && roleLower === 'ditbinmas') {
    client_id = 'ditbinmas';
  }

  const normalizedClientId = normalizeClientId(client_id);
  if (!normalizedClientId) {
    return res.status(400).json({ success: false, message: 'client_id wajib diisi' });
  }
  client_id = normalizedClientId;
  if (req.user?.client_ids) {
    const userClientIds = Array.isArray(req.user.client_ids)
      ? req.user.client_ids
      : [req.user.client_ids];
    const idsLower = userClientIds.map((c) => c.toLowerCase());
    if (
      !idsLower.includes(client_id.toLowerCase()) &&
      roleLower !== client_id.toLowerCase()
    ) {
      return res
        .status(403)
        .json({ success: false, message: 'client_id tidak diizinkan' });
    }
  }
  if (
    req.user?.client_id &&
    req.user.client_id.toLowerCase() !== client_id.toLowerCase() &&
    roleLower !== client_id.toLowerCase()
  ) {
    return res
      .status(403)
      .json({ success: false, message: 'client_id tidak diizinkan' });
  }
  try {
    let rekapOptions = { regionalId };
    let roleForQuery = requestedRole;

    sendConsoleDebug({
      tag: 'AMPLIFY',
      msg: JSON.stringify({
        stage: 'before_scope_transform',
        usesStandardPayload,
        client_id,
        roleLower,
        scopeLower,
        regionalId
      })
    });

    if (usesStandardPayload) {
      const resolvedRole = roleLower || null;
      if (!resolvedRole) {
        return res
          .status(400)
          .json({ success: false, message: 'role wajib diisi' });
      }
      const resolvedScope = scopeLower || 'org';
      if (!['org', 'direktorat'].includes(resolvedScope)) {
        return res
          .status(400)
          .json({ success: false, message: 'scope tidak valid' });
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
            return res.status(400).json({
              success: false,
              message: 'client_id pengguna tidak ditemukan'
            });
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
        regionalId
      };
      roleForQuery = resolvedRole;
    }

    sendConsoleDebug({
      tag: 'AMPLIFY',
      msg: JSON.stringify({
        stage: 'before_query',
        client_id,
        periode,
        tanggal,
        start_date: startDate,
        end_date: endDate,
        role: roleForQuery,
        scope: scopeLower,
        regional_id: regionalId,
        rekapOptions
      })
    });
    const data = await getRekapLinkByClient(
      client_id,
      periode,
      tanggal,
      startDate,
      endDate,
      roleForQuery,
      rekapOptions
    );
    const length = Array.isArray(data) ? data.length : 0;
    const chartHeight = Math.max(length * 30, 300);
    sendConsoleDebug({
      tag: 'AMPLIFY',
      msg: JSON.stringify({
        stage: 'after_query',
        rowCount: length,
        chartHeight
      })
    });
    res.json({ success: true, data, chartHeight });
  } catch (err) {
    const message = err?.message || 'Terjadi kesalahan internal server';
    sendConsoleDebug({
      tag: 'AMPLIFY',
      msg: JSON.stringify({
        stage: 'handler_error',
        message,
        stack: err?.stack,
        statusCode: err?.statusCode || err?.response?.status || 500
      })
    });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message });
  }
}
