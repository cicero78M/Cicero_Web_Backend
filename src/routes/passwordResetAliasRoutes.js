import express from "express";
import {
  handleDashboardPasswordResetRequest,
  handleDashboardPasswordResetConfirm,
} from "./auth/passwordResetHandlers.js";

const router = express.Router();

// Canonical public dashboard password-reset routes.
router.post("/request", handleDashboardPasswordResetRequest);
router.post("/confirm", handleDashboardPasswordResetConfirm);

export default router;
