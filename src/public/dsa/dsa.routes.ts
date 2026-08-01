import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { requireApprovedDsa, requireDsaRole } from "../../middlewares/dsaAuthMiddleware";
import { AgencyController } from "../agency/agency.controller";
import { LoanQueryController } from "../loanquery/loanquery.controller";
import { DsaController } from "./dsa.controller";

const router = Router();

router.post("/auth/send-otp", asyncHandler(AgencyController.sendOtp));
router.post("/auth/verify-otp", asyncHandler(AgencyController.verifyOtp));
router.get("/referral/:code", asyncHandler(DsaController.getReferral));

router.use(authenticateToken, requireDsaRole);
router.get("/me", asyncHandler(DsaController.me));
router.patch("/onboarding", asyncHandler(DsaController.updateOnboarding));
router.post(
  "/mobile-change/send-otp",
  asyncHandler(DsaController.sendMobileChangeOtp),
);
router.post(
  "/mobile-change/verify-otp",
  asyncHandler(DsaController.verifyMobileChangeOtp),
);
router.get("/payout-profile", asyncHandler(DsaController.getPayoutProfile));
router.put("/payout-profile", asyncHandler(DsaController.updatePayoutProfile));

router.use(requireApprovedDsa);
router.get("/dashboard", asyncHandler(DsaController.dashboard));
router.get("/applications", asyncHandler(DsaController.applications));
router.post(
  "/applications",
  (req, res, next) => {
    if (req.body?.typeOfInsurance || String(req.body?.productType || "").toLowerCase() === "insurance") {
      return res.status(400).json({
        statusCode: 400,
        success: false,
        message: "Insurance applications must use /api/insurancequery",
        data: null,
      });
    }
    return next();
  },
  asyncHandler(LoanQueryController.createAgencyQuery),
);
router.get("/referral-link", asyncHandler(DsaController.referralLink));
router.get("/commissions", asyncHandler(DsaController.commissions));
router.get("/payouts", asyncHandler(DsaController.payouts));
router.post("/payouts", asyncHandler(DsaController.createPayout));
router.get("/leaderboard", asyncHandler(DsaController.leaderboard));
router.get("/training", asyncHandler(DsaController.training));

export default router;
