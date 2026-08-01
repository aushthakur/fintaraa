import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
  optionalAuthenticateToken,
} from "../../middlewares/authMiddleware";
import { EngagementController } from "./engagement.controller";

const router = Router();

router.post(
  "/events",
  optionalAuthenticateToken,
  asyncHandler(EngagementController.create),
);
router.get(
  "/admin/summary",
  authenticateToken,
  authorize("admin"),
  asyncHandler(EngagementController.summary),
);
router.get(
  "/admin/events",
  authenticateToken,
  authorize("admin"),
  asyncHandler(EngagementController.list),
);
router.get(
  "/admin/export",
  authenticateToken,
  authorize("admin"),
  asyncHandler(EngagementController.exportCsv),
);

export default router;
