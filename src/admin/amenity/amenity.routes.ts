import express from "express";
import { AmenityController } from "./amenity.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const {
  createAmenity,
  getAllAmenitys,
  getAmenityById,
  updateAmenityById,
  deleteAmenityById,
  createManyAmenities,
  getAllPublicAmenitys,
} = AmenityController;

const router = express.Router();

router
  .get("/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getAllAmenitys))
  .post("/public", asyncHandler(getAllPublicAmenitys))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(createAmenity)
  ).post(
    "/all",
    authenticateToken,
    authorize("admin"),
    asyncHandler(createManyAmenities)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getAmenityById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateAmenityById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteAmenityById)
  );

export default router;
