import express from "express";
import { ContestController } from "./contest.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { Contest } from "../../modals/contest.model";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";

const {
  createContest,
  getAllContests,
  getContestById,
  updateContestById,
  deleteContestById,
} = ContestController;

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(getAllContests))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("contest"),
    asyncHandler(
      mediaUrlMiddleware(Contest, [{ key: "image", type: "single" }])
    ),
    asyncHandler(createContest)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(getContestById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "image", maxCount: 1 }]),
    s3UploaderMiddleware("contest"),
    asyncHandler(
      mediaUrlMiddleware(Contest, [
        { key: "image", type: "single", useExtractOnUpdate: true },
      ])
    ),
    asyncHandler(updateContestById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteContestById)
  );

export default router;
