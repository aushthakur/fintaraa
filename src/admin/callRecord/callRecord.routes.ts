import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import callRecordTimezoneMiddleware from "../../middlewares/callRecordTimezone.middleware";
import { CallRecordController } from "./callRecord.controller";

const router = express.Router();

router.use(authenticateToken);
router.use(callRecordTimezoneMiddleware);

router
  .route("/")
  .get(asyncHandler(CallRecordController.list))
  .post(asyncHandler(CallRecordController.create));
router.get(
  "/sidebar-counts",
  asyncHandler(CallRecordController.getSidebarCounts),
);
router.get(
  "/:id/follow-up-activity",
  asyncHandler(CallRecordController.getFollowUpActivity),
);

router
  .route("/:id")
  .get(asyncHandler(CallRecordController.getById))
  .put(asyncHandler(CallRecordController.update))
  .delete(asyncHandler(CallRecordController.remove));

router.post(
  "/:id/channel-approval/request",
  authorize("agent"),
  asyncHandler(CallRecordController.requestChannelApproval),
);
router.post(
  "/:id/channel-approval/review",
  authorize("admin"),
  asyncHandler(CallRecordController.reviewChannelApproval),
);
router.get(
  "/approved-channel-agencies",
  asyncHandler(CallRecordController.getApprovedChannelAgencies),
);

export default router;
