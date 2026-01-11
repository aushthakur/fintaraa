import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { DashboardController } from "./dashboard.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = Router();

router.get(
  "/overview",
  authenticateToken,
  authorize("admin"),
  asyncHandler(DashboardController.getOverview)
);

router.get(
  "/customer-support",
  asyncHandler(DashboardController.getCustomerSupportSummary)
);

export default router;
