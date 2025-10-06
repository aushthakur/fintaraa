import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PaymentController } from "./payment.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const {
  createPayment,
  getPaymentById,
  getAllPayments,
  updatePaymentById,
  deletePaymentById,
} = PaymentController;

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    authorize("property"),
    asyncHandler(createPayment)
  )
  .get("/", authenticateToken, asyncHandler(getAllPayments))
  .get("/:id", authenticateToken, asyncHandler(getPaymentById))
  .put(
    "/:id",
    authenticateToken,
    authorize("property"),
    asyncHandler(updatePaymentById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deletePaymentById)
  );

export default router;
