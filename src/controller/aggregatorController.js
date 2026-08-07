import {
  buildAggregatorPayload,
  refreshAggregatorData,
  resolveAggregatorClient,
} from "../service/aggregatorService.js";
import { sendSuccess } from "../utils/response.js";
import { sendConsoleDebug } from "../middleware/debugHandler.js";
import {
  authorizeReportRequest,
  sendReportAuthorizationError,
} from "../service/reportAuthorizationService.js";

export async function getAggregator(req, res) {
  try {
    const authorization = await authorizeReportRequest(req);
    if (authorization.error) return sendReportAuthorizationError(res, authorization.error);
    const normalizedClientId = authorization.clientId;

    const resolution = await resolveAggregatorClient(
      normalizedClientId,
      req.user?.role,
      {
        userScope: req.user?.scope,
        regionalId: req.query.regional_id || req.user?.regional_id,
      }
    );
    if (!resolution) {
      return res
        .status(404)
        .json({ success: false, message: "client not found" });
    }
    const { client, resolvedClientId, requestedClientId, reason } = resolution;
    sendConsoleDebug({
      tag: "AGG",
      msg: `getAggregator ${requestedClientId} => ${resolvedClientId} (${reason})`,
    });
    const limitRequest = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitRequest) ? 10 : limitRequest;
    const periode = req.query.periode || "harian";
    const payload = await buildAggregatorPayload(client, resolvedClientId, periode, limit);

    sendSuccess(res, payload);
  } catch (err) {
    sendConsoleDebug({ tag: "AGG", msg: `Error getAggregator: ${err.message}` });
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function refreshAggregator(req, res) {
  try {
    const authorization = await authorizeReportRequest(req, { source: "body" });
    if (authorization.error) return sendReportAuthorizationError(res, authorization.error);
    const clientId = authorization.clientId;

    const limitRequest = parseInt(req.body?.limit ?? req.query.limit, 10);
    const limit = Number.isNaN(limitRequest) ? 10 : limitRequest;
    const periode = req.body?.periode || req.query.periode || "harian";

    const skipPostRefreshRaw =
      req.body?.skipPostRefresh ?? req.query.skipPostRefresh;
    const skipPostRefresh =
      typeof skipPostRefreshRaw === "string"
        ? skipPostRefreshRaw.toLowerCase() === "true"
        : Boolean(skipPostRefreshRaw);

    const results = await refreshAggregatorData({
      clientId,
      periode,
      limit,
      userRole: req.user?.role,
      userScope: req.user?.scope,
      regionalId: req.body?.regional_id || req.query.regional_id || req.user?.regional_id,
      skipPostRefresh,
    });

    sendConsoleDebug({
      tag: "AGG",
      msg: `refreshAggregator completed for ${
        clientId || "ALL"
      } (${periode}, limit=${limit}, skipPostRefresh=${skipPostRefresh})`,
    });

    sendSuccess(res, { message: "Aggregator refreshed", results });
  } catch (err) {
    sendConsoleDebug({
      tag: "AGG",
      msg: `Error refreshAggregator: ${err.message}`,
    });

    if (err.message === "client not found") {
      return res.status(404).json({ success: false, message: err.message });
    }

    if (err.message === "Client tidak memenuhi kriteria direktorat aktif dengan sosmed") {
      return res.status(400).json({ success: false, message: err.message });
    }

    res.status(500).json({ success: false, message: err.message });
  }
}
