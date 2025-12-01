import { Router } from "express";
import { AdminAgentChatController } from "./adminAgentChat.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get all conversations
router.get("/conversations", asyncHandler(AdminAgentChatController.getConversations));

// Get messages with a specific user
router.get("/messages/:receiverId", asyncHandler(AdminAgentChatController.getMessages));

// Send a message
router.post("/messages", asyncHandler(AdminAgentChatController.sendMessage));

// Mark messages as read
router.post("/messages/:receiverId/read", asyncHandler(AdminAgentChatController.markAsRead));

export default router;

