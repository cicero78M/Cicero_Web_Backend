ALTER TABLE dashboard_user
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

UPDATE dashboard_user
SET approval_status = 'approved'
WHERE status IS TRUE
  AND approval_status <> 'approved';

UPDATE dashboard_user
SET approval_status = 'pending'
WHERE status IS FALSE
  AND approval_status NOT IN ('pending', 'rejected');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dashboard_user_approval_status_check'
  ) THEN
    ALTER TABLE dashboard_user
      ADD CONSTRAINT dashboard_user_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboard_user_approval_status_created_at
  ON dashboard_user (approval_status, created_at);
