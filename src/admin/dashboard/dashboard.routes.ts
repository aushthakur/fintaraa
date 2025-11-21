import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { DashboardController } from "./dashboard.controller";

const router = Router();

router.get(
  "/customer-support",
  asyncHandler(DashboardController.getCustomerSupportSummary)
);

export default router;
