import express from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { BulkCommunicationController } from "./bulkCommunication.controller";

const router = express.Router();

router.use(authenticateToken, authorize("admin"));
router.get("/audience", asyncHandler(BulkCommunicationController.audience));
router.post("/", asyncHandler(BulkCommunicationController.create));

export default router;
