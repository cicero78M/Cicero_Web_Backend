BEGIN;

-- Deduplication is lifecycle-aware in claimComplaintModel. A permanent unique
-- constraint would incorrectly prevent a fresh report after resolution/window.
ALTER TABLE claim_complaints
  DROP CONSTRAINT IF EXISTS claim_complaints_user_id_platform_content_id_key;

CREATE INDEX IF NOT EXISTS idx_claim_complaints_active_deduplication
  ON claim_complaints (user_id, platform, content_id, created_at DESC)
  WHERE status <> 'resolved';

COMMIT;
