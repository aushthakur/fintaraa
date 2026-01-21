import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { FormSubmitClickController } from "./formSubmitClick.controller";

const router = express.Router();

router
  .route("/")
  .post(authenticateToken, asyncHandler(FormSubmitClickController.logEvent));

router.get(
  "/admin/summary",
  authenticateToken,
  authorize("admin"),
  asyncHandler(FormSubmitClickController.getSummary)
);

router.get(
  "/admin/events",
  authenticateToken,
  authorize("admin"),
  asyncHandler(FormSubmitClickController.listEvents)
);

export default router;
