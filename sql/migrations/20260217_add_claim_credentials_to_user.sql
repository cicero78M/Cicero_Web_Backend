ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS username VARCHAR,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username_unique
  ON "user" (LOWER(username))
  WHERE username IS NOT NULL;
