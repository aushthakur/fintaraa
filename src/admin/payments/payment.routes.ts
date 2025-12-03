import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PaymentController } from "./payment.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));

router
  .route("/commission-rules")
  .post(asyncHandler(PaymentController.createCommissionRule))
  .get(asyncHandler(PaymentController.getCommissionRules));

// Commission recording endpoints
router.post(
  "/commissions/loan",
  asyncHandler(PaymentController.recordLoanCommission)
);

router.post(
  "/commissions/insurance",
  asyncHandler(PaymentController.recordInsuranceCommission)
);

router.get(
  "/landers/:landerId/wallet",
  asyncHandler(PaymentController.getLanderWallet)
);
router.get("/transactions", asyncHandler(PaymentController.listTransactions));

router
  .route("/payouts")
  .get(asyncHandler(PaymentController.listPayouts))
  .post(asyncHandler(PaymentController.requestPayout));

router.post(
  "/payouts/:id/approve",
  asyncHandler(PaymentController.approvePayout)
);

router
  .route("/bank-subscriptions")
  .get(asyncHandler(PaymentController.listSubscriptions))
  .post(asyncHandler(PaymentController.upsertBankSubscription));

router.post(
  "/bank-subscriptions/:id/charge",
  asyncHandler(PaymentController.chargeSubscription)
);

export default router;
