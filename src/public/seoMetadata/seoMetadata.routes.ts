import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { SeoMetadataController } from "./seoMetadata.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get("/resolve", asyncHandler(SeoMetadataController.resolveByPathname));

router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(SeoMetadataController.getAll),
);
router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(SeoMetadataController.create),
);
router.get(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(SeoMetadataController.getById),
);
router.put(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(SeoMetadataController.update),
);
router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(SeoMetadataController.remove),
);

export default router;
