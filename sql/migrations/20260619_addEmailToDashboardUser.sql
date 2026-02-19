-- Add email column to dashboard_user table
ALTER TABLE dashboard_user
  ADD COLUMN IF NOT EXISTS email VARCHAR;
