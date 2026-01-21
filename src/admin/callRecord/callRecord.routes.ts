import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { CallRecordController } from "./callRecord.controller";

const router = express.Router();

router.use(authenticateToken);

router
  .route("/")
  .get(asyncHandler(CallRecordController.list))
  .post(asyncHandler(CallRecordController.create));

router
  .route("/:id")
  .get(asyncHandler(CallRecordController.getById))
  .put(asyncHandler(CallRecordController.update))
  .delete(asyncHandler(CallRecordController.remove));

export default router;
