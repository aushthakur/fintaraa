import { Router } from "express";
import { PanController } from "./pan.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

router.post("/mobile-to-pan", asyncHandler(PanController.mobileToPan));

export default router;
