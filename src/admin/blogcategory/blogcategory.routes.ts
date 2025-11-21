import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BlogCategoryController } from "./blogcategory.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createBlogCategory,
  getBlogCategoryById,
  getAllBlogCategorys,
  updateBlogCategoryById,
  deleteBlogCategoryById,
} = BlogCategoryController;

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(createBlogCategory)
  )
  .get(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getAllBlogCategorys)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getBlogCategoryById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateBlogCategoryById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteBlogCategoryById)
  );

export default router;
