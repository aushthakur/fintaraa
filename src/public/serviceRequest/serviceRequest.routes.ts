import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ServiceRequestController } from "./serviceRequest.controller";
import {
  authorize,
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
  authorize("admin"),
  asyncHandler(ServiceRequestController.list),
);
router.put(
  "/admin/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ServiceRequestController.update),
);
router.patch(
  "/admin/:id/stage",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ServiceRequestController.updateStage),
);

export default router;
