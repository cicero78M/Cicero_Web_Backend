// src/routes/adminRoutes.js
import { Router } from 'express';
import {
  startRegistration,
  checkRegistrationStatus,
  listAdmins,
  deactivateAdmin,
  checkIsAdmin
} from '../controller/adminWhatsappController.js';
import { verifyDashboardToken } from '../middleware/dashboardAuth.js';

const router = Router();

// Public endpoints (no auth required)
router.post('/register-whatsapp', startRegistration);
router.get('/register-whatsapp/:sessionId/status', checkRegistrationStatus);
router.get('/check-admin', checkIsAdmin);

// Protected endpoints (require dashboard admin auth)
router.get('/whatsapp', verifyDashboardToken, listAdmins);
router.delete('/whatsapp/:whatsapp', verifyDashboardToken, deactivateAdmin);

export default router;
