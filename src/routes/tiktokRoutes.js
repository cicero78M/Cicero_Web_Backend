import { Router } from 'express';
import {
  getTiktokComments,
  getTiktokRekapKomentar,
  getTiktokPosts,
  getRapidTiktokProfile,
  getRapidTiktokPosts,
  getRapidTiktokInfo
} from '../controller/tiktokController.js';
import { postComplaintTiktok } from '../controller/complaintController.js';
import { verifyDashboardOrClientToken } from '../middleware/dashboardAuth.js';

const router = Router();

router.use(verifyDashboardOrClientToken);
router.get('/comments', getTiktokComments);
router.post('/komplain', postComplaintTiktok);
router.get('/rekap-komentar', getTiktokRekapKomentar);
router.get('/posts', getTiktokPosts);
router.get('/rapid-profile', getRapidTiktokProfile);
router.get('/rapid-posts', getRapidTiktokPosts);
router.get('/rapid-info', getRapidTiktokInfo);

export default router;
