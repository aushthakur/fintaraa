import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { EnrollmentController } from "./bookingenrollment.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  getEnrollmentById,
  getAllEnrollments,
  deleteEnrollmentById,
} = EnrollmentController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllEnrollments))
  .get("/:id", authenticateToken, asyncHandler(getEnrollmentById))
  .delete("/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteEnrollmentById));

export default router;
