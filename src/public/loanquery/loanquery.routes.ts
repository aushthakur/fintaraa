import { Router } from "express";
import { LoanQueryController } from "./loanquery.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// CRUD routes for loan queries
router.post(
  "/",
  dynamicUpload([
    { name: "bankStatementUrl", maxCount: 1 },
    { name: "salarySlipUrl", maxCount: 1 },
    { name: "admissionLetterUrl", maxCount: 1 },
    { name: "feeStructureUrl", maxCount: 1 },
    { name: "rcCopyUrl", maxCount: 1 },
    { name: "goldPhotosUrl", maxCount: 10 },
    { name: "carInsuranceUrl", maxCount: 1 },
    { name: "lastMonthBankStatementUrl", maxCount: 1 },
    { name: "propertyDocumentsUrl", maxCount: 10 },
    { name: "propertyOwnershipProofUrl", maxCount: 1 },
    { name: "renovationEstimateUrl", maxCount: 1 },
    { name: "itrUrl", maxCount: 1 },
    { name: "gstReturnsUrl", maxCount: 1 },
    { name: "dematStatementOrFdCopyUrl", maxCount: 1 },
    { name: "proformaInvoiceOrQuotationUrl", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "itr_form_16", maxCount: 1 },
    { name: "salary_slip", maxCount: 1 },
    { name: "offer_letter", maxCount: 1 },
    { name: "relieving_letter", maxCount: 1 },
    { name: "bank_statement", maxCount: 1 },
    { name: "gst_certificate", maxCount: 1 },
    { name: "gst_returns", maxCount: 1 },
    { name: "shop_act", maxCount: 1 },
    { name: "govt_license", maxCount: 1 },
  ]),
  s3UploaderMiddleware("loan-query"),
  asyncHandler(LoanQueryController.createQuery)
);
router.get("/", asyncHandler(LoanQueryController.getAllQueries));
router.get("/:id", asyncHandler(LoanQueryController.getQueryById));
router.put(
  "/:id",
  dynamicUpload([
    { name: "bankStatementUrl", maxCount: 1 },
    { name: "salarySlipUrl", maxCount: 1 },
    { name: "admissionLetterUrl", maxCount: 1 },
    { name: "feeStructureUrl", maxCount: 1 },
    { name: "rcCopyUrl", maxCount: 1 },
    { name: "goldPhotosUrl", maxCount: 10 },
    { name: "carInsuranceUrl", maxCount: 1 },
    { name: "lastMonthBankStatementUrl", maxCount: 1 },
    { name: "propertyDocumentsUrl", maxCount: 10 },
    { name: "propertyOwnershipProofUrl", maxCount: 1 },
    { name: "renovationEstimateUrl", maxCount: 1 },
    { name: "itrUrl", maxCount: 1 },
    { name: "gstReturnsUrl", maxCount: 1 },
    { name: "dematStatementOrFdCopyUrl", maxCount: 1 },
    { name: "proformaInvoiceOrQuotationUrl", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "itr_form_16", maxCount: 1 },
    { name: "salary_slip", maxCount: 1 },
    { name: "offer_letter", maxCount: 1 },
    { name: "relieving_letter", maxCount: 1 },
    { name: "bank_statement", maxCount: 1 },
    { name: "gst_certificate", maxCount: 1 },
    { name: "gst_returns", maxCount: 1 },
    { name: "shop_act", maxCount: 1 },
    { name: "govt_license", maxCount: 1 },
  ]),
  s3UploaderMiddleware("loan-query"),
  asyncHandler(LoanQueryController.updateQueryById)
);
router.delete("/:id", asyncHandler(LoanQueryController.deleteQueryById));
router.patch("/:id/assign-lander", asyncHandler(LoanQueryController.assignLander));

export default router;

