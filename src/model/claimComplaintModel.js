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

export async function escalateComplaint(complaintId, userId) {
  const { rows } = await query(
    `UPDATE claim_complaints
     SET status = 'escalated', escalated_at = NOW(), updated_at = NOW()
     WHERE complaint_id = $1 AND user_id = $2 AND status <> 'escalated'
     RETURNING *`,
    [complaintId, userId]
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

export async function reserveNotification(
  complaintId,
  eventType,
  maxAttempts = 3
) {
  await query(
    `INSERT INTO claim_complaint_notifications (complaint_id, event_type)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [complaintId, eventType]
  );
  const { rows } = await query(
    `UPDATE claim_complaint_notifications
     SET status = 'pending', attempt_count = attempt_count + 1,
         last_attempt_at = NOW(), next_retry_at = NULL, updated_at = NOW()
     WHERE complaint_id = $1 AND event_type = $2
       AND status IN ('pending', 'failed')
       AND attempt_count < $3
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     RETURNING *`,
    [complaintId, eventType, maxAttempts]
  );
  return rows[0] ?? null;
}

export async function finishNotification(complaintId, eventType, result) {
  const retryDelayMinutes = Math.min(
    30,
    2 ** Math.max(0, result.attemptCount - 1)
  );
  const { rows } = await query(
    `UPDATE claim_complaint_notifications
     SET status = $3, delivery_result = $4::jsonb, last_error = $5,
         sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END,
         next_retry_at = CASE WHEN $3 = 'failed'
           THEN NOW() + ($6 * INTERVAL '1 minute') ELSE NULL END,
         updated_at = NOW()
     WHERE complaint_id = $1 AND event_type = $2 RETURNING *`,
    [
      complaintId,
      eventType,
      result.status,
      JSON.stringify(result.deliveryResult || null),
      result.error || null,
      retryDelayMinutes,
    ]
  );
  return rows[0] ?? null;
}

export async function findNotification(complaintId, eventType) {
  const { rows } = await query(
    `SELECT * FROM claim_complaint_notifications
     WHERE complaint_id = $1 AND event_type = $2`,
    [complaintId, eventType]
  );
  return rows[0] ?? null;
}
