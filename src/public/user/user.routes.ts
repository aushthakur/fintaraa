import { Router } from "express";
import { UserController } from "./user.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  getAllNotifications,
  getNotificationStats,
  markNotificationRead,
} from "../../services/notification.service";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";

const router = Router();

/* ----------- PUBLIC ROUTES ----------- */
router.post(
  "/",
  dynamicUpload([
    { name: "panCardUrl", maxCount: 1 },
    { name: "aadhaarCardUrl", maxCount: 1 },
    { name: "cancelledChequeOrPassbook", maxCount: 1 },
  ]),
  s3UploaderMiddleware("profile"),
  asyncHandler(UserController.createUser));
router.post("/login", asyncHandler(UserController.loginUser));
router.post("/send-otp", asyncHandler(UserController.generateOtp));
router.post("/verify-otp", asyncHandler(UserController.verifyOtp));
router.get("/otp/all", asyncHandler(UserController.getAllOTPLogs));

/* ----------- PROTECTED ROUTES ----------- */
router.use(authenticateToken);
router
  .route("/")
  .put(
    dynamicUpload([{ name: "profilePicture", maxCount: 1 }]),
    s3UploaderMiddleware("profile"),
    asyncHandler(UserController.updateUser))
  .delete(asyncHandler(UserController.deleteUserById));

router.get("/get-current", asyncHandler(UserController.getCurrentUser));

/* ----------- NOTIFICATIONS ----------- */
router.get("/notifications", asyncHandler(getAllNotifications));
router.get("/notifications-stats", asyncHandler(getNotificationStats));
router.put("/notifications/mark-read", asyncHandler(markNotificationRead));

/* ----------- DYNAMIC USER-TYPE ROUTES ----------- */
router
  .route("/")
  .get(asyncHandler(UserController.getAllUsers));

router
  .route("/:id")
  .put(asyncHandler(UserController.updateUser))
  .get(asyncHandler(UserController.getUserById))
  .delete(asyncHandler(UserController.deleteUserById));

export default router;
