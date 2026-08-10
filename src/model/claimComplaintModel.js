import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../repository/db.js';
import { claimComplaintDeduplicationWindowMs } from '../config/claimComplaintLifecycle.js';

export async function createComplaint({
  userId,
  clientId,
  platform,
  contentId,
  issueType,
  triage,
}) {
  const complaintId = randomUUID();
  const deduplicationKey = `${userId}\u0000${platform}\u0000${contentId}`;

  return withTransaction(async (client) => {
    // Serialize equivalent report attempts for the duration of this transaction.
    // PostgreSQL derives a stable 64-bit lock key from the complete identity;
    // the transaction-scoped lock is automatically released at transaction end.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [deduplicationKey]
    );

    const existing = await findComplaintForUser(
      { userId, platform, contentId },
      client
    );
    if (existing) return { complaint: existing, created: false };

    const { rows } = await client.query(
      `INSERT INTO claim_complaints
       (complaint_id, user_id, client_id, platform, content_id, issue_type,
        triage_code, triage_quality, triage_evidence, triage_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     RETURNING *`,
      [
        complaintId,
        userId,
        clientId,
        platform,
        contentId,
        issueType,
        triage.triage_code,
        triage.triage_quality,
        JSON.stringify(triage.triage_evidence),
        JSON.stringify(triage),
      ]
    );
    return { complaint: rows[0], created: true };
  });
}

export async function findComplaintForUser(
  { userId, platform, contentId },
  database = { query }
) {
  const { rows } = await database.query(
    `SELECT * FROM claim_complaints
     WHERE user_id = $1
       AND platform = $2
       AND content_id = $3
       AND status <> 'resolved'
       AND created_at > NOW() - ($4 * INTERVAL '1 millisecond')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, platform, contentId, claimComplaintDeduplicationWindowMs]
  );
  return rows[0] ?? null;
}

export async function transitionComplaintStatus({
  complaintId,
  userId,
  expectedStatus,
  nextStatus,
}) {
  const { rows } = await query(
    `UPDATE claim_complaints
     SET status = $4,
         escalated_at = CASE WHEN $4 = 'escalated' THEN NOW() ELSE escalated_at END,
         resolved_at = CASE WHEN $4 = 'resolved' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE complaint_id = $1 AND user_id = $2 AND status = $3
     RETURNING *`,
    [complaintId, userId, expectedStatus, nextStatus]
  );
  return rows[0] ?? null;
}

export async function findComplaintById(complaintId, userId) {
  const { rows } = await query(
    'SELECT * FROM claim_complaints WHERE complaint_id = $1 AND user_id = $2',
    [complaintId, userId]
  );
  return rows[0] ?? null;
}

const complaintLifecycleColumns = `
  complaint_id, platform, content_id, issue_type, status,
  triage_code, triage_quality, triage_evidence,
  created_at, updated_at, escalated_at, resolved_at`;

export async function findComplaintsByUserId(userId) {
  const { rows } = await query(
    `SELECT ${complaintLifecycleColumns}
     FROM claim_complaints
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function findComplaintLifecycleById(complaintId, userId) {
  const { rows } = await query(
    `SELECT ${complaintLifecycleColumns}
     FROM claim_complaints
     WHERE complaint_id = $1 AND user_id = $2`,
    [complaintId, userId]
  );
  return rows[0] ?? null;
}
