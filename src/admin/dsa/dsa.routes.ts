import { Router } from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";
import { DsaAdminController } from "./dsa.controller";
import { Request, Response, NextFunction } from "express";

const router = Router();
router.use(authenticateToken, authorize("admin"));

router.get("/summary", asyncHandler(DsaAdminController.summary));
router.get("/profiles", asyncHandler(DsaAdminController.profiles));
router.get("/profiles/:id", asyncHandler(DsaAdminController.profile));
router.patch("/profiles/:id/status", asyncHandler(DsaAdminController.updateProfileStatus));

router.get("/commission-rules", asyncHandler(DsaAdminController.commissionRules));
router.post("/commission-rules", asyncHandler(DsaAdminController.createRule));
router.patch("/commission-rules/:id", asyncHandler(DsaAdminController.updateRule));
router.delete("/commission-rules/:id", asyncHandler(DsaAdminController.deleteRule));
router.get("/commissions", asyncHandler(DsaAdminController.commissions));
router.patch("/commissions/:id/mark-paid", asyncHandler(DsaAdminController.markCommissionPaid));

router.get("/payouts", asyncHandler(DsaAdminController.payouts));
router.post("/payouts/:id/reveal-destination", asyncHandler(DsaAdminController.revealPayoutDestination));
router.patch("/payouts/:id/status", asyncHandler(DsaAdminController.updatePayoutStatus));
router.get("/leaderboard", asyncHandler(DsaAdminController.leaderboard));

const validateTrainingUpload = (req: Request, res: Response, next: NextFunction) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.file?.[0];
  const thumbnail = files?.thumbnail?.[0];
  const type = String(req.body?.type || req.body?.trainingType || "").toLowerCase();
  if (file && !type) {
    return res.status(400).json({ success: false, message: "Training type is required with a file upload" });
  }
  if (file && file.size > 100 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: "Training file exceeds 100 MB" });
  }
  if (file && ["pdf", "product_guide"].includes(type) && file.mimetype !== "application/pdf") {
    return res.status(400).json({ success: false, message: "PDF training requires application/pdf" });
  }
  if (file && type === "video" && !file.mimetype.startsWith("video/")) {
    return res.status(400).json({ success: false, message: "Video training requires a video file" });
  }
  if (thumbnail && !thumbnail.mimetype.startsWith("image/")) {
    return res.status(400).json({ success: false, message: "Training thumbnail must be an image" });
  }
  return next();
};

const trainingUpload = [
  dynamicUpload([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]),
  validateTrainingUpload,
  s3UploaderMiddleware("dsa-training"),
];
router.get("/training", asyncHandler(DsaAdminController.training));
router.post("/training", ...trainingUpload, asyncHandler(DsaAdminController.createTraining));
router.patch("/training/:id", ...trainingUpload, asyncHandler(DsaAdminController.updateTraining));
router.delete("/training/:id", asyncHandler(DsaAdminController.deleteTraining));

router.get("/reports/export", asyncHandler(DsaAdminController.exportReport));

export default router;
