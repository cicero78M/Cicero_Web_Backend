import { getRekapLinkByClient } from '../model/linkReportKhususModel.js';
import { sendConsoleDebug } from '../middleware/debugHandler.js';
import { normalizeClientId } from '../utils/utilsHelper.js';
import { authorizeReportRequest } from '../service/reportAuthorizationService.js';

const OPERATOR_ROLE = 'operator';

export async function getAmplifyKhususRekap(req, res) {
  try {
    const authorization = await authorizeReportRequest(req);
    if (authorization.error) {
      return res.status(authorization.error.status).json({
        success: false,
        message: authorization.error.message,
      });
    }
    const client_id = normalizeClientId(authorization.clientId);
    const periode = req.query.periode || 'harian';
    const tanggal = req.query.tanggal;
    const requestedRole = req.query.role || req.user?.role;
    const requestedScope = req.query.scope;
    const roleLower = requestedRole
      ? String(requestedRole).toLowerCase()
      : null;
    const scopeLower = requestedScope
      ? String(requestedScope).toLowerCase()
      : null;
    const usesStandardPayload = Boolean(requestedScope || req.query.role);

    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }

    let rekapOptions = {};
    let roleForQuery = null;

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

      let userClientId = client_id;
      let userRoleFilter = null;

      if (resolvedScope === 'org' && resolvedRole === OPERATOR_ROLE) {
        const tokenClientId = req.user?.client_id;
        if (!tokenClientId) {
          return res.status(400).json({
            success: false,
            message: 'client_id pengguna tidak ditemukan',
          });
        }
        userClientId = tokenClientId;
        userRoleFilter = OPERATOR_ROLE;
        roleForQuery = OPERATOR_ROLE;
      }

      rekapOptions = {
        userClientId,
        userRoleFilter,
      };
    }

    sendConsoleDebug({
      tag: 'AMPLIFY_KHUSUS',
      msg: `getAmplifyKhususRekap ${client_id} ${periode} ${tanggal || ''} ${roleLower || ''} ${scopeLower || ''}`,
    });
    const data = await getRekapLinkByClient(
      client_id,
      periode,
      tanggal,
      roleForQuery,
      rekapOptions
    );
    res.json({ success: true, data });
  } catch (err) {
    sendConsoleDebug({
      tag: 'AMPLIFY_KHUSUS',
      msg: `Error getAmplifyKhususRekap: ${err.message}`,
    });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}
