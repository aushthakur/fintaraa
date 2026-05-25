import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { DocumentRequestController } from "./documentRequest.controller";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));
router.get("/", asyncHandler(DocumentRequestController.getAll));
router.post("/", asyncHandler(DocumentRequestController.create));

export default router;
