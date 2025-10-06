import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { NearByPlacesController } from "./nearbyplace.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";

const {
  createNearByPlaces,
  getAllNearByPlacess,
  getNearByPlacesById,
  updateNearByPlacesById,
  deleteNearByPlacesById,
} = NearByPlacesController;

const router = express.Router();

router
  .get("/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getAllNearByPlacess))
  .get("/public", asyncHandler(getAllNearByPlacess))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("places"),
    asyncHandler(createNearByPlaces)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getNearByPlacesById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "imageUrl", maxCount: 1 }]),
    s3UploaderMiddleware("places"),
    asyncHandler(updateNearByPlacesById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteNearByPlacesById)
  );

export default router;
