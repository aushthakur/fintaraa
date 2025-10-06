import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BookingController } from "./booking.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  registerPesaPalIPN,
  pesaPalReturnHandler,
  verifyPesaPalPayment,
  testPesaPalConnection,
  initiatePesaPalPayment
} from "../../middlewares/pesopal.middleware";

const {
  getBooking,
  createBooking,
  getAllBookings,
  getBookingById,
  updateBookingById,
  deleteBookingById
} = BookingController;
const router = express.Router();

router
  .post("/", authenticateToken, asyncHandler(createBooking))
  .get("/", authenticateToken, asyncHandler(getAllBookings))
  .get("/return", asyncHandler(pesaPalReturnHandler))
  .post("/register-ipn", authenticateToken, asyncHandler(registerPesaPalIPN))
  .post("/verify-payment", authenticateToken, asyncHandler(verifyPesaPalPayment))
  .post("/test-connection", authenticateToken, asyncHandler(testPesaPalConnection))
  .post("/initiate-payment", authenticateToken, asyncHandler(getBooking), asyncHandler(initiatePesaPalPayment))
  .get("/:id", authenticateToken, asyncHandler(getBookingById))
  .put("/:id", authenticateToken, asyncHandler(updateBookingById))
  .delete("/:id", authenticateToken, asyncHandler(deleteBookingById));

export default router;
