function normalizeUserId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Bind self-service report mutations to the authenticated user while keeping
 * the existing operator/admin payload contract intact.
 */
export function resolveLinkReportMutationUserId(req, requestedUserId) {
  const role = String(req.user?.role || '').trim().toLowerCase();

  if (role === 'user') {
    const authenticatedUserId = normalizeUserId(req.user?.user_id);
    if (!authenticatedUserId) {
      throw createHttpError('user_id token tidak ditemukan', 401);
    }
    return authenticatedUserId;
  }

  const normalizedRequestedUserId = normalizeUserId(requestedUserId);
  if (!normalizedRequestedUserId) {
    throw createHttpError('user_id wajib diisi', 400);
  }
  return normalizedRequestedUserId;
}
