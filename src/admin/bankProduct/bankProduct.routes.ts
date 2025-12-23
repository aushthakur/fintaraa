import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BankProductController } from "./bankProduct.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { BankProduct } from "../../modals/bankProduct.model";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";

const {
  createBankProduct,
  getAllBankProducts,
  getBankProductById,
  updateBankProductById,
  deleteBankProductById,
  getPublicBankProducts,
  getPublicBankProductById,
} = BankProductController;

const router = express.Router();

router.get("/public", asyncHandler(getPublicBankProducts));
router.get("/public/:id", asyncHandler(getPublicBankProductById));

router
  .get("/", authenticateToken, asyncHandler(getAllBankProducts))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("bank-products"),
    asyncHandler(
      mediaUrlMiddleware(BankProduct, [{ key: "image", type: "single" }])
    ),
    asyncHandler(createBankProduct)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getBankProductById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("bank-products"),
    asyncHandler(
      mediaUrlMiddleware(BankProduct, [
        { key: "image", type: "single", useExtractOnUpdate: true },
      ])
    ),
    asyncHandler(updateBankProductById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteBankProductById)
  );

export default router;
