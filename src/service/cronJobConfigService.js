// src/service/cronJobConfigService.js

import * as cronJobConfigModel from '../model/cronJobConfigModel.js';

/**
 * Get all cron job configurations
 */
export const list = async () => {
  return await cronJobConfigModel.findAll();
};

/**
 * Get a specific cron job by job_key
 */
export const getByJobKey = async (jobKey) => {
  return await cronJobConfigModel.findByJobKey(jobKey);
};

/**
 * Update cron job status
 */
export const updateCronJobStatus = async (jobKey, isActive) => {
  const updated = await cronJobConfigModel.updateStatus(jobKey, isActive);
  if (!updated) {
    throw new Error(`Cron job with key '${jobKey}' not found`);
  }
  return updated;
};

/**
 * Create a new cron job configuration
 */
export const createCronJob = async (data) => {
  return await cronJobConfigModel.create(data);
};

/**
 * Delete a cron job configuration
 */
export const deleteCronJob = async (jobKey) => {
  const deleted = await cronJobConfigModel.remove(jobKey);
  if (!deleted) {
    throw new Error(`Cron job with key '${jobKey}' not found`);
  }
  return deleted;
};
