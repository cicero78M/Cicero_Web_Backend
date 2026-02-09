// src/model/adminWhatsappModel.js
import { query } from '../repository/db.js';

/**
 * Find an admin WhatsApp number
 * @param {string} whatsapp - WhatsApp number (digits only, e.g., '628123456789')
 * @returns {Promise<Object|null>} Admin WhatsApp record or null
 */
export async function findByWhatsapp(whatsapp) {
  if (!whatsapp || typeof whatsapp !== 'string') {
    return null;
  }
  
  const normalized = whatsapp.replace(/\D/g, '');
  if (!normalized) {
    return null;
  }
  
  const res = await query(
    'SELECT * FROM admin_whatsapp WHERE whatsapp = $1 AND is_active = TRUE',
    [normalized]
  );
  return res.rows[0] || null;
}

/**
 * Check if a WhatsApp number is registered as admin
 * @param {string} whatsapp - WhatsApp number (digits only or with @c.us)
 * @returns {Promise<boolean>} True if admin, false otherwise
 */
export async function isAdmin(whatsapp) {
  if (!whatsapp || typeof whatsapp !== 'string') {
    return false;
  }
  
  const normalized = whatsapp.replace(/\D/g, '');
  if (!normalized) {
    return false;
  }
  
  const res = await query(
    'SELECT 1 FROM admin_whatsapp WHERE whatsapp = $1 AND is_active = TRUE LIMIT 1',
    [normalized]
  );
  return res.rows.length > 0;
}

/**
 * Add a new admin WhatsApp number
 * @param {string} whatsapp - WhatsApp number (digits only)
 * @param {string} registeredBy - Username or identifier of who added this admin
 * @param {string} notes - Optional notes
 * @returns {Promise<Object>} Created admin WhatsApp record
 */
export async function create(whatsapp, registeredBy = null, notes = null) {
  if (!whatsapp || typeof whatsapp !== 'string') {
    throw new Error('WhatsApp number is required');
  }
  
  const normalized = whatsapp.replace(/\D/g, '');
  if (!normalized || normalized.length < 8) {
    throw new Error('Invalid WhatsApp number format');
  }
  
  const res = await query(
    `INSERT INTO admin_whatsapp (whatsapp, registered_by, notes)
     VALUES ($1, $2, $3)
     ON CONFLICT (whatsapp) DO UPDATE
     SET is_active = TRUE, registered_at = CURRENT_TIMESTAMP, registered_by = EXCLUDED.registered_by, notes = EXCLUDED.notes
     RETURNING *`,
    [normalized, registeredBy, notes]
  );
  return res.rows[0];
}

/**
 * Deactivate an admin WhatsApp number
 * @param {string} whatsapp - WhatsApp number (digits only)
 * @returns {Promise<Object|null>} Updated admin WhatsApp record or null
 */
export async function deactivate(whatsapp) {
  if (!whatsapp || typeof whatsapp !== 'string') {
    return null;
  }
  
  const normalized = whatsapp.replace(/\D/g, '');
  if (!normalized) {
    return null;
  }
  
  const res = await query(
    'UPDATE admin_whatsapp SET is_active = FALSE WHERE whatsapp = $1 RETURNING *',
    [normalized]
  );
  return res.rows[0] || null;
}

/**
 * Get all active admin WhatsApp numbers
 * @returns {Promise<Array>} List of admin WhatsApp records
 */
export async function findAll() {
  const res = await query(
    'SELECT * FROM admin_whatsapp WHERE is_active = TRUE ORDER BY registered_at DESC'
  );
  return res.rows;
}

/**
 * Get all admin WhatsApp numbers (active and inactive)
 * @returns {Promise<Array>} List of all admin WhatsApp records
 */
export async function findAllIncludingInactive() {
  const res = await query(
    'SELECT * FROM admin_whatsapp ORDER BY registered_at DESC'
  );
  return res.rows;
}
