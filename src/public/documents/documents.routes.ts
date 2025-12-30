import express from "express";

import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  createStatementFolder,
  deleteStatementFolder,
  deleteStatementFolderDocument,
  deleteStatementFolderDocuments,
  getStatementFolderDocuments,
  getStatementFolders,
  getStatements,
  updateStatementFolder,
  updateStatementFolderDocument,
  uploadStatementFolderDocuments,
  uploadStatements,
} from "./documents.controller";
import { getDocumentCatalog } from "./documentCatalog.controller";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = express.Router();

router.get("/statements", authenticateToken, asyncHandler(getStatements));
router.get(
  "/document-catalog",
  authenticateToken,
  asyncHandler(getDocumentCatalog)
);
router.post(
  "/statements",
  authenticateToken,
  dynamicUpload([
    { name: "bank_letter", maxCount: 5 },
    { name: "sanction_document", maxCount: 5 },
    { name: "repayment_schedule", maxCount: 5 },
    { name: "welcome_kit", maxCount: 5 },
    { name: "account_statement", maxCount: 5 },
    { name: "foreclosure_letter", maxCount: 5 },
    { name: "noc_letter", maxCount: 5 },
    { name: "disbursement_letter", maxCount: 5 },
  ]),
  s3UploaderMiddleware("statements"),
  asyncHandler(uploadStatements)
);

router.get(
  "/statement-folders",
  authenticateToken,
  asyncHandler(getStatementFolders)
);
router.post(
  "/statement-folders",
  authenticateToken,
  asyncHandler(createStatementFolder)
);
router.put(
  "/statement-folders/:id",
  authenticateToken,
  asyncHandler(updateStatementFolder)
);
router.delete(
  "/statement-folders/:id",
  authenticateToken,
  asyncHandler(deleteStatementFolder)
);
router.get(
  "/statement-folders/:id/documents",
  authenticateToken,
  asyncHandler(getStatementFolderDocuments)
);
router.post(
  "/statement-folders/:id/documents",
  authenticateToken,
  dynamicUpload([{ name: "files", maxCount: 20 }]),
  s3UploaderMiddleware("statement-folder-documents"),
  asyncHandler(uploadStatementFolderDocuments)
);
router.put(
  "/statement-folders/:id/documents/:docId",
  authenticateToken,
  asyncHandler(updateStatementFolderDocument)
);
router.delete(
  "/statement-folders/:id/documents/:docId",
  authenticateToken,
  asyncHandler(deleteStatementFolderDocument)
);
router.delete(
  "/statement-folders/:id/documents",
  authenticateToken,
  asyncHandler(deleteStatementFolderDocuments)
);

export default router;
