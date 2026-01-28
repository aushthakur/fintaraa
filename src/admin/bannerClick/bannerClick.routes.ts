import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BannerClickController } from "./bannerClick.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router
  .get(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(BannerClickController.getAll),
  )
  .get(
    "/stats",
    authenticateToken,
    authorize("admin"),
    asyncHandler(BannerClickController.getStats),
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(BannerClickController.getById),
  )
  .delete(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(BannerClickController.deleteMany),
  );

export default router;
