import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { KnowledgeController } from "./knowledge.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";
import { Knowledge } from "../../modals/knowledge.model";

const router = Router();

router.get("/", asyncHandler(KnowledgeController.getAllPublic));
router.get(
  "/admin",
  authenticateToken,
  authorize("admin"),
  asyncHandler(KnowledgeController.getAllAdmin)
);
router.get(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(KnowledgeController.getById)
);
router.get("/slug/:slug", asyncHandler(KnowledgeController.getBySlug));
router.get("/:id", asyncHandler(KnowledgeController.getById));

router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  dynamicUpload([{ name: "coverImageUrl", maxCount: 1 }]),
  s3UploaderMiddleware("knowledge"),
  asyncHandler(
    mediaUrlMiddleware(Knowledge, [{ key: "coverImageUrl", type: "single" }])
  ),
  asyncHandler(KnowledgeController.create)
);
router.post(
  "/admin",
  authenticateToken,
  authorize("admin"),
  dynamicUpload([{ name: "coverImageUrl", maxCount: 1 }]),
  s3UploaderMiddleware("knowledge"),
  asyncHandler(
    mediaUrlMiddleware(Knowledge, [{ key: "coverImageUrl", type: "single" }])
  ),
  asyncHandler(KnowledgeController.create)
);
router.put(
  "/:id",
  authenticateToken,
  authorize("admin"),
  dynamicUpload([{ name: "coverImageUrl", maxCount: 1 }]),
  s3UploaderMiddleware("knowledge"),
  asyncHandler(
    mediaUrlMiddleware(Knowledge, [
      { key: "coverImageUrl", type: "single", useExtractOnUpdate: true },
    ])
  ),
  asyncHandler(KnowledgeController.update)
);
router.put(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  dynamicUpload([{ name: "coverImageUrl", maxCount: 1 }]),
  s3UploaderMiddleware("knowledge"),
  asyncHandler(
    mediaUrlMiddleware(Knowledge, [
      { key: "coverImageUrl", type: "single", useExtractOnUpdate: true },
    ])
  ),
  asyncHandler(KnowledgeController.update)
);
router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(KnowledgeController.remove)
);
router.delete(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(KnowledgeController.remove)
);

export default router;
