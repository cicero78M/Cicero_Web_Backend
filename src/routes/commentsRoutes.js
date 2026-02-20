import { Router } from 'express';
import { getTiktokRekapKomentar } from '../controller/tiktokController.js';
import { verifyDashboardOrClientToken } from '../middleware/dashboardAuth.js';

const router = Router();

router.use(verifyDashboardOrClientToken);
router.get('/tiktok', getTiktokRekapKomentar);

export default router;
