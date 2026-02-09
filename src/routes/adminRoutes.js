// src/routes/adminRoutes.js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  startRegistration,
  checkRegistrationStatus,
  listAdmins,
  deactivateAdmin,
  checkIsAdmin
} from '../controller/adminWhatsappController.js';
import { verifyDashboardToken } from '../middleware/dashboardAuth.js';

const router = Router();

// Rate limiter for admin registration (stricter to prevent abuse)
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many registration attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for protected admin endpoints
const protectedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints (no auth required)
router.post('/register-whatsapp', registrationLimiter, startRegistration);
router.get('/register-whatsapp/:sessionId/status', checkRegistrationStatus);
router.get('/check-admin', checkIsAdmin);

// Protected endpoints (require dashboard admin auth)
router.get('/whatsapp', protectedLimiter, verifyDashboardToken, listAdmins);
router.delete('/whatsapp/:whatsapp', protectedLimiter, verifyDashboardToken, deactivateAdmin);

export default router;
