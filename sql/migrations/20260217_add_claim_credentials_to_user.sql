ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE "user"
  DROP COLUMN IF EXISTS username;

DROP INDEX IF EXISTS idx_user_username_unique;
