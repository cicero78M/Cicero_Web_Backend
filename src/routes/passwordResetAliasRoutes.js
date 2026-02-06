import express from "express";
import {
  handleDashboardPasswordResetRequest,
  handleDashboardPasswordResetConfirm,
} from "./authRoutes.js";

const router = express.Router();

router.post("/request", handleDashboardPasswordResetRequest);
router.post("/confirm", handleDashboardPasswordResetConfirm);

export default router;
