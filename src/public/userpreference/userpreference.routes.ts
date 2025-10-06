import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { UserPreferenceController } from "./userpreference.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createUserPreference,
  getUserPreferenceById,
  getAllUserPreferences,
  updateUserPreferenceById,
  deleteUserPreferenceById,
} = UserPreferenceController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createUserPreference))
  .get("/", authenticateToken, asyncHandler(getAllUserPreferences))
  .get("/:id", authenticateToken, asyncHandler(getUserPreferenceById))
  .put("/:id", authenticateToken, asyncHandler(updateUserPreferenceById))
  .delete("/:id", authenticateToken, asyncHandler(deleteUserPreferenceById));

export default router;
