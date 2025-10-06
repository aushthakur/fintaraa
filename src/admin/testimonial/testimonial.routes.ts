import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { TestimonialController } from "./testimonial.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
const {
  createTestimonial,
  getTestimonialById,
  getAllTestimonials,
  updateTestimonialById,
  deleteTestimonialById,
} = TestimonialController;

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("testimonial"),
    asyncHandler(createTestimonial)
  )
  .get("/", authenticateToken, asyncHandler(getAllTestimonials))
  .get("/:id", authenticateToken, asyncHandler(getTestimonialById))
  .put(
    "/:id",
    authenticateToken,
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("testimonial"),
    asyncHandler(updateTestimonialById)
  )
  .delete("/:id", authenticateToken, asyncHandler(deleteTestimonialById));

export default router;
