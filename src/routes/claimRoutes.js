import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  confirmClaimPasswordReset,
  confirmClaimRecoveryEmail,
  requestClaimPasswordReset,
  verifyClaimPasswordResetOtp,
  registerClaimCredentials,
  verifyClaimRegistrationOtp,
  requestClaimEmailUpdate,
  verifyClaimEmailUpdate,
  requestClaimWhatsappOtp,
  verifyClaimWhatsappOtp,
  getUserData,
  getClaimMe,
  updateUserData,
  updateClaimMe,
  getPendingContent,
  validateClaimSocialProfile,
} from '../controller/claimController.js';
import { claimAuthRequired } from '../middleware/authMiddleware.js';
import { claimUserRoleRequired } from '../middleware/claimRoleMiddleware.js';
import { triageClaimComplaint } from '../controller/claimComplaintController.js';
import {
  escalateClaimComplaint,
  getClaimComplaints,
  resolveClaimComplaint,
} from '../controller/claimComplaintLifecycleController.js';
import * as userModel from '../model/userModel.js';

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
router.post('/register', registerClaimCredentials); // body: { nrp, email, password }
router.post('/register/verify', verifyClaimRegistrationOtp);
router.post('/password-reset/request', requestClaimPasswordReset); // body: { nrp, channel?, destination? }
router.post('/password-reset/confirm-email', confirmClaimRecoveryEmail); // body: { token }
router.post('/password-reset/verify', verifyClaimPasswordResetOtp); // body: { request_id, otp }
router.post('/password-reset/confirm', confirmClaimPasswordReset); // body: { token, password, confirmPassword }
router.post('/user-data', getUserData); // body: { nrp, password }
router.put('/update', updateUserData); // body: { nrp, password, ... }
router.put('/edit', updateUserData); // backward-compatible alias for /claim/edit
router.get('/me', claimAuthRequired, getClaimMe);
router.get('/satfung-options', claimAuthRequired, async (req, res, next) => {
  try {
    const userId = req.user?.user_id;
    const profile = await userModel.findClaimProfileById(userId);
    if (!profile?.client_id) {
      return res.json({ success: true, data: [] });
    }
    const options = await userModel.getClaimSatfungOptions(profile.client_id);
    return res.json({ success: true, data: options });
  } catch (error) {
    return next(error);
  }
});
router.put('/me', claimAuthRequired, updateClaimMe);
router.post('/email/request', claimAuthRequired, requestClaimEmailUpdate);
router.post('/email/verify', claimAuthRequired, verifyClaimEmailUpdate);
router.post('/whatsapp/request', claimAuthRequired, requestClaimWhatsappOtp);
router.post('/whatsapp/verify', claimAuthRequired, verifyClaimWhatsappOtp);
router.get('/pending-content', claimAuthRequired, getPendingContent);
router.post(
  '/complaints/triage',
  claimAuthRequired,
  claimUserRoleRequired,
  triageClaimComplaint
);
router.get(
  '/complaints',
  claimAuthRequired,
  claimUserRoleRequired,
  getClaimComplaints
);
router.get(
  '/complaints/:complaintId',
  claimAuthRequired,
  claimUserRoleRequired,
  getClaimComplaints
);
router.post(
  '/complaints/:complaintId/escalate',
  claimAuthRequired,
  claimUserRoleRequired,
  escalateClaimComplaint
);
router.post(
  '/complaints/:complaintId/resolve',
  claimAuthRequired,
  claimUserRoleRequired,
  resolveClaimComplaint
);
router.post(
  '/social-profile/validate',
  claimAuthRequired,
  claimSocialValidationLimiter,
  validateClaimSocialProfile
);

export default router;
