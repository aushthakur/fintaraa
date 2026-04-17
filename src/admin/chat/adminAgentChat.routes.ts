import { Router } from "express";
import { AdminAgentChatController } from "./adminAgentChat.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { dynamicUpload, s3UploaderMiddleware } from "../../middlewares/s3FileUploadMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get all conversations
router.get("/conversations", asyncHandler(AdminAgentChatController.getConversations));
router.get("/sidebar-counts", asyncHandler(AdminAgentChatController.getSidebarCounts));

// Get messages with a specific user
router.get("/messages/:receiverId", asyncHandler(AdminAgentChatController.getMessages));

// Send a message
router.post(
  "/messages",
  dynamicUpload([{ name: "media", maxCount: 5 }]),
  s3UploaderMiddleware("chat-media"),
  asyncHandler(AdminAgentChatController.sendMessage)
);

// Mark messages as read
router.post("/messages/:receiverId/read", asyncHandler(AdminAgentChatController.markAsRead));

export default router;
