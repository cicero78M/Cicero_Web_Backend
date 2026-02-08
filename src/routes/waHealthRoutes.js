import express from 'express';
import { getWaReadinessSummary } from '../service/waService.js';

const router = express.Router();

router.get('/', (req, res) => {
  const { clients, shouldInitWhatsAppClients } = getWaReadinessSummary();
  
  res.status(200).json({
    status: 'ok',
    mode: 'send-only',
    shouldInitWhatsAppClients,
    clients,
    note: 'Message reception disabled - client configured for send-only mode',
  });
});

export default router;
