import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { CleaningController } from "./cleaningschedule.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createCleaning,
  getCleaningById,
  getAllCleanings,
  updateCleaningById,
  deleteCleaningById,
} = CleaningController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createCleaning))
  .get("/", authenticateToken, asyncHandler(getAllCleanings))
  .get("/:id", authenticateToken, asyncHandler(getCleaningById))
  .put("/:id", authenticateToken, asyncHandler(updateCleaningById))
  .delete("/:id", authenticateToken, asyncHandler(deleteCleaningById));

export default router;
