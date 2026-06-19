import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { PageFaqController } from "./pageFaq.controller";

const router = Router();

router.get("/resolve", asyncHandler(PageFaqController.resolve));
router.get(
  "/admin",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PageFaqController.list),
);
router.get(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PageFaqController.getById),
);
router.post(
  "/admin",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PageFaqController.create),
);
router.put(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PageFaqController.update),
);
router.delete(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PageFaqController.remove),
);

export default router;
