import { Router } from "express";
import { InsuranceQueryController } from "./insurancequery.controller";
import { InsuranceQueryChatController } from "./insuranceQueryChat.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// CRUD routes for insurance queries
router.post(
  "/",
  dynamicUpload([
    { name: "kycDocumentUrl", maxCount: 1 },
    { name: "healthReports", maxCount: 1 },
    { name: "drivingLicenseUpload", maxCount: 1 },
    { name: "rcBookUpload", maxCount: 1 },
    { name: "medicalReports", maxCount: 1 },
    { name: "medicalReportUpload", maxCount: 1 },
    { name: "propertyDocuments", maxCount: 10 },
    { name: "stockValuationReport", maxCount: 1 },
    { name: "purchaseInvoice", maxCount: 1 },
    { name: "maintenanceRecord", maxCount: 1 },
    { name: "panKycProof", maxCount: 1 },
    { name: "shopLicense", maxCount: 1 },
    { name: "gstCertificate", maxCount: 1 },
  ]),
  s3UploaderMiddleware("insurance-query"),
  asyncHandler(InsuranceQueryController.createQuery)
);
router.get("/stats", asyncHandler(InsuranceQueryController.getStats));
router.get("/", asyncHandler(InsuranceQueryController.getAllQueries));
router.get("/:id", asyncHandler(InsuranceQueryController.getQueryById));
router.put(
  "/:id",
  dynamicUpload([
    { name: "kycDocumentUrl", maxCount: 1 },
    { name: "healthReports", maxCount: 1 },
    { name: "drivingLicenseUpload", maxCount: 1 },
    { name: "rcBookUpload", maxCount: 1 },
    { name: "medicalReports", maxCount: 1 },
    { name: "medicalReportUpload", maxCount: 1 },
    { name: "propertyDocuments", maxCount: 10 },
    { name: "stockValuationReport", maxCount: 1 },
    { name: "purchaseInvoice", maxCount: 1 },
    { name: "maintenanceRecord", maxCount: 1 },
    { name: "panKycProof", maxCount: 1 },
    { name: "shopLicense", maxCount: 1 },
    { name: "gstCertificate", maxCount: 1 },
  ]),
  s3UploaderMiddleware("insurance-query"),
  asyncHandler(InsuranceQueryController.updateQueryById)
);
router.delete("/:id", asyncHandler(InsuranceQueryController.deleteQueryById));
router.patch("/:id/assign-lander", asyncHandler(InsuranceQueryController.assignLander));

// ====== DETAIL VIEW AND OPERATIONS FOR ADMIN/LANDER ======
router.get("/:id/detail", asyncHandler(InsuranceQueryController.getQueryDetail));
router.post("/:id/notes", asyncHandler(InsuranceQueryController.addNote));
router.post("/:id/status", asyncHandler(InsuranceQueryController.updateStatus));
router.patch(
  "/:id/documents",
  dynamicUpload([
    { name: "healthReports", maxCount: 1 },
    { name: "drivingLicenseUpload", maxCount: 1 },
    { name: "rcBookUpload", maxCount: 1 },
    { name: "medicalReports", maxCount: 1 },
    { name: "propertyDocuments", maxCount: 10 },
    { name: "stockValuationReport", maxCount: 1 },
    { name: "purchaseInvoice", maxCount: 1 },
    { name: "maintenanceRecord", maxCount: 1 },
    { name: "panKycProof", maxCount: 1 },
    { name: "shopLicense", maxCount: 1 },
    { name: "gstCertificate", maxCount: 1 },
  ]),
  s3UploaderMiddleware("insurance-query-documents"),
  asyncHandler(InsuranceQueryController.updateDocuments)
);
router.patch("/:id/policy-details", asyncHandler(InsuranceQueryController.updatePolicyDetails));
router.post("/:id/reassign", asyncHandler(InsuranceQueryController.reassignLander));
router.post("/:id/complete", asyncHandler(InsuranceQueryController.completeQuery));

// ====== CHAT ROUTES ======
router.get("/:id/chat/messages", asyncHandler(InsuranceQueryChatController.getMessages));
router.post(
  "/:id/chat/messages",
  dynamicUpload([{ name: "media", maxCount: 5 }]),
  s3UploaderMiddleware("insurance-query-chat"),
  asyncHandler(InsuranceQueryChatController.sendMessage)
);
router.post("/:id/chat/mark-read", asyncHandler(InsuranceQueryChatController.markAsRead));

export default router;

