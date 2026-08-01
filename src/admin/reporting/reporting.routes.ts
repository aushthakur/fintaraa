import { Router } from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ReportingController } from "./reporting.controller";

const router = Router();

router.use(authenticateToken, authorize("admin"));
router.get("/options", asyncHandler(ReportingController.options));
router.get("/:report", asyncHandler(ReportingController.report));

export default router;
