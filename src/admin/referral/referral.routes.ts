import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AdminReferralController } from "./referral.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get(
  "/payout-requests",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.listPayoutRequests),
);
router.patch(
  "/payout-requests/:id/approve",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.approvePayoutRequest),
);
router.patch(
  "/payout-requests/:id/reject",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.rejectPayoutRequest),
);
router.patch(
  "/payout-requests/:id/mark-paid",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.markPayoutRequestPaid),
);
router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.getAll),
);
router.get(
  "/config",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.getConfig),
);
router.patch(
  "/config",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.updateConfig),
);
router.patch(
  "/:id/payout",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminReferralController.processPayout),
);

export default router;
