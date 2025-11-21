import express from "express";
import { RefundController } from "./refund.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(RefundController.getAll))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(RefundController.create)
  )
  .get("/:id", authenticateToken, asyncHandler(RefundController.getById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(RefundController.update)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(RefundController.remove)
  );

export default router;
