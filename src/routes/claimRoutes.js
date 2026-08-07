import express from 'express';
import {
  confirmClaimPasswordReset,
  requestClaimPasswordReset,
  verifyClaimPasswordResetOtp,
  registerClaimCredentials,
  getUserData,
  updateUserData,
  getPendingContent,
} from '../controller/claimController.js';
import { authRequired } from '../middleware/authMiddleware.js';

const router = express.Router();

// Routes for claim registration via NRP + password
router.post('/register', registerClaimCredentials); // body: { nrp, password }
router.post('/password-reset/request', requestClaimPasswordReset); // body: { nrp, channel?, destination? }
router.post('/password-reset/verify', verifyClaimPasswordResetOtp); // body: { request_id, otp }
router.post('/password-reset/confirm', confirmClaimPasswordReset); // body: { token, password, confirmPassword }
router.post('/user-data', getUserData); // body: { nrp, password }
router.put('/update', updateUserData); // body: { nrp, password, ... }
router.put('/edit', updateUserData); // backward-compatible alias for /claim/edit
router.get('/pending-content', authRequired, getPendingContent);

export default router;
