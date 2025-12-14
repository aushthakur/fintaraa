import express from "express";
import { FaqController } from "./faq.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const { createFaq, getFaqById, getAllFaqs, updateFaqById, deleteFaqById } =
  FaqController;

const router = express.Router();

router.get("/public", asyncHandler(FaqController.getPublicFaqs));

router
  .post("/", authenticateToken, authorize("admin"), asyncHandler(createFaq))
  .get("/", authenticateToken, authorize("admin"), asyncHandler(getAllFaqs))
  .get("/:id", authenticateToken, authorize("admin"), asyncHandler(getFaqById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateFaqById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteFaqById)
  );

export default router;
