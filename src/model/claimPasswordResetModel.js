import { query } from '../repository/db.js';

export async function createResetRequest({
  userId,
  deliveryTarget,
  resetToken,
  expiresAt,
}) {
  const { rows } = await query(
    `INSERT INTO claim_password_resets (user_id, delivery_target, reset_token, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, deliveryTarget, resetToken, expiresAt],
  );
  return rows[0] ?? null;
}

export async function findActiveByToken(resetToken) {
  const { rows } = await query(
    `SELECT *
     FROM claim_password_resets
     WHERE reset_token = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [resetToken],
  );
  return rows[0] ?? null;
}

export async function markTokenUsed(resetToken) {
  const { rows } = await query(
    `UPDATE claim_password_resets
     SET used_at = NOW(), updated_at = NOW()
     WHERE reset_token = $1
     RETURNING *`,
    [resetToken],
  );
  return rows[0] ?? null;
}
