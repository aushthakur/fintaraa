import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
  authorizePermission,
} from "../../middlewares/authMiddleware";
import { CompanyBankCategoryController } from "./companyBankCategory.controller";

const router = express.Router();

router
  .get(
    "/public/search",
    asyncHandler(CompanyBankCategoryController.search),
  )
  .post(
    "/",
    authenticateToken,
    authorizePermission("Company Bank Categories"),
    asyncHandler(CompanyBankCategoryController.create),
  )
  .get(
    "/",
    authenticateToken,
    authorize("admin", "agent"),
    asyncHandler(CompanyBankCategoryController.getAll),
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin", "agent"),
    asyncHandler(CompanyBankCategoryController.getById),
  )
  .put(
    "/:id",
    authenticateToken,
    authorizePermission("Company Bank Categories"),
    asyncHandler(CompanyBankCategoryController.updateById),
  )
  .delete(
    "/:id",
    authenticateToken,
    authorizePermission("Company Bank Categories"),
    asyncHandler(CompanyBankCategoryController.deleteById),
  );

export default router;
