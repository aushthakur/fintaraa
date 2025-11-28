import { Router } from "express";
import { InsuranceQueryController } from "./insurancequery.controller";
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

export default router;


