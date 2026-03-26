import { Router } from "express";
import {
  fetchPaidCreditScore,
  fetchCibilReport,
  fetchCibilReportWithMiddleware,
  fetchEncryptedCibilReportController,
  searchCustomerCreditScore,
  getCreditScorePricing,
  getCreditScoreWallet,
  purchaseCreditScoreCheck,
  fetchUserCibilReport,
  fetchUserCibilPdfReport,
} from "./cibil.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { cibilScoreMiddleware } from "../../middlewares/cibil.middleware";

const router = Router();

router.get("/pricing", asyncHandler(getCreditScorePricing));
router.post("/fetch", asyncHandler(fetchCibilReport));
router.post("/search", authenticateToken, asyncHandler(searchCustomerCreditScore));
router.post("/user", authenticateToken, asyncHandler(fetchUserCibilReport));
router.post(
  "/user/pdf",
  authenticateToken,
  asyncHandler(fetchUserCibilPdfReport)
);
router.get("/wallet", authenticateToken, asyncHandler(getCreditScoreWallet));
router.post(
  "/purchase",
  authenticateToken,
  asyncHandler(purchaseCreditScoreCheck),
);
router.post(
  "/paid-fetch",
  authenticateToken,
  asyncHandler(fetchPaidCreditScore),
);
router.post(
  "/fetch-with-middleware",
  cibilScoreMiddleware,
  asyncHandler(
    async (req, res, next) =>
      await fetchCibilReportWithMiddleware(req, res, next)
  )
);
router.post(
  "/fetch-encrypted",
  asyncHandler(fetchEncryptedCibilReportController)
);

export default router;
