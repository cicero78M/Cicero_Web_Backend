import express from 'express';
import { getWaReadinessSummary } from '../service/waService.js';
import { getMessageDedupStats } from '../service/waEventAggregator.js';

const router = express.Router();

router.get('/', (req, res) => {
  const { clients, shouldInitWhatsAppClients } = getWaReadinessSummary();
  const dedupStats = getMessageDedupStats();
  
  res.status(200).json({
    status: 'ok',
    shouldInitWhatsAppClients,
    clients,
    messageDeduplication: {
      cacheSize: dedupStats.size,
      ttlMs: dedupStats.ttlMs,
      oldestEntryAgeMs: dedupStats.oldestEntryAgeMs,
      ttlHours: Math.round(dedupStats.ttlMs / 3600000),
    },
  });
});

export default router;
