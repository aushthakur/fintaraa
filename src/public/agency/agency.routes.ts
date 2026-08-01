import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import {
  getAllNotifications,
  getNotificationStats,
  markNotificationRead,
} from "../../services/notification.service";
import { AgencyController } from "./agency.controller";
import {
  requireApprovedDsa,
  requireDsaRole,
} from "../../middlewares/dsaAuthMiddleware";

const router = Router();

router.post("/send-otp", asyncHandler(AgencyController.sendOtp));
router.post("/verify-otp", asyncHandler(AgencyController.verifyOtp));

router.use(authenticateToken, requireDsaRole);

router.get("/current", asyncHandler(AgencyController.getCurrentAgency));
router.get(
  "/earnings/summary",
  requireApprovedDsa,
  asyncHandler(AgencyController.getEarningsSummary),
);
router.get(
  "/earnings/events",
  requireApprovedDsa,
  asyncHandler(AgencyController.getEarningEvents),
);
router.get("/leads/summary", requireApprovedDsa, asyncHandler(AgencyController.getLeadSummary));
router.get("/leads/events", requireApprovedDsa, asyncHandler(AgencyController.getLeadEvents));
router.get(
  "/payouts/summary",
  requireApprovedDsa,
  asyncHandler(AgencyController.getPayoutSummary),
);
router.get(
  "/payouts/requests",
  requireApprovedDsa,
  asyncHandler(AgencyController.listPayoutRequests),
);
router.post(
  "/payouts/requests",
  requireApprovedDsa,
  asyncHandler(AgencyController.createPayoutRequest),
);
router.get(
  "/notification-preferences",
  asyncHandler(AgencyController.getNotificationPreferences)
);
router.put(
  "/notification-preferences",
  asyncHandler(AgencyController.updateNotificationPreferences)
);
router.post(
  "/push-token",
  asyncHandler(AgencyController.registerPushToken),
);
router.delete(
  "/push-token",
  asyncHandler(AgencyController.unregisterPushToken),
);
router.get("/team", requireApprovedDsa, asyncHandler(AgencyController.getTeamMembers));
router.get("/team/:id", requireApprovedDsa, asyncHandler(AgencyController.getTeamMember));
router.post(
  "/team",
  requireApprovedDsa,
  dynamicUpload([
    { name: "profilePicture", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(AgencyController.createTeamMember)
);
router.put(
  "/team/:id",
  requireApprovedDsa,
  dynamicUpload([
    { name: "profilePicture", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(AgencyController.updateTeamMember)
);
router.post(
  "/digilocker-sync",
  dynamicUpload([{ name: "digiLockerFiles", maxCount: 10 }]),
  s3UploaderMiddleware("digilocker"),
  asyncHandler(AgencyController.syncDigiLocker)
);
router.get("/digilocker", asyncHandler(AgencyController.getDigiLockerDocuments));
router.delete(
  "/digilocker/:docType",
  asyncHandler(AgencyController.deleteDigiLockerDocument),
);
router.put(
  "/",
  dynamicUpload([
    { name: "profilePicture", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(AgencyController.updateAgency)
);
router.post(
  "/upload-bank-document",
  dynamicUpload([{ name: "document", maxCount: 1 }]),
  s3UploaderMiddleware("kyc"),
  asyncHandler(AgencyController.uploadBankDocument)
);
router.put(
  "/kyc-profile",
  dynamicUpload([
    { name: "kycDocuments", maxCount: 10 },
    { name: "addressProof", maxCount: 3 },
    { name: "incomeProof", maxCount: 5 },
  ]),
  s3UploaderMiddleware("kyc"),
  asyncHandler(AgencyController.updateKycProfile)
);
router.get("/notifications", asyncHandler(getAllNotifications));
router.get("/notifications-stats", asyncHandler(getNotificationStats));
router.put("/notifications/mark-read", asyncHandler(markNotificationRead));

export default router;
