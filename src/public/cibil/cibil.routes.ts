import { Router } from "express";
import {
  fetchPaidCreditScore,
  fetchCibilReport,
  fetchCibilPdfReport,
  fetchCibilReportWithMiddleware,
  fetchEncryptedCibilReportController,
  searchCustomerCreditScore,
  getBureauScoreHistory,
  getCreditScorePricing,
  getCreditScoreWallet,
  createBureauScorePaymentOrder,
  verifyBureauPaymentAndFetch,
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
router.post("/fetch-pdf", authenticateToken, asyncHandler(fetchCibilPdfReport));
router.post("/search", authenticateToken, asyncHandler(searchCustomerCreditScore));
router.post(
  "/payment/order",
  authenticateToken,
  asyncHandler(createBureauScorePaymentOrder),
);
router.post(
  "/payment/verify-and-fetch",
  authenticateToken,
  asyncHandler(verifyBureauPaymentAndFetch),
);
router.get("/history", authenticateToken, asyncHandler(getBureauScoreHistory));
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
