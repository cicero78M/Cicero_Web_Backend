ALTER TABLE tiktok_post
  ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'cron_fetch',
  ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMP NULL;

UPDATE tiktok_post
SET original_created_at = created_at
WHERE original_created_at IS NULL;

UPDATE tiktok_post
SET source_type = 'cron_fetch'
WHERE source_type IS NULL OR TRIM(source_type) = '';
