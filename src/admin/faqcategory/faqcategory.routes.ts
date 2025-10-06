import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { FaqCategoryController } from "./faqcategory.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createFaqCategory,
  getFaqCategoryById,
  getAllFaqCategorys,
  updateFaqCategoryById,
  deleteFaqCategoryById,
} = FaqCategoryController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createFaqCategory))
  .get("/", authenticateToken, asyncHandler(getAllFaqCategorys))
  .get("/:id", authenticateToken, asyncHandler(getFaqCategoryById))
  .put("/:id", authenticateToken, asyncHandler(updateFaqCategoryById))
  .delete("/:id", authenticateToken, asyncHandler(deleteFaqCategoryById));

export default router;
