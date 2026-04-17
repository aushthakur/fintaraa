import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import callRecordTimezoneMiddleware from "../../middlewares/callRecordTimezone.middleware";
import { CallRecordController } from "./callRecord.controller";

const router = express.Router();

router.use(authenticateToken);
router.use(callRecordTimezoneMiddleware);

router
  .route("/")
  .get(asyncHandler(CallRecordController.list))
  .post(asyncHandler(CallRecordController.create));
router.get("/sidebar-counts", asyncHandler(CallRecordController.getSidebarCounts));

router
  .route("/:id")
  .get(asyncHandler(CallRecordController.getById))
  .put(asyncHandler(CallRecordController.update))
  .delete(asyncHandler(CallRecordController.remove));

export default router;
