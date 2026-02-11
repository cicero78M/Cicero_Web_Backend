// src/utils/waHelper.js
// Minimal utility functions for WhatsApp number normalization
// (WhatsApp client functionality removed - using Telegram only)

export const minPhoneDigitLength = 8;

/**
 * Normalize WhatsApp number by removing non-digit characters
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {string|null} - Normalized phone number or null
 */
export function normalizeWhatsappNumber(phoneNumber) {
  if (!phoneNumber) return null;
  const normalized = String(phoneNumber).replace(/\D/g, '');
  if (normalized.length < minPhoneDigitLength) return null;
  return normalized;
}

/**
 * Format phone number to WhatsApp ID format
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} - Formatted WhatsApp ID
 */
export function formatToWhatsAppId(phoneNumber) {
  if (!phoneNumber) return '';
  const cleaned = String(phoneNumber).replace(/\D/g, '');
  return cleaned ? `${cleaned}@c.us` : '';
}

/**
 * Normalize user WhatsApp ID
 * @param {string} whatsappId - WhatsApp ID to normalize
 * @returns {string} - Normalized WhatsApp ID
 */
export function normalizeUserWhatsAppId(whatsappId) {
  if (!whatsappId) return '';
  const str = String(whatsappId);
  if (str.endsWith('@c.us')) return str;
  const cleaned = str.replace(/\D/g, '');
  return cleaned ? `${cleaned}@c.us` : '';
}
