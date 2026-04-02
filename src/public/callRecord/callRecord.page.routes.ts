import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PublicCallRecordController } from "./callRecord.controller";

const router = express.Router();

router.get("/", asyncHandler(PublicCallRecordController.renderIframePage));

export default router;
