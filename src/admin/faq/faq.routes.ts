import express from "express";
import { FaqController } from "./faq.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
const {
  createFaq,
  getFaqById,
  getAllFaqs,
  updateFaqById,
  deleteFaqById,
} = FaqController;

const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createFaq))
  .get("/", authenticateToken, asyncHandler(getAllFaqs))
  .get("/:id", authenticateToken, asyncHandler(getFaqById))
  .put("/:id", authenticateToken, asyncHandler(updateFaqById))
  .delete("/:id", authenticateToken, asyncHandler(deleteFaqById));

export default router;
