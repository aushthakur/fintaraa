import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PricingController } from "./pricing.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createPricing,
  getPricingById,
  getAllPricings,
  updatePricingById,
  deletePricingById,
} = PricingController;

const router = express.Router();

router
  .get(
    "/",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getAllPricings)
  )
  .post(
    "/",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(createPricing)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getPricingById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(updatePricingById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("property"),
    asyncHandler(deletePricingById)
  );

export default router;
