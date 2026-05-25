import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { WebPushController } from "./webPush.controller";

const router = express.Router();

router.get("/vapid-public-key", asyncHandler(WebPushController.getPublicKey));
router.post(
  "/subscriptions",
  authenticateToken,
  asyncHandler(WebPushController.subscribe),
);
router.delete(
  "/subscriptions",
  authenticateToken,
  asyncHandler(WebPushController.unsubscribe),
);

export default router;
