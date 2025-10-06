import express from "express";
import { CouponController } from "./coupon.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createCoupon,
  getCouponById,
  getAllCoupons,
  updateCouponById,
  deleteCouponById,
  getAllPublicCoupons,
} = CouponController;

const router = express.Router();

router
  .get("/", authenticateToken, authorize("admin"), asyncHandler(getAllCoupons))
  .get("/public", authenticateToken, asyncHandler(getAllPublicCoupons))
  .post("/", authenticateToken, authorize("admin"), asyncHandler(createCoupon))
  .get("/:id", authenticateToken, asyncHandler(getCouponById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateCouponById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteCouponById)
  );

export default router;
