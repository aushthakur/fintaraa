import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Message } from "../../modals/message.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { Request, Response, NextFunction } from "express";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import Lander from "../../modals/lander.model";
import { User } from "../../modals/user.model";

// Helper to determine file type from mimetype
const getFileType = (
  mimetype: string
): "image" | "video" | "audio" | "document" | "other" => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  if (
    mimetype.includes("pdf") ||
    mimetype.includes("document") ||
    mimetype.includes("text")
  ) {
    return "document";
  }
  return "other";
};

export class LoanQueryChatController {
  /**
   * Get all messages for a specific loan query
   */
  static async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const queryId = req.params.id;
      const { role } = (req as any).user || {};

      // Verify loan query exists
      const query = await LoanQuery.findById(queryId);
      if (!query) {
        throw new ApiError(404, "Loan query not found");
      }

      // Check permissions: admin/lander/agent can access
      if (role !== "admin" && role !== "lander" && role !== "agent") {
        throw new ApiError(403, "Access denied");
      }

      // Get messages for this loan query
      const messages = await Message.find({ loanQueryId: queryId })
        .sort({ createdAt: 1 })
        .lean();

      // Manually populate sender and receiver
      const serializedMessages = await Promise.all(
        messages.map(async (msg) => {
          let senderData: any = { _id: msg.sender.toString(), name: "Unknown" };
          let receiverData: any = {
            _id: msg.receiver.toString(),
            name: "Unknown",
          };

          // Fetch sender
          if (msg.senderModel === "Admin") {
            const admin = await Admin.findById(msg.sender)
              .select("_id email username")
              .lean();
            if (admin)
              senderData = {
                _id: admin._id.toString(),
                name: admin.username,
                email: admin.email,
              };
          } else if (msg.senderModel === "Agent") {
            const agent = await Agent.findById(msg.sender)
              .select("_id name email")
              .lean();
            if (agent)
              senderData = {
                _id: agent._id.toString(),
                name: agent.name,
                email: agent.email,
              };
          } else if (msg.senderModel === "Lander") {
            const lander = await Lander.findById(msg.sender)
              .select("_id name email")
              .lean();
            if (lander)
              senderData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
              };
          } else if (msg.senderModel === "User") {
            const user = await User.findById(msg.sender)
              .select("_id name email")
              .lean();
            if (user)
              senderData = {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
              };
          }

          // Fetch receiver
          if (msg.receiverModel === "Admin") {
            const admin = await Admin.findById(msg.receiver)
              .select("_id email username")
              .lean();
            if (admin)
              receiverData = {
                _id: admin._id.toString(),
                name: admin.username,
                email: admin.email,
              };
          } else if (msg.receiverModel === "Agent") {
            const agent = await Agent.findById(msg.receiver)
              .select("_id name email")
              .lean();
            if (agent)
              receiverData = {
                _id: agent._id.toString(),
                name: agent.name,
                email: agent.email,
              };
          } else if (msg.receiverModel === "Lander") {
            const lander = await Lander.findById(msg.receiver)
              .select("_id name email")
              .lean();
            if (lander)
              receiverData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
              };
          } else if (msg.receiverModel === "User") {
            const user = await User.findById(msg.receiver)
              .select("_id name email")
              .lean();
            if (user)
              receiverData = {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
              };
          }

          return {
            ...msg,
            sender: senderData,
            receiver: receiverData,
          };
        })
      );
      res
        .status(200)
        .json(new ApiResponse(200, serializedMessages, "Messages fetched"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Helper to determine file type from mimetype
   */
  private static getFileType(
    mimetype: string
  ): "image" | "video" | "audio" | "document" | "other" {
    if (mimetype.startsWith("image/")) return "image";
    if (mimetype.startsWith("video/")) return "video";
    if (mimetype.startsWith("audio/")) return "audio";
    if (
      mimetype.includes("pdf") ||
      mimetype.includes("document") ||
      mimetype.includes("text")
    ) {
      return "document";
    }
    return "other";
  }

  /**
   * Send a message in loan query chat
   */
  static async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const queryId = req.params.id;
      const { text, receiverId } = req.body;
      const senderId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      // Transform uploaded media from S3 middleware
      let attachments: any[] = [];
      if (req.body.media && Array.isArray(req.body.media)) {
        attachments = req.body.media.map((file: any) => ({
          url: file.url,
          type: getFileType(file.mimetype),
          name: file.name || file.originalname,
          size: file.size,
          mimetype: file.mimetype,
        }));
      }

      // Either text or media must be provided
      if ((!text || !text.trim()) && attachments.length === 0) {
        throw new ApiError(400, "Message text or media is required");
      }

      // Verify loan query exists
      const query = await LoanQuery.findById(queryId).populate("customerId");
      if (!query) {
        throw new ApiError(404, "Loan query not found");
      }

      // Determine sender and receiver models
      const senderModel =
        role === "admin"
          ? "Admin"
          : role === "agent"
          ? "Agent"
          : role === "lander"
          ? "Lander"
          : "User";

      let finalReceiverId = receiverId;
      let receiverModel: "User" | "Admin" | "Agent" | "Lander" = "User";

      // If admin/agent/lander is sending, receiver is customer
      if (
        senderModel === "Admin" ||
        senderModel === "Agent" ||
        senderModel === "Lander"
      ) {
        finalReceiverId = (query.customerId as any)?._id || query.customerId;
        receiverModel = "User";
      } else {
        // User is sending, receiver is assigned lander or admin
        if (query.assignedLander) {
          finalReceiverId = query.assignedLander;
          receiverModel = "Lander";
        } else {
          // Default to admin (you may need to set a default admin ID)
          finalReceiverId = receiverId;
          receiverModel = "Admin";
        }
      }

      // Create message
      const message = await Message.create({
        sender: senderId,
        receiver: finalReceiverId,
        text: text || "",
        loanQueryId: queryId,
        senderModel,
        receiverModel,
        status: "sent",
        attachments: attachments,
      });

      // Populate sender and receiver details
      let senderData: any = { _id: senderId.toString(), name: "Unknown" };
      let receiverData: any = {
        _id: finalReceiverId.toString(),
        name: "Unknown",
      };

      // Fetch sender details
      if (senderModel === "Admin") {
        const admin = await Admin.findById(senderId)
          .select("_id email username")
          .lean();
        if (admin)
          senderData = {
            _id: admin._id.toString(),
            name: admin.username,
            email: admin.email,
          };
      } else if (senderModel === "Lander") {
        const lander = await Lander.findById(senderId)
          .select("_id name email")
          .lean();
        if (lander)
          senderData = {
            _id: lander._id.toString(),
            name: lander.name,
            email: lander.email,
          };
      }

      // Fetch receiver details
      if (receiverModel === "User") {
        const user = await User.findById(finalReceiverId)
          .select("_id name email")
          .lean();
        if (user)
          receiverData = {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
          };
      }

      const populatedMessage = {
        ...message.toObject(),
        sender: senderData,
        receiver: receiverData,
      };

      res
        .status(201)
        .json(new ApiResponse(201, populatedMessage, "Message sent"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark messages as read
   */
  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const queryId = req.params.id;
      const userId = (req as any).user?._id;

      await Message.updateMany(
        {
          loanQueryId: queryId,
          receiver: userId,
          status: { $ne: "read" },
        },
        {
          $set: { status: "read", readAt: new Date() },
        }
      );

      res.status(200).json(new ApiResponse(200, {}, "Messages marked as read"));
    } catch (error) {
      next(error);
    }
  }
}
