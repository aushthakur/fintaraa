import express from "express";
import {
  authenticateToken,
  authorize,
} from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { CommunicationOutboxController } from "./communicationOutbox.controller";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorize("admin", "agent"),
  asyncHandler(CommunicationOutboxController.getAll),
);

router.post(
  "/:id/retry",
  authenticateToken,
  authorize("admin"),
  asyncHandler(CommunicationOutboxController.retry),
);

export default router;

