import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AgencyAdminController } from "./agency.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));

router.post("/", asyncHandler(AgencyAdminController.create));
router.post("/verify-pan", asyncHandler(AgencyAdminController.verifyPan));
router.post("/verify-aadhaar", asyncHandler(AgencyAdminController.verifyAadhaar));
router.post("/verify-gst", asyncHandler(AgencyAdminController.verifyGst));
router.post(
  "/verify-bank-account",
  asyncHandler(AgencyAdminController.verifyBankAccount),
);
router.post(
  "/upload-bank-document",
  dynamicUpload([{ name: "document", maxCount: 1 }]),
  s3UploaderMiddleware("kyc"),
  asyncHandler(AgencyAdminController.uploadBankDocument),
);
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
