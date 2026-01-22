import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PublicAppBannerController } from "./appBanner.controller";

const router = express.Router();

router.get("/app-banners", asyncHandler(PublicAppBannerController.getAppBanners));
router.post(
  "/app-banners/:id/click",
  asyncHandler(PublicAppBannerController.trackClick)
);

export default router;
