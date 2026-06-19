import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { InsuranceSeoPageController } from "./insuranceSeoPage.controller";

const router = express.Router();

router.get(
  "/public",
  asyncHandler(InsuranceSeoPageController.listPublicPages),
);

router.get(
  "/public/:insuranceType",
  asyncHandler(InsuranceSeoPageController.resolvePublicPage),
);

router
  .route("/")
  .get(authenticateToken, asyncHandler(InsuranceSeoPageController.getAllPages))
  .post(
    authenticateToken,
    authorize("admin"),
    asyncHandler(InsuranceSeoPageController.createPage),
  );

router
  .route("/:id")
  .get(authenticateToken, asyncHandler(InsuranceSeoPageController.getPageById))
  .put(
    authenticateToken,
    authorize("admin"),
    asyncHandler(InsuranceSeoPageController.updatePage),
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(InsuranceSeoPageController.deletePage),
  );

export default router;
