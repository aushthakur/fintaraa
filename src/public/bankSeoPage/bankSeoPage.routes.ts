import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BankSeoPageController } from "./bankSeoPage.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";
import { BankSeoPage } from "../../modals/bankSeoPage.model";

const router = express.Router();

router.get(
  "/public",
  asyncHandler(BankSeoPageController.listPublicPages),
);

router.get(
  "/public/:bankName/:product",
  asyncHandler(BankSeoPageController.resolvePublicPage),
);

router
  .route("/")
  .get(authenticateToken, asyncHandler(BankSeoPageController.getAllPages))
  .post(
    authenticateToken,
    authorize("admin"),
    dynamicUpload([
      { name: "logoUrl", maxCount: 1 },
      { name: "heroImageUrl", maxCount: 1 },
    ]),
    s3UploaderMiddleware("bank-pages"),
    asyncHandler(
      mediaUrlMiddleware(BankSeoPage, [
        { key: "logoUrl", type: "single" },
        { key: "heroImageUrl", type: "single" },
      ]),
    ),
    asyncHandler(BankSeoPageController.createPage),
  );

router
  .route("/:id")
  .get(authenticateToken, asyncHandler(BankSeoPageController.getPageById))
  .put(
    authenticateToken,
    authorize("admin"),
    dynamicUpload([
      { name: "logoUrl", maxCount: 1 },
      { name: "heroImageUrl", maxCount: 1 },
    ]),
    s3UploaderMiddleware("bank-pages"),
    asyncHandler(
      mediaUrlMiddleware(BankSeoPage, [
        { key: "logoUrl", type: "single", useExtractOnUpdate: true },
        { key: "heroImageUrl", type: "single", useExtractOnUpdate: true },
      ]),
    ),
    asyncHandler(BankSeoPageController.updatePage),
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(BankSeoPageController.deletePage),
  );

export default router;
