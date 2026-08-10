BEGIN;

ALTER TABLE claim_complaints
  ADD COLUMN IF NOT EXISTS client_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS issue_type VARCHAR,
  ADD COLUMN IF NOT EXISTS triage_quality VARCHAR,
  ADD COLUMN IF NOT EXISTS triage_evidence JSONB,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE claim_complaints AS complaint
SET client_id = app_user.client_id
FROM "user" AS app_user
WHERE complaint.user_id = app_user.user_id
  AND complaint.client_id IS NULL;

UPDATE claim_complaints
SET issue_type = COALESCE(issue_type, 'activity_not_recorded'),
    triage_quality = COALESCE(triage_quality, triage_payload->>'triage_quality'),
    triage_evidence = COALESCE(triage_evidence, triage_payload->'triage_evidence'),
    status = CASE WHEN status = 'created' THEN 'triaged' ELSE status END;

ALTER TABLE claim_complaints
  ALTER COLUMN user_id TYPE VARCHAR(64),
  ALTER COLUMN client_id SET NOT NULL,
  ALTER COLUMN issue_type SET NOT NULL,
  ALTER COLUMN triage_quality SET NOT NULL,
  ALTER COLUMN triage_evidence SET NOT NULL,
  ALTER COLUMN content_id TYPE VARCHAR(100),
  ALTER COLUMN status SET DEFAULT 'triaged';

ALTER TABLE claim_complaints
  DROP CONSTRAINT IF EXISTS claim_complaints_status_check,
  DROP CONSTRAINT IF EXISTS claim_complaints_client_id_fkey,
  DROP CONSTRAINT IF EXISTS claim_complaints_resolved_at_check;

ALTER TABLE claim_complaints
  ADD CONSTRAINT claim_complaints_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(client_id),
  ADD CONSTRAINT claim_complaints_status_check
    CHECK (status IN (
      'triaged',
      'waiting_sync',
      'needs_user_action',
      'escalated',
      'resolved'
    )),
  ADD CONSTRAINT claim_complaints_resolved_at_check
    CHECK (
      (status = 'resolved' AND resolved_at IS NOT NULL)
      OR (status <> 'resolved' AND resolved_at IS NULL)
    );

COMMIT;
