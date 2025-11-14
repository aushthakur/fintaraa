import { Router } from "express";
import {
  fetchCibilReport,
  fetchCibilReportWithMiddleware,
  fetchEncryptedCibilReportController,
} from "./cibil.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { cibilScoreMiddleware } from "../../middlewares/cibil.middleware";

const router = Router();

router.post("/fetch", asyncHandler(fetchCibilReport));
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
