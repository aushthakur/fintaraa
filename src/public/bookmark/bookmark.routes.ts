import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BookMarkController } from "./bookmark.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createBookMark,
  getBookMarkById,
  getAllBookMarks,
  updateBookMarkById,
  deleteBookMarkById,
} = BookMarkController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createBookMark))
  .get("/", authenticateToken, asyncHandler(getAllBookMarks))
  .get("/:id", authenticateToken, asyncHandler(getBookMarkById))
  .put("/:id", authenticateToken, asyncHandler(updateBookMarkById))
  .delete("/:id", authenticateToken, asyncHandler(deleteBookMarkById));

export default router;
