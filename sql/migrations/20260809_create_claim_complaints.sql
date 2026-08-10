CREATE TABLE claim_complaints (
  complaint_id UUID PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  platform VARCHAR NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
  content_id VARCHAR NOT NULL,
  triage_code VARCHAR NOT NULL,
  triage_payload JSONB NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'escalated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escalated_at TIMESTAMPTZ,
  UNIQUE (user_id, platform, content_id)
);

CREATE TABLE claim_complaint_notifications (
  complaint_id UUID NOT NULL REFERENCES claim_complaints(complaint_id) ON DELETE CASCADE,
  event_type VARCHAR NOT NULL CHECK (event_type IN ('created', 'escalated')),
  status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error VARCHAR,
  delivery_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (complaint_id, event_type)
);

CREATE INDEX idx_claim_complaint_notifications_retry
  ON claim_complaint_notifications (status, next_retry_at);
