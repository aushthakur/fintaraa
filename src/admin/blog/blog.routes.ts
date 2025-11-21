import express from "express";
import { BlogController } from "./blog.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { Blog } from "../../modals/blog.model";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";

const { createBlog, getAllBlogs, getBlogById, updateBlogById, deleteBlogById } =
  BlogController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllBlogs))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("blog"),
    asyncHandler(
      mediaUrlMiddleware(Blog, [{ key: "imageUrl", type: "single" }])
    ),
    asyncHandler(createBlog)
  )
  .get("/:id", authenticateToken, authorize("admin"), asyncHandler(getBlogById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("blog"),
    asyncHandler(
      mediaUrlMiddleware(Blog, [
        { key: "imageUrl", type: "single", useExtractOnUpdate: true },
      ])
    ),
    asyncHandler(updateBlogById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteBlogById)
  );

export default router;
