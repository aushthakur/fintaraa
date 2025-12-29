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

const router = Router();

router.post("/send-otp", asyncHandler(AgencyController.sendOtp));
router.post("/verify-otp", asyncHandler(AgencyController.verifyOtp));

router.use(authenticateToken);

router.get("/current", asyncHandler(AgencyController.getCurrentAgency));
router.get(
  "/notification-preferences",
  asyncHandler(AgencyController.getNotificationPreferences)
);
router.put(
  "/notification-preferences",
  asyncHandler(AgencyController.updateNotificationPreferences)
);
router.get("/team", asyncHandler(AgencyController.getTeamMembers));
router.get("/team/:id", asyncHandler(AgencyController.getTeamMember));
router.post(
  "/team",
  dynamicUpload([
    { name: "profilePicture", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(AgencyController.createTeamMember)
);
router.put(
  "/team/:id",
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
router.put(
  "/",
  dynamicUpload([
    { name: "profilePicture", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(AgencyController.updateAgency)
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
