import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AdminReferralController } from "./referral.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.getAll),
);

export default router;
