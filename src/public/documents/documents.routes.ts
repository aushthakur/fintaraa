import express from "express";

import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { getStatements } from "./documents.controller";

const router = express.Router();

router.get("/statements", authenticateToken, asyncHandler(getStatements));

export default router;
