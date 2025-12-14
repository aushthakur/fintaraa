import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ConsentController } from "./consent.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";

const router = express.Router();

router
  .route("/")
  .get(authenticateToken, asyncHandler(ConsentController.listEvents))
  .post(authenticateToken, asyncHandler(ConsentController.logEvent));

export default router;
