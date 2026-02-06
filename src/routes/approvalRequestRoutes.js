import express from 'express';
import * as controller from '../controller/approvalRequestController.js';
import { verifyPenmasToken } from '../middleware/penmasAuth.js';

const router = express.Router();

router.use(verifyPenmasToken);
router.get('/', controller.getApprovals);
router.post('/', controller.createApproval);
router.put('/:id', controller.updateApproval);

export default router;
