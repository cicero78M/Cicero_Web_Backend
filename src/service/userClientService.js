import { findClientIdByUserId } from '../model/userModel.js';

function normalizeClientId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function matchesClientId(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function assertClientIdAllowedByToken(resolvedClientId, tokenClientIds = []) {
  if (!resolvedClientId || !tokenClientIds.length) return;
  const normalizedResolved = String(resolvedClientId).toLowerCase();
  const normalizedTokenClientIds = tokenClientIds.map((clientId) =>
    String(clientId).toLowerCase()
  );
  if (!normalizedTokenClientIds.includes(normalizedResolved)) {
    throw createHttpError('client_id tidak diizinkan', 403);
  }
}

async function resolveClientIdForUserRole({ bodyClientId, queryClientId, userId }) {
  if (!userId) {
    throw createHttpError('user_id token tidak ditemukan', 401);
  }

  const dbClientId = await findClientIdByUserId(userId);
  if (!dbClientId) {
    throw createHttpError('client_id user tidak ditemukan', 403);
  }

  if (bodyClientId && !matchesClientId(bodyClientId, dbClientId)) {
    throw createHttpError('client_id tidak sesuai dengan profil user', 403);
  }

  if (!bodyClientId && queryClientId && !matchesClientId(queryClientId, dbClientId)) {
    throw createHttpError('client_id tidak sesuai dengan profil user', 403);
  }

  return bodyClientId || dbClientId || queryClientId;
}

export async function resolveClientIdForLinkReportKhusus({
  bodyClientId,
  queryClientId,
  authUser = {},
}) {
  const normalizedBodyClientId = normalizeClientId(bodyClientId);
  const normalizedQueryClientId = normalizeClientId(queryClientId);
  const role = String(authUser?.role || '').toLowerCase();

  if (role === 'user') {
    return resolveClientIdForUserRole({
      bodyClientId: normalizedBodyClientId,
      queryClientId: normalizedQueryClientId,
      userId: authUser?.user_id,
    });
  }

  const tokenClientIds = authUser?.client_ids
    ? Array.isArray(authUser.client_ids)
      ? authUser.client_ids
      : [authUser.client_ids]
    : [];

  const resolvedClientId =
    normalizedBodyClientId || normalizedQueryClientId || normalizeClientId(authUser?.client_id);

  if (!resolvedClientId) {
    throw createHttpError('client_id is required', 400);
  }

  assertClientIdAllowedByToken(resolvedClientId, tokenClientIds);

  return resolvedClientId;
}
