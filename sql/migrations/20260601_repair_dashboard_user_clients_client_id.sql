ALTER TABLE dashboard_user_clients
  ADD COLUMN IF NOT EXISTS client_id VARCHAR REFERENCES clients(client_id) ON DELETE CASCADE;
