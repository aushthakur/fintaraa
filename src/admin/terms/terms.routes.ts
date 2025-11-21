import express from "express";
import { TermsController } from "./terms.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(TermsController.getAll))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(TermsController.create)
  )
  .get("/:id", authenticateToken, asyncHandler(TermsController.getById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(TermsController.update)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(TermsController.remove)
  );

export default router;
