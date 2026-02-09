-- Migration: Create admin_whatsapp table
-- Purpose: Store admin WhatsApp numbers registered via Baileys pairing
-- Date: 2026-02-09

CREATE TABLE IF NOT EXISTS admin_whatsapp (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) NOT NULL UNIQUE,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registered_by VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  CONSTRAINT admin_whatsapp_format_check CHECK (whatsapp ~ '^[0-9]+$')
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_whatsapp_active ON admin_whatsapp(whatsapp) WHERE is_active = TRUE;

-- Insert comment
COMMENT ON TABLE admin_whatsapp IS 'Stores WhatsApp numbers of registered admins';
COMMENT ON COLUMN admin_whatsapp.whatsapp IS 'WhatsApp number in format: 628123456789 (digits only, no @c.us)';
COMMENT ON COLUMN admin_whatsapp.registered_by IS 'Username or identifier of who added this admin';
COMMENT ON COLUMN admin_whatsapp.is_active IS 'Whether this admin is currently active';
