import express from 'express';
import {
  registerClaimCredentials,
  getUserData,
  updateUserData,
} from '../controller/claimController.js';

const router = express.Router();

// Routes for claim registration via NRP + password
router.post('/register', registerClaimCredentials); // body: { nrp, password }
router.post('/user-data', getUserData); // body: { nrp, password }
router.put('/update', updateUserData); // body: { nrp, password, ... }
router.put('/edit', updateUserData); // backward-compatible alias for /claim/edit

export default router;
