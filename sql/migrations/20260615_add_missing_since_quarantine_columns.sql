-- Add quarantine timestamp columns for Instagram post cleanup safety
ALTER TABLE insta_post
ADD COLUMN IF NOT EXISTS is_missing_since TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS insta_post_missing_since_idx
ON insta_post (is_missing_since)
WHERE is_missing_since IS NOT NULL;

ALTER TABLE satbinmas_official_media
ADD COLUMN IF NOT EXISTS is_missing_since TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS satbinmas_official_media_missing_since_idx
ON satbinmas_official_media (is_missing_since)
WHERE is_missing_since IS NOT NULL;
