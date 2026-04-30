CREATE TABLE IF NOT EXISTS system_management_config_audit (
  audit_id UUID PRIMARY KEY,
  actor_telegram_chat_id VARCHAR(64) NOT NULL,
  action_type VARCHAR(60) NOT NULL,
  config_key VARCHAR(120) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_mgmt_config_audit_created_at
  ON system_management_config_audit (created_at DESC);
