import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AgencyAdminController } from "./agency.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));

router.post("/", asyncHandler(AgencyAdminController.create));
router.get("/", asyncHandler(AgencyAdminController.getAll));
router.get(
  "/commissions",
  asyncHandler(AgencyAdminController.listCommissionTransactions),
);
router.get("/:id/earnings", asyncHandler(AgencyAdminController.getEarnings));
router.put(
  "/earnings/:transactionId/pay",
  asyncHandler(AgencyAdminController.markEarningPaid),
);
router.get("/:id", asyncHandler(AgencyAdminController.getById));
router.put("/:id", asyncHandler(AgencyAdminController.updateById));
router.put("/:id/status", asyncHandler(AgencyAdminController.updateStatus));

export default router;
