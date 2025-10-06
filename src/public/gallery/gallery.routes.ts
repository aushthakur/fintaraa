import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { GalleryController } from "./gallery.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
const {
  createGallery,
  getGalleryById,
  getAllGallerys,
  updateGalleryById,
  deleteGalleryById,
} = GalleryController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllGallerys))
  .post(
    "/",
    authenticateToken,
    dynamicUpload([{ name: "url", maxCount: 1 }]),
    s3UploaderMiddleware("gallery"),
    asyncHandler(createGallery))
  .get("/:id", authenticateToken, asyncHandler(getGalleryById))
  .put(
    "/:id",
    authenticateToken,
    dynamicUpload([{ name: "url", maxCount: 1 }]),
    s3UploaderMiddleware("gallery"),
    asyncHandler(updateGalleryById)
  )
  .delete("/:id", authenticateToken, asyncHandler(deleteGalleryById));

export default router;
