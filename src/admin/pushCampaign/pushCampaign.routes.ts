import express from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { PushCampaignController } from "./pushCampaign.controller";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));
router.get(
  "/audience-preview",
  asyncHandler(PushCampaignController.overview),
);
router
  .route("/")
  .get(asyncHandler(PushCampaignController.getAll))
  .post(asyncHandler(PushCampaignController.create));
router.get("/:id/deliveries", asyncHandler(PushCampaignController.deliveries));
router.post("/:id/cancel", asyncHandler(PushCampaignController.cancel));
router.post("/:id/retry", asyncHandler(PushCampaignController.retry));

export default router;
