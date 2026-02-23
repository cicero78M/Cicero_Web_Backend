-- Migration: Create user_social_accounts table for multi-account social media support
-- Purpose: Add normalized social account storage while keeping legacy user.insta/user.tiktok compatibility
-- Date: 2026-06-02

CREATE TABLE IF NOT EXISTS user_social_accounts (
  social_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
  username TEXT NOT NULL,
  account_order SMALLINT NOT NULL DEFAULT 1 CHECK (account_order >= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, platform, account_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_social_accounts_platform_username_lower_unique
ON user_social_accounts (platform, LOWER(username));

CREATE OR REPLACE FUNCTION set_user_social_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_social_accounts_set_updated_at ON user_social_accounts;
CREATE TRIGGER user_social_accounts_set_updated_at
BEFORE UPDATE ON user_social_accounts
FOR EACH ROW
EXECUTE PROCEDURE set_user_social_accounts_updated_at();

INSERT INTO user_social_accounts (user_id, platform, username, account_order, is_active)
SELECT u.user_id, 'instagram', u.insta, 1, TRUE
FROM "user" u
WHERE u.insta IS NOT NULL
  AND btrim(u.insta) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO user_social_accounts (user_id, platform, username, account_order, is_active)
SELECT u.user_id, 'tiktok', u.tiktok, 1, TRUE
FROM "user" u
WHERE u.tiktok IS NOT NULL
  AND btrim(u.tiktok) <> ''
ON CONFLICT DO NOTHING;
