import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
  optionalAuthenticateToken,
} from "../../middlewares/authMiddleware";
import { GrievanceController } from "./grievance.controller";

const router = Router();

router.post(
  "/",
  optionalAuthenticateToken,
  asyncHandler(GrievanceController.create),
);
router.post("/track", asyncHandler(GrievanceController.track));

router.get(
  "/admin",
  authenticateToken,
  authorize("admin"),
  asyncHandler(GrievanceController.adminList),
);
router.get(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(GrievanceController.adminGet),
);
router.patch(
  "/admin/:id/status",
  authenticateToken,
  authorize("admin"),
  asyncHandler(GrievanceController.updateStatus),
);
router.post(
  "/admin/:id/comments",
  authenticateToken,
  authorize("admin"),
  asyncHandler(GrievanceController.addAdminComment),
);

export default router;
