export function claimUserRoleRequired(req, res, next) {
  if (String(req.user?.role || '').toLowerCase() !== 'user') {
    return res.status(403).json({
      success: false,
      error_code: 'CLAIM_USER_ROLE_REQUIRED',
      message: 'Endpoint hanya dapat diakses oleh user',
    });
  }

  return next();
}
