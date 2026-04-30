CREATE TABLE IF NOT EXISTS system_management_fund_transaction (
  transaction_id UUID PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  description TEXT,
  created_by_chat_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_management_fund_request (
  request_id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  requested_amount NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0),
  requested_by_chat_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note TEXT,
  approved_by_chat_id VARCHAR(64),
  approved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_management_fund_audit (
  audit_id UUID PRIMARY KEY,
  action_type VARCHAR(60) NOT NULL,
  actor_telegram_chat_id VARCHAR(64) NOT NULL,
  actor_admin_role VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_fund_tx_created_at ON system_management_fund_transaction (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_fund_req_status ON system_management_fund_request (status);
CREATE INDEX IF NOT EXISTS idx_sys_fund_audit_created_at ON system_management_fund_audit (created_at DESC);
