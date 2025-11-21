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

router.post(
  "/disbursements",
  asyncHandler(PaymentController.recordDisbursement)
);

router.get(
  "/agents/:agentId/wallet",
  asyncHandler(PaymentController.getAgentWallet)
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
