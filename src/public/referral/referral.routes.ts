import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ReferralController } from "./referral.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";

const router = express.Router();

router.post("/track-visit", asyncHandler(ReferralController.trackVisit));
router.get(
  "/wallet",
  authenticateToken,
  asyncHandler(ReferralController.getWallet),
);
router.get(
  "/payout-requests",
  authenticateToken,
  asyncHandler(ReferralController.listPayoutRequests),
);
router.post(
  "/payout-requests",
  authenticateToken,
  asyncHandler(ReferralController.createPayoutRequest),
);
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
