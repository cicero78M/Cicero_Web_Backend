-- Run after 20260913_insta_like_users.sql as the database owner.
-- This is intentionally separate because it may process a large JSONB table.
INSERT INTO insta_like_users (shortcode, username)
SELECT
  l.shortcode,
  lower(replace(trim(
    COALESCE(elem->>'username', trim(both '"' FROM elem::text))
  ), '@', '')) AS username
FROM insta_like l
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.likes, '[]'::jsonb)) AS elem
WHERE trim(COALESCE(elem->>'username', trim(both '"' FROM elem::text))) <> ''
ON CONFLICT (shortcode, username) DO NOTHING;

ANALYZE insta_like_users;
