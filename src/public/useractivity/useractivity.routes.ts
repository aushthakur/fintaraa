import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { UserActivityController } from "./useractivity.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createUserActivity,
  getUserActivityById,
  getAllUserActivities,
  updateUserActivityById,
  deleteUserActivityById,
} = UserActivityController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createUserActivity))
  .get("/", authenticateToken, asyncHandler(getAllUserActivities))
  .get("/:id", authenticateToken, asyncHandler(getUserActivityById))
  .put("/:id", authenticateToken, asyncHandler(updateUserActivityById))
  .delete("/:id", authenticateToken, asyncHandler(deleteUserActivityById));

export default router;
