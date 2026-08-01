import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { NewsletterController } from "./newsletter.controller";

const router = express.Router();

router.post("/subscribe", asyncHandler(NewsletterController.subscribe));
router
  .route("/unsubscribe")
  .get(asyncHandler(NewsletterController.unsubscribe))
  .post(asyncHandler(NewsletterController.unsubscribe));

router.get(
  "/export.csv",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.exportCsv),
);

router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.getAll),
);

router.patch(
  "/bulk-status",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.bulkUpdateStatus),
);

router.post(
  "/campaigns",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.createCampaign),
);

router.get(
  "/campaigns/:campaignId/status",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.getCampaignStatus),
);

router.patch(
  "/:id/status",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.updateStatus),
);

router.get(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.getById),
);

router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(NewsletterController.deleteById),
);

export default router;
