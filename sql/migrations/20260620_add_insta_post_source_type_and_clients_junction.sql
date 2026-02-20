ALTER TABLE insta_post
  ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'manual_input',
  ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS insta_post_clients (
  shortcode VARCHAR NOT NULL REFERENCES insta_post(shortcode) ON DELETE CASCADE,
  client_id VARCHAR NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shortcode, client_id)
);

CREATE INDEX IF NOT EXISTS idx_insta_post_clients_client_id
  ON insta_post_clients (client_id);

INSERT INTO insta_post_clients (shortcode, client_id)
SELECT p.shortcode, p.client_id
FROM insta_post p
WHERE p.client_id IS NOT NULL
ON CONFLICT (shortcode, client_id) DO NOTHING;

UPDATE insta_post
SET source_type = 'manual_input'
WHERE source_type IS NULL;
