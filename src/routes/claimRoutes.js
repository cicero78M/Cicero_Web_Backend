import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  confirmClaimPasswordReset,
  requestClaimPasswordReset,
  verifyClaimPasswordResetOtp,
  registerClaimCredentials,
  getUserData,
  getClaimMe,
  updateUserData,
  updateClaimMe,
  getPendingContent,
  validateClaimSocialProfile,
} from '../controller/claimController.js';
import { authRequired } from '../middleware/authMiddleware.js';
import { claimUserRoleRequired } from '../middleware/claimRoleMiddleware.js';
import { triageClaimComplaint } from '../controller/claimComplaintController.js';
import {
  escalateClaimComplaint,
  getClaimComplaints,
  resolveClaimComplaint,
} from '../controller/claimComplaintLifecycleController.js';

const router = express.Router();
const claimSocialValidationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'CLAIM_SOCIAL_VALIDATION_RATE_LIMITED',
    message: 'Terlalu banyak permintaan validasi. Coba lagi nanti.',
  },
});

// Routes for claim registration via NRP + password
router.post('/register', registerClaimCredentials); // body: { nrp, password }
router.post('/password-reset/request', requestClaimPasswordReset); // body: { nrp, channel?, destination? }
router.post('/password-reset/verify', verifyClaimPasswordResetOtp); // body: { request_id, otp }
router.post('/password-reset/confirm', confirmClaimPasswordReset); // body: { token, password, confirmPassword }
router.post('/user-data', getUserData); // body: { nrp, password }
router.put('/update', updateUserData); // body: { nrp, password, ... }
router.put('/edit', updateUserData); // backward-compatible alias for /claim/edit
router.get('/me', authRequired, getClaimMe);
router.put('/me', authRequired, updateClaimMe);
router.get('/pending-content', authRequired, getPendingContent);
router.post(
  '/complaints/triage',
  authRequired,
  claimUserRoleRequired,
  triageClaimComplaint
);
router.get(
  '/complaints',
  authRequired,
  claimUserRoleRequired,
  getClaimComplaints
);
router.get(
  '/complaints/:complaintId',
  authRequired,
  claimUserRoleRequired,
  getClaimComplaints
);
router.post(
  '/complaints/:complaintId/escalate',
  authRequired,
  claimUserRoleRequired,
  escalateClaimComplaint
);
router.post(
  '/complaints/:complaintId/resolve',
  authRequired,
  claimUserRoleRequired,
  resolveClaimComplaint
);
router.post(
  '/social-profile/validate',
  authRequired,
  claimSocialValidationLimiter,
  validateClaimSocialProfile
);

export default router;
