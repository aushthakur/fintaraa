import { Router } from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { DripCampaignController } from "./dripCampaign.controller";

const router = Router();

router.use(authenticateToken, authorize("admin"));
router.get("/", asyncHandler(DripCampaignController.list));
router.get(
  "/delivery-summary",
  asyncHandler(DripCampaignController.deliverySummary),
);
router.post("/", asyncHandler(DripCampaignController.create));
router.put("/:id", asyncHandler(DripCampaignController.update));

export default router;
