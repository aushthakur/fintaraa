import express from "express";
import { ReviewController } from "./review.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";
const {
  createReview,
  getReviewById,
  getAllReviews,
  updateReviewById,
  deleteReviewById,
  getReviewsByBookingId
} = ReviewController;

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    dynamicUpload([{ name: "images", maxCount: 5 }]),
    s3UploaderMiddleware("review"),
    asyncHandler(createReview))
  .post("/public", authenticateToken, asyncHandler(getReviewsByBookingId))
  .get("/", authenticateToken, asyncHandler(getAllReviews))
  .get("/:id", authenticateToken, asyncHandler(getReviewById))
  .put("/:id", authenticateToken, asyncHandler(updateReviewById))
  .delete("/:id", authenticateToken, asyncHandler(deleteReviewById));

export default router;
