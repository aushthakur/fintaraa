import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PublicCallRecordController } from "./callRecord.controller";

const router = express.Router();

router.get("/", asyncHandler(PublicCallRecordController.getLookup));

export default router;
