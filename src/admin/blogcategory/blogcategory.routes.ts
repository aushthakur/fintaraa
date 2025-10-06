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
  .post("/", authenticateToken, asyncHandler(createBlogCategory))
  .get("/", authenticateToken, asyncHandler(getAllBlogCategorys))
  .get("/:id", authenticateToken, asyncHandler(getBlogCategoryById))
  .put("/:id", authenticateToken, asyncHandler(updateBlogCategoryById))
  .delete("/:id", authenticateToken, asyncHandler(deleteBlogCategoryById));

export default router;
