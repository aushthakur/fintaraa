import express from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { LanderController } from "./lander.controller";
import { authenticateToken, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken, authorize("lander"));

// Dashboard statistics
router.get("/dashboard/stats", asyncHandler(LanderController.getDashboardStats));

// Note: All query operations (view, update status, add notes, etc.) are now handled
// in /api/loanquery and /api/insurancequery routes with role-based access control

export default router;

