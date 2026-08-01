import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { DashboardController } from "./dashboard.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = Router();

router.get(
  "/command-centre",
  authenticateToken,
  authorize("admin"),
  asyncHandler(DashboardController.getCommandCentre),
);

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
