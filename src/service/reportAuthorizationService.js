import * as clientModel from "../model/clientModel.js";

export function normalizeReportClientId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeKey(value) {
  return normalizeReportClientId(value)?.toLowerCase() || null;
}

function getAuthenticatedClientIds(user = {}) {
  const values = Array.isArray(user.client_ids)
    ? user.client_ids
    : user.client_ids
      ? [user.client_ids]
      : user.client_id
        ? [user.client_id]
        : [];
  return values.map(normalizeReportClientId).filter(Boolean);
}

async function hasTrustedDirectorateAccess(user, requestedClientId, requestedScope) {
  if (normalizeKey(requestedScope) !== "direktorat") return false;

  const effectiveRole = normalizeKey(user?.role);
  if (!effectiveRole) return false;

  const assignedClientIds = getAuthenticatedClientIds(user);
  for (const assignedClientId of assignedClientIds) {
    if (normalizeKey(assignedClientId) !== effectiveRole) continue;
    const assignedClient = await clientModel.findById(assignedClientId);
    if (normalizeKey(assignedClient?.client_type) !== "direktorat") continue;
    if (await clientModel.isChildClientOf(requestedClientId, assignedClient.client_id)) {
      return true;
    }
  }
  return false;
}

export async function authorizeReportRequest(req, { source = "query" } = {}) {
  const user = req.user || {};
  const requestedValue =
    source === "body"
      ? req.body?.client_id || req.body?.clientId || req.query?.client_id || req.query?.clientId
      : req.query?.client_id;
  const requestedClientId = normalizeReportClientId(
    requestedValue || req.headers?.["x-client-id"] || user.client_id,
  );
  if (!requestedClientId) {
    return { error: { status: 400, message: "client_id wajib diisi" } };
  }

  const assignedClientIds = getAuthenticatedClientIds(user);
  const requestedKey = normalizeKey(requestedClientId);
  const isDirectlyAssigned = assignedClientIds.some((id) => normalizeKey(id) === requestedKey);
  const isSingleClientToken = Boolean(user.client_id) && assignedClientIds.length <= 1;

  if (
    (!isDirectlyAssigned ||
      (isSingleClientToken && normalizeKey(user.client_id) !== requestedKey)) &&
    !(await hasTrustedDirectorateAccess(user, requestedClientId, req.query?.scope))
  ) {
    return { error: { status: 403, message: "client_id tidak diizinkan" } };
  }

  return {
    clientId: requestedClientId,
    role: normalizeKey(user.role),
    scope: normalizeKey(req.query?.scope || user.scope) || "org",
  };
}

export function sendReportAuthorizationError(res, error) {
  return res.status(error.status).json({ success: false, message: error.message });
}
