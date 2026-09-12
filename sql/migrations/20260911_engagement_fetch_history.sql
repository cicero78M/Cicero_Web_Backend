ALTER TABLE insta_like_audit
  ADD COLUMN IF NOT EXISTS fetch_run_id UUID,
  ADD COLUMN IF NOT EXISTS observed_usernames JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tiktok_comment_audit
  ADD COLUMN IF NOT EXISTS fetch_run_id UUID,
  ADD COLUMN IF NOT EXISTS observed_usernames JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_insta_like_audit_run
  ON insta_like_audit (fetch_run_id, shortcode)
  WHERE fetch_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tiktok_comment_audit_run
  ON tiktok_comment_audit (fetch_run_id, video_id)
  WHERE fetch_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insta_like_audit_observed_gin
  ON insta_like_audit USING GIN (observed_usernames);

CREATE INDEX IF NOT EXISTS idx_tiktok_comment_audit_observed_gin
  ON tiktok_comment_audit USING GIN (observed_usernames);
