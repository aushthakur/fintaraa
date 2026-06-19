import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { CareerController } from "./career.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = express.Router();

router.get("/jobs", asyncHandler(CareerController.getPublishedJobs));
router.get("/jobs/:id", asyncHandler(CareerController.getJobById));
router.post(
  "/applications",
  dynamicUpload([{ name: "resume", maxCount: 1 }]),
  s3UploaderMiddleware("career-resumes"),
  asyncHandler(CareerController.submitApplication)
);

router.use("/admin", authenticateToken, authorize("admin"));

router
  .route("/admin/jobs")
  .get(asyncHandler(CareerController.listJobs))
  .post(asyncHandler(CareerController.createJob));

router
  .route("/admin/jobs/:id")
  .put(asyncHandler(CareerController.updateJob))
  .delete(asyncHandler(CareerController.deleteJob));

router.patch("/admin/jobs/:id/publish", asyncHandler(CareerController.publishJob));
router.patch("/admin/jobs/:id/archive", asyncHandler(CareerController.archiveJob));
router.get("/admin/applications", asyncHandler(CareerController.listApplications));
router.patch(
  "/admin/applications/:id/status",
  asyncHandler(CareerController.updateApplicationStatus)
);

export default router;
