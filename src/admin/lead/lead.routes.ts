import express, { Request, Response, NextFunction } from "express";
import { LeadController } from "./lead.controller";
import { LeadChatController } from "./leadChat.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";
import { config } from "../../config/config";
import ApiError from "../../utils/ApiError";

const router = express.Router();

const verifyIntegrationKey = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const secret = config.integrations.inboundWebhookKey;
  if (!secret) return next();
  const provided =
    req.header("x-integration-key") ||
    req.query.integrationKey?.toString() ||
    (req.body?.integrationKey as string | undefined);

  if (provided !== secret) {
    return next(new ApiError(403, "Invalid integration token"));
  }
  return next();
};

router.post(
  "/connectors/:source",
  verifyIntegrationKey,
  asyncHandler(LeadController.ingestFromConnector)
);

router.use(authenticateToken);

router
  .route("/")
  .get(asyncHandler(LeadController.getLeads))
  .post(asyncHandler(LeadController.createLead));

router.get("/pipeline/summary", asyncHandler(LeadController.pipelineSummary));
router.get("/chat/conversations", asyncHandler(LeadChatController.getConversations));

router.get("/:id", asyncHandler(LeadController.getLead));
router.delete(
  "/:id",
  authorize("admin"),
  asyncHandler(LeadController.deleteLead),
);
router.post("/:id/notes", asyncHandler(LeadController.addNote));
router.post("/:id/follow-ups", asyncHandler(LeadController.addFollowUp));
router.post(
  "/:id/follow-ups/status",
  asyncHandler(LeadController.updateFollowUpStatus)
);
router.post("/:id/status", asyncHandler(LeadController.updateStatus));
router.post("/:id/reassign", asyncHandler(LeadController.reassign));
router.post("/:id/escalate", asyncHandler(LeadController.escalate));
router.post(
  "/:id/convert",
  dynamicUpload([
    // Policy Details Documents (Loan specific)
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
    // Documents (Common KYC)
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
    // Insurance specific documents
    { name: "kycDocument", maxCount: 1 },
    { name: "medicalReports", maxCount: 5 },
    { name: "drivingLicense", maxCount: 1 },
    { name: "rcBook", maxCount: 1 },
    { name: "propertyDocuments", maxCount: 5 },
    { name: "stockValuationReport", maxCount: 1 },
    { name: "purchaseInvoice", maxCount: 1 },
    { name: "maintenanceRecord", maxCount: 1 },
    { name: "medicalReport", maxCount: 1 },
    { name: "shopLicense", maxCount: 1 },
    { name: "gstCertificate", maxCount: 1 },
    { name: "bankStatementUrl", maxCount: 1 },
  ]),
  s3UploaderMiddleware("lead-conversion"),
  asyncHandler(LeadController.convert)
);

// Chat routes
router.get("/:id/chat/messages", asyncHandler(LeadChatController.getLeadMessages));
router.post(
  "/:id/chat/messages",
  dynamicUpload([{ name: "media", maxCount: 5 }]),
  s3UploaderMiddleware("chat-media"),
  asyncHandler(LeadChatController.sendMessage)
);
router.post("/:id/chat/mark-read", asyncHandler(LeadChatController.markAsRead));

export default router;
