import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { translateCopy } from "./translate.controller";

const router = Router();

router.post("/", asyncHandler(translateCopy));

export default router;
