import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { InteraktController } from "./interakt.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = Router();

router.post(
  "/test",
  // authenticateToken,
  // authorize("admin"),
  asyncHandler(InteraktController.sendTemplateTest)
);

router.post(
  "/message",
  // authenticateToken,
  // authorize("admin"),
  asyncHandler(InteraktController.sendTemplateMessage)
);

export default router;
