import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ReferralController } from "./referral.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get(
  "/summary",
  authenticateToken,
  asyncHandler(ReferralController.getSummary)
);
router.get(
  "/history",
  authenticateToken,
  asyncHandler(ReferralController.getHistory)
);

export default router;
