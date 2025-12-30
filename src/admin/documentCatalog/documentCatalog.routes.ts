import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { DocumentCatalogController } from "./documentCatalog.controller";

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(DocumentCatalogController.create)
  )
  .get(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(DocumentCatalogController.getAll)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(DocumentCatalogController.getById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(DocumentCatalogController.updateById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(DocumentCatalogController.deleteById)
  );

export default router;
