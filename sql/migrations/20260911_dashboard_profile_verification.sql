ALTER TABLE dashboard_user
  ADD COLUMN IF NOT EXISTS nama VARCHAR(150),
  ADD COLUMN IF NOT EXISTS pangkat VARCHAR(100),
  ADD COLUMN IF NOT EXISTS nrp VARCHAR(50),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_dashboard_user_nrp ON dashboard_user (nrp);
CREATE INDEX IF NOT EXISTS idx_dashboard_user_verification
  ON dashboard_user (email_verified, whatsapp_verified);
