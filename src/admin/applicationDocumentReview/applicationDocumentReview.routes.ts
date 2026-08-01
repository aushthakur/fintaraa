import express from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApplicationDocumentReviewController } from "./applicationDocumentReview.controller";

const router = express.Router();

router.use(authenticateToken);
router.get("/my", asyncHandler(ApplicationDocumentReviewController.getMine));
router.get(
  "/",
  authorize("admin"),
  asyncHandler(ApplicationDocumentReviewController.getAll),
);
router.patch(
  "/:id",
  authorize("admin"),
  asyncHandler(ApplicationDocumentReviewController.review),
);

export default router;
