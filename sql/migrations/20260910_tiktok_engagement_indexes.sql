-- Keep the TikTok engagement recap under the reverse-proxy timeout.
-- The recap filters posts by client/date and joins role-tagged posts before
-- expanding the comments JSON array.
CREATE INDEX IF NOT EXISTS idx_tiktok_post_client_id
  ON tiktok_post (LOWER(client_id));

CREATE INDEX IF NOT EXISTS idx_tiktok_post_roles_role_video
  ON tiktok_post_roles (LOWER(role_name), video_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_post_created_at
  ON tiktok_post (created_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_post_original_created_at
  ON tiktok_post (original_created_at);
