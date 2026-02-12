import { Router } from "express";
import { LoanQueryController } from "./loanquery.controller";
import { LoanQueryChatController } from "./loanQueryChat.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

router.post(
  "/rc-lookup",
  asyncHandler(LoanQueryController.fetchRcDetails)
);
router.post(
  "/:id/cibil",
  asyncHandler(LoanQueryController.fetchCibilForQuery)
);

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
    { name: "businessRegistrationCertificateUrl", maxCount: 1 },
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
router.get("/stats", asyncHandler(LoanQueryController.getStats));
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
    { name: "businessRegistrationCertificateUrl", maxCount: 1 },
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
router.patch(
  "/:id/assign-lander",
  asyncHandler(LoanQueryController.assignLander)
);

// ====== DETAIL VIEW AND OPERATIONS FOR ADMIN/LANDER ======
router.get("/:id/detail", asyncHandler(LoanQueryController.getQueryDetail));
router.post("/:id/notes", asyncHandler(LoanQueryController.addNote));
router.post("/:id/status", asyncHandler(LoanQueryController.updateStatus));
router.patch(
  "/:id/documents",
  dynamicUpload([
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
  s3UploaderMiddleware("loan-query-documents"),
  asyncHandler(LoanQueryController.updateDocuments)
);
router.patch(
  "/:id/policy-details",
  asyncHandler(LoanQueryController.updatePolicyDetails)
);
router.patch(
  "/:id/policy-documents",
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
    { name: "businessRegistrationCertificateUrl", maxCount: 1 },
  ]),
  s3UploaderMiddleware("loan-query-policy-documents"),
  asyncHandler(LoanQueryController.updatePolicyDocuments)
);
router.post("/:id/reassign", asyncHandler(LoanQueryController.reassignLander));
router.post("/:id/complete", asyncHandler(LoanQueryController.completeQuery));

// ====== CHAT ROUTES ======
router.get(
  "/:id/chat/messages",
  asyncHandler(LoanQueryChatController.getMessages)
);
router.post(
  "/:id/chat/messages",
  dynamicUpload([{ name: "media", maxCount: 5 }]),
  s3UploaderMiddleware("loan-query-chat"),
  asyncHandler(LoanQueryChatController.sendMessage)
);
router.post(
  "/:id/chat/mark-read",
  asyncHandler(LoanQueryChatController.markAsRead)
);

export default router;
