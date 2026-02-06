// src/routes/dashboardRoutes.js
import { Router } from "express";
import { getDashboardStats } from "../controller/dashboardController.js";
import { analyzeInstagramJson } from "../controller/socialMediaController.js";
import { approveDashboardUser, rejectDashboardUser } from "../controller/dashboardUserController.js";
import { postComplaintInstagram, postComplaintTiktok } from "../controller/complaintController.js";
import { verifyDashboardToken } from "../middleware/dashboardAuth.js";
import { getDashboardWebLoginRecap } from "../controller/loginLogController.js";
import { getAnevDashboard } from "../controller/anevController.js";
import { dashboardPremiumGuard } from "../middleware/dashboardPremiumGuard.js";
import { dashboardPremiumConfig } from "../config/dashboardPremium.js";
const router = Router();

router.use(verifyDashboardToken);
router.get("/stats", getDashboardStats);
router.get("/anev", dashboardPremiumGuard(dashboardPremiumConfig.allowedTiers), getAnevDashboard);
router.post("/social-media/instagram/analysis", analyzeInstagramJson);
router.post("/komplain/insta", postComplaintInstagram);
router.post("/komplain/tiktok", postComplaintTiktok);
router.put("/users/:id/approve", approveDashboardUser);
router.put("/users/:id/reject", rejectDashboardUser);
router.get("/login-web/recap", getDashboardWebLoginRecap);

export default router;
