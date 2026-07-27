import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { DocumentRequestController } from "./documentRequest.controller";

const router = express.Router();

router.use(authenticateToken);
router.get("/my", asyncHandler(DocumentRequestController.getMine));
router.patch(
  "/:id/uploaded",
  asyncHandler(DocumentRequestController.markUploaded),
);
router.put(
  "/:id/uploaded",
  asyncHandler(DocumentRequestController.markUploaded),
);
router.get(
  "/",
  authorize("admin"),
  asyncHandler(DocumentRequestController.getAll),
);
router.post(
  "/",
  authorize("admin"),
  asyncHandler(DocumentRequestController.create),
);

export default router;
