import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PropertyController } from "./property.controller";
import { authorizeFeature } from "../../middlewares/enrollMiddleware";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const {
  createProperty,
  getPropertyById,
  getAllProperties,
  updatePropertyById,
  deletePropertyById,
  getAllPublicProperties
} = PropertyController;

const router = express.Router();

router
  .get(
    "/",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getAllProperties)
  )
  .get(
    "/public",
    authenticateToken,
    asyncHandler(getAllPublicProperties)
  )
  .get(
    "/public/:id",
    authenticateToken,
    asyncHandler(getPropertyById)
  )
  .post(
    "/",
    authenticateToken,
    authorize("property"),
    authorizeFeature,
    asyncHandler(createProperty)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getPropertyById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    authorizeFeature,
    asyncHandler(updatePropertyById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("property"),
    authorizeFeature,
    asyncHandler(deletePropertyById)
  );

export default router;
