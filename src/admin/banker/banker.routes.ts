import express from "express";
import { BankerController } from "./banker.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { Banker } from "../../modals/banker.model";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";

const {
  createBanker,
  getAllBankers,
  getBankerById,
  updateBankerById,
  deleteBankerById,
} = BankerController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllBankers))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "logo", maxCount: 1 }]),
    s3UploaderMiddleware("banker"),
    asyncHandler(
      mediaUrlMiddleware(Banker, [{ key: "logo", type: "single" }])
    ),
    asyncHandler(createBanker)
  )
  .get("/:id", authenticateToken, asyncHandler(getBankerById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "logo", maxCount: 1 }]),
    s3UploaderMiddleware("banker"),
    asyncHandler(
      mediaUrlMiddleware(Banker, [
        { key: "logo", type: "single", useExtractOnUpdate: true },
      ])
    ),
    asyncHandler(updateBankerById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteBankerById)
  );

export default router;
