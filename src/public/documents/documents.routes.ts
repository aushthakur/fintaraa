import express from "express";

import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { getStatements, uploadStatements } from "./documents.controller";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = express.Router();

router.get("/statements", authenticateToken, asyncHandler(getStatements));
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

export default router;
