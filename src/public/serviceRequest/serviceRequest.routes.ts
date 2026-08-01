import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ServiceRequestController } from "./serviceRequest.controller";
import {
  authorizePermission,
  authenticateToken,
  optionalAuthenticateToken,
} from "../../middlewares/authMiddleware";

const router = express.Router();

router.post(
  "/",
  optionalAuthenticateToken,
  asyncHandler(ServiceRequestController.create),
);
router.get(
  "/public",
  optionalAuthenticateToken,
  asyncHandler(ServiceRequestController.getPublicHistory),
);
router.get(
  "/query/:queryId",
  asyncHandler(ServiceRequestController.getByQueryId),
);

router.get(
  "/admin",
  authenticateToken,
  authorizePermission("Service Requests"),
  asyncHandler(ServiceRequestController.list),
);
router.get(
  "/admin/:id",
  authenticateToken,
  authorizePermission("Service Requests"),
  asyncHandler(ServiceRequestController.getAdminById),
);
router.put(
  "/admin/:id",
  authenticateToken,
  authorizePermission("Service Requests"),
  asyncHandler(ServiceRequestController.update),
);
router.patch(
  "/admin/:id/stage",
  authenticateToken,
  authorizePermission("Service Requests"),
  asyncHandler(ServiceRequestController.updateStage),
);

export default router;
