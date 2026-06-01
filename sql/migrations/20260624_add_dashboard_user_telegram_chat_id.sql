ALTER TABLE dashboard_user
  ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS dashboard_user_telegram_chat_id_idx
  ON dashboard_user (telegram_chat_id);
