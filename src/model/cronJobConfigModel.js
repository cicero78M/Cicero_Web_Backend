// src/model/cronJobConfigModel.js

import { query } from '../repository/db.js';

/**
 * Get all cron job configurations
 */
export const findAll = async () => {
  const res = await query(
    'SELECT job_key, display_name, description, is_active, created_at, updated_at FROM cron_job_config ORDER BY job_key'
  );
  return res.rows;
};

/**
 * Find a specific cron job by job_key
 */
export const findByJobKey = async (jobKey) => {
  const res = await query(
    'SELECT job_key, display_name, description, is_active, created_at, updated_at FROM cron_job_config WHERE job_key = $1',
    [jobKey]
  );
  return res.rows[0] || null;
};

/**
 * Update cron job status
 */
export const updateStatus = async (jobKey, isActive) => {
  const res = await query(
    'UPDATE cron_job_config SET is_active = $2 WHERE job_key = $1 RETURNING job_key, display_name, description, is_active, created_at, updated_at',
    [jobKey, isActive]
  );
  return res.rows[0] || null;
};

/**
 * Create a new cron job configuration
 */
export const create = async (data) => {
  const { jobKey, displayName, description, isActive = true } = data;
  const res = await query(
    'INSERT INTO cron_job_config (job_key, display_name, description, is_active) VALUES ($1, $2, $3, $4) RETURNING job_key, display_name, description, is_active, created_at, updated_at',
    [jobKey, displayName, description, isActive]
  );
  return res.rows[0];
};

/**
 * Delete a cron job configuration
 */
export const remove = async (jobKey) => {
  const res = await query(
    'DELETE FROM cron_job_config WHERE job_key = $1 RETURNING job_key',
    [jobKey]
  );
  return res.rows[0] || null;
};
