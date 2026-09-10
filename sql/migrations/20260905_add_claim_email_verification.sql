CREATE TABLE IF NOT EXISTS claim_email_verifications (
  user_id VARCHAR PRIMARY KEY REFERENCES "user"(user_id) ON DELETE CASCADE,
  verified_email TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_email_verifications_email
  ON claim_email_verifications (LOWER(verified_email));
