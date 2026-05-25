import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { AppUsageController } from "./appUsage.controller";

const router = express.Router();

router.post("/track", authenticateToken, asyncHandler(AppUsageController.track));
router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AppUsageController.getAll),
);

export default router;
