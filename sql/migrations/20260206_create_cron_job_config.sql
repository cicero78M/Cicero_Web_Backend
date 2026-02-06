-- Migration to create cron_job_config table for managing cron job configurations

CREATE TABLE IF NOT EXISTS cron_job_config (
  job_key VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(255),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION set_cron_job_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cron_job_config_set_updated_at ON cron_job_config;
CREATE TRIGGER cron_job_config_set_updated_at
BEFORE UPDATE ON cron_job_config
FOR EACH ROW
EXECUTE PROCEDURE set_cron_job_config_updated_at();

-- Insert some default cron job configurations
INSERT INTO cron_job_config (job_key, display_name, description, is_active)
VALUES 
  ('daily_report', 'Laporan Harian', 'Generate daily reports', TRUE),
  ('weekly_summary', 'Ringkasan Mingguan', 'Generate weekly summaries', TRUE),
  ('monthly_analytics', 'Analitik Bulanan', 'Generate monthly analytics', FALSE)
ON CONFLICT (job_key) DO NOTHING;
