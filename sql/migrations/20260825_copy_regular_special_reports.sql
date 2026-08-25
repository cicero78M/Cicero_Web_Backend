-- Copy regular reports whose shortcode belongs to a special task.
--
-- Safety properties:
-- - source rows in link_report are never updated or deleted;
-- - existing link_report_khusus rows are never overwritten;
-- - a persistent source snapshot supports later check-and-balance;
-- - the transaction is intended to be run once per database.

BEGIN;

CREATE TABLE audit_link_report_special_overlap_20260825 AS
SELECT
  lr.shortcode AS regular_shortcode,
  k.shortcode AS canonical_special_shortcode,
  lr.user_id,
  lr.instagram_link,
  lr.facebook_link,
  lr.twitter_link,
  lr.tiktok_link,
  lr.youtube_link,
  lr.created_at,
  md5(row_to_json(lr)::text) AS source_row_hash,
  NOW() AS snapshot_at
FROM link_report lr
JOIN insta_post_khusus k
  ON LOWER(k.shortcode) = LOWER(lr.shortcode);

COMMENT ON TABLE audit_link_report_special_overlap_20260825 IS
  'Immutable pre-migration snapshot: regular reports whose shortcode belongs to insta_post_khusus. Created 2026-08-25; source rows retained.';

INSERT INTO link_report_khusus (
  shortcode,
  user_id,
  instagram_link,
  facebook_link,
  twitter_link,
  tiktok_link,
  youtube_link,
  created_at
)
SELECT
  canonical_special_shortcode,
  user_id,
  instagram_link,
  facebook_link,
  twitter_link,
  tiktok_link,
  youtube_link,
  created_at
FROM audit_link_report_special_overlap_20260825
ON CONFLICT (shortcode, user_id) DO NOTHING;

COMMIT;

-- Check-and-balance. Expected after the 2026-08-25 production run:
-- snapshot_rows = source_hash_matches = target_covered = 1676
-- target_missing = 0; target_exact_matches = 1665; preserved_conflicts = 11
WITH live_source AS (
  SELECT
    lr.*,
    k.shortcode AS canonical_special_shortcode,
    md5(row_to_json(lr)::text) AS source_row_hash
  FROM link_report lr
  JOIN insta_post_khusus k
    ON LOWER(k.shortcode) = LOWER(lr.shortcode)
), comparison AS (
  SELECT
    a.*,
    lrk.shortcode IS NOT NULL AS target_exists,
    (
      lrk.instagram_link IS NOT DISTINCT FROM a.instagram_link
      AND lrk.facebook_link IS NOT DISTINCT FROM a.facebook_link
      AND lrk.twitter_link IS NOT DISTINCT FROM a.twitter_link
      AND lrk.tiktok_link IS NOT DISTINCT FROM a.tiktok_link
      AND lrk.youtube_link IS NOT DISTINCT FROM a.youtube_link
      AND lrk.created_at IS NOT DISTINCT FROM a.created_at
    ) AS target_exact_match
  FROM audit_link_report_special_overlap_20260825 a
  LEFT JOIN link_report_khusus lrk
    ON LOWER(lrk.shortcode) = LOWER(a.canonical_special_shortcode)
   AND lrk.user_id IS NOT DISTINCT FROM a.user_id
)
SELECT
  (SELECT COUNT(*)::int FROM live_source) AS regular_overlap_current,
  (SELECT COUNT(*)::int FROM audit_link_report_special_overlap_20260825) AS snapshot_rows,
  (
    SELECT COUNT(*)::int
    FROM live_source l
    JOIN audit_link_report_special_overlap_20260825 a
      ON l.shortcode = a.regular_shortcode
     AND l.user_id IS NOT DISTINCT FROM a.user_id
    WHERE l.source_row_hash = a.source_row_hash
  ) AS source_hash_matches,
  COUNT(*) FILTER (WHERE target_exists)::int AS target_covered,
  COUNT(*) FILTER (WHERE NOT target_exists)::int AS target_missing,
  COUNT(*) FILTER (WHERE target_exact_match)::int AS target_exact_matches,
  COUNT(*) FILTER (WHERE target_exists AND NOT target_exact_match)::int AS preserved_conflicts
FROM comparison;
