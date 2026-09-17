-- Relational projection of Instagram likes.
-- Keep this migration separate from the backfill so table creation is quick.
CREATE TABLE IF NOT EXISTS insta_like_users (
  shortcode TEXT NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (shortcode, username)
);

CREATE INDEX IF NOT EXISTS idx_insta_like_users_username_shortcode
  ON insta_like_users (username, shortcode);

CREATE INDEX IF NOT EXISTS idx_insta_like_users_shortcode
  ON insta_like_users (shortcode);
