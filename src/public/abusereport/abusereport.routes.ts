import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AbuseReportController } from "./abusereport.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";

const {
  createAbuseReport,
  getAllAbuseReports,
  getAbuseReportById,
  updateAbuseReportById,
  deleteAbuseReportById,
} = AbuseReportController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createAbuseReport))
  .get("/", authenticateToken, asyncHandler(getAllAbuseReports))
  .get("/:id", authenticateToken, asyncHandler(getAbuseReportById))
  .put("/:id", authenticateToken, asyncHandler(updateAbuseReportById))
  .delete("/:id", authenticateToken, asyncHandler(deleteAbuseReportById));

export default router;
