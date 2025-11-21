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
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(createFaqCategory)
  )
  .get(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getAllFaqCategorys)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getFaqCategoryById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateFaqCategoryById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteFaqCategoryById)
  );

export default router;
