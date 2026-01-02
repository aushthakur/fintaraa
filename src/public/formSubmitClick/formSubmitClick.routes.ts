import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { FormSubmitClickController } from "./formSubmitClick.controller";

const router = express.Router();

router
  .route("/")
  .post(authenticateToken, asyncHandler(FormSubmitClickController.logEvent));

export default router;
