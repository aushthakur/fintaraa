import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";
import { AppBanner } from "../../modals/appBanner.model";
import { AppBannerController } from "./appBanner.controller";

const router = express.Router();

router
  .get("/", authenticateToken, authorize("admin"), asyncHandler(AppBannerController.getAll))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("appBanner"),
    asyncHandler(mediaUrlMiddleware(AppBanner, [{ key: "image", type: "single" }])),
    asyncHandler(AppBannerController.create)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(AppBannerController.getById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("appBanner"),
    asyncHandler(
      mediaUrlMiddleware(AppBanner, [{ key: "image", type: "single", useExtractOnUpdate: true }])
    ),
    asyncHandler(AppBannerController.updateById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(AppBannerController.deleteById)
  );

export default router;
