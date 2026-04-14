-- Create claim_password_resets table for tracking claim password reset requests
CREATE TABLE IF NOT EXISTS claim_password_resets (
    reset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR REFERENCES "user"(user_id) ON DELETE CASCADE,
    delivery_target TEXT NOT NULL,
    reset_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS claim_password_resets_user_idx
    ON claim_password_resets (user_id, expires_at)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS claim_password_resets_token_idx
    ON claim_password_resets (reset_token);
