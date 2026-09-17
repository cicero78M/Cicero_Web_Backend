-- Indexes for premium dashboard recap filters and joins.
-- Keep JSONB expansion out of the indexed expression; these indexes reduce
-- the candidate post/user rows before the recap expands likes/comments.
CREATE INDEX IF NOT EXISTS idx_insta_post_client_created_at
  ON insta_post (LOWER(client_id), created_at);

CREATE INDEX IF NOT EXISTS idx_insta_post_client_original_created_at
  ON insta_post (LOWER(client_id), original_created_at);

CREATE INDEX IF NOT EXISTS idx_insta_like_shortcode
  ON insta_like (shortcode);

CREATE INDEX IF NOT EXISTS idx_insta_post_roles_role_shortcode
  ON insta_post_roles (LOWER(role_name), shortcode);

CREATE INDEX IF NOT EXISTS idx_user_social_accounts_user_platform_active
  ON user_social_accounts (user_id, LOWER(platform))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_tiktok_post_client_created_at
  ON tiktok_post (LOWER(client_id), created_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_post_client_original_created_at
  ON tiktok_post (LOWER(client_id), original_created_at);
