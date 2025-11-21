import express from "express";
import { BannerController } from "./banner.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { Banner } from "../../modals/banner.model";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";

const {
  createBanner,
  getAllBanners,
  getBannerById,
  updateBannerById,
  deleteBannerById,
} = BannerController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllBanners))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("banner"),
    asyncHandler(
      mediaUrlMiddleware(Banner, [{ key: "image", type: "single" }])
    ),
    asyncHandler(createBanner)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getBannerById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("banner"),
    asyncHandler(
      mediaUrlMiddleware(Banner, [
        { key: "image", type: "single", useExtractOnUpdate: true },
      ])
    ),
    asyncHandler(updateBannerById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteBannerById)
  );

export default router;
