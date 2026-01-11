import { Router } from "express";
import {
  fetchCibilReport,
  fetchCibilReportWithMiddleware,
  fetchEncryptedCibilReportController,
  fetchUserCibilReport,
  fetchUserCibilPdfReport,
} from "./cibil.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { cibilScoreMiddleware } from "../../middlewares/cibil.middleware";

const router = Router();

router.post("/fetch", asyncHandler(fetchCibilReport));
router.post("/user", authenticateToken, asyncHandler(fetchUserCibilReport));
router.post(
  "/user/pdf",
  authenticateToken,
  asyncHandler(fetchUserCibilPdfReport)
);
router.post(
  "/fetch-with-middleware",
  cibilScoreMiddleware,
  asyncHandler(
    async (req, res, next) =>
      await fetchCibilReportWithMiddleware(req, res, next)
  )
);
router.post(
  "/fetch-encrypted",
  asyncHandler(fetchEncryptedCibilReportController)
);

export default router;
