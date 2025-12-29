import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { AgentAuthController } from "./agent.controller";

const router = Router();

router.post("/send-otp", asyncHandler(AgentAuthController.sendOtp));
router.post("/verify-otp", asyncHandler(AgentAuthController.verifyOtp));

export default router;
