import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { SubscriptionController } from "./subscription.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createSubscription,
  getSubscriptionById,
  getAllSubscriptions,
  updateSubscriptionById,
  deleteSubscriptionById,
  getAllPublicSubscriptions,
} = SubscriptionController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createSubscription))
  .get("/", authenticateToken, asyncHandler(getAllSubscriptions))
  .get("/public", authenticateToken, asyncHandler(getAllPublicSubscriptions))
  .get("/:id", authenticateToken, asyncHandler(getSubscriptionById))
  .put("/:id", authenticateToken, asyncHandler(updateSubscriptionById))
  .delete("/:id", authenticateToken, asyncHandler(deleteSubscriptionById));

export default router;
