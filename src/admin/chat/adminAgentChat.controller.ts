import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Message } from "../../modals/message.model";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import Lander from "../../modals/lander.model";
import { Types } from "mongoose";

export class AdminAgentChatController {
  /**
   * Get all conversations for current user (admin or agent)
   * Admin sees all agents, Agent sees all admins
   */
  static async getConversations(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const currentUserId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      if (!role || (role !== "admin" && role !== "agent" && role !== "lander")) {
        throw new ApiError(403, "Access denied. Only admins, agents, and landers can access this chat.");
      }

      let conversations: any[] = [];

      if (role === "admin") {
        // Admin sees all agents and landers
        const agents = await Agent.find({})
          .select("_id name email profilePictureUrl availability")
          .lean();

        const landers = await Lander.find({})
          .select("_id name email profilePictureUrl availability")
          .lean();

        // Get conversations with agents
        for (const agent of agents) {
          const lastMessage = await Message.findOne({
            $or: [
              { sender: currentUserId, receiver: agent._id },
              { sender: agent._id, receiver: currentUserId },
            ],
            senderModel: { $in: ["Admin", "Agent", "Lander"] },
            receiverModel: { $in: ["Admin", "Agent", "Lander"] },
            leadId: { $exists: false },
          })
            .sort({ createdAt: -1 })
            .lean();

          const unreadCount = await Message.countDocuments({
            sender: agent._id,
            receiver: currentUserId,
            status: { $ne: "read" },
            senderModel: "Agent",
            receiverModel: "Admin",
            leadId: { $exists: false },
          });

          conversations.push({
            _id: agent._id,
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
            availability: agent.availability,
            type: "agent",
            lastMessage: lastMessage
              ? {
                  text: lastMessage.text,
                  createdAt: lastMessage.createdAt,
                  sender: lastMessage.sender.toString(),
                }
              : null,
            unreadCount,
          });
        }

        // Get conversations with landers
        for (const lander of landers) {
          const lastMessage = await Message.findOne({
            $or: [
              { sender: currentUserId, receiver: lander._id },
              { sender: lander._id, receiver: currentUserId },
            ],
            senderModel: { $in: ["Admin", "Agent", "Lander"] },
            receiverModel: { $in: ["Admin", "Agent", "Lander"] },
            leadId: { $exists: false },
          })
            .sort({ createdAt: -1 })
            .lean();

          const unreadCount = await Message.countDocuments({
            sender: lander._id,
            receiver: currentUserId,
            status: { $ne: "read" },
            senderModel: "Lander",
            receiverModel: "Admin",
            leadId: { $exists: false },
          });

          conversations.push({
            _id: lander._id,
            name: lander.name,
            email: lander.email,
            profilePictureUrl: lander.profilePictureUrl,
            availability: lander.availability,
            type: "lander",
            lastMessage: lastMessage
              ? {
                  text: lastMessage.text,
                  createdAt: lastMessage.createdAt,
                  sender: lastMessage.sender.toString(),
                }
              : null,
            unreadCount,
          });
        }
      } else if (role === "lander") {
        // Lander sees all admins
        const admins = await Admin.find({})
          .populate("role", "name")
          .select("_id email username")
          .lean();

        for (const admin of admins) {
          const lastMessage = await Message.findOne({
            $or: [
              { sender: currentUserId, receiver: admin._id },
              { sender: admin._id, receiver: currentUserId },
            ],
            senderModel: { $in: ["Admin", "Agent", "Lander"] },
            receiverModel: { $in: ["Admin", "Agent", "Lander"] },
            leadId: { $exists: false },
          })
            .sort({ createdAt: -1 })
            .lean();

          const unreadCount = await Message.countDocuments({
            sender: admin._id,
            receiver: currentUserId,
            status: { $ne: "read" },
            senderModel: "Admin",
            receiverModel: "Lander",
            leadId: { $exists: false },
          });

          conversations.push({
            _id: admin._id,
            name: admin.username,
            email: admin.email,
            type: "admin",
            lastMessage: lastMessage
              ? {
                  text: lastMessage.text,
                  createdAt: lastMessage.createdAt,
                  sender: lastMessage.sender.toString(),
                }
              : null,
            unreadCount,
          });
        }
      } else {
        // Agent sees all admins
        const admins = await Admin.find({})
          .populate("role", "name")
          .select("_id email username")
          .lean();

        for (const admin of admins) {
          const lastMessage = await Message.findOne({
            $or: [
              { sender: currentUserId, receiver: admin._id },
              { sender: admin._id, receiver: currentUserId },
            ],
            senderModel: { $in: ["Admin", "Agent", "Lander"] },
            receiverModel: { $in: ["Admin", "Agent", "Lander"] },
            leadId: { $exists: false },
          })
            .sort({ createdAt: -1 })
            .lean();

          const unreadCount = await Message.countDocuments({
            sender: admin._id,
            receiver: currentUserId,
            status: { $ne: "read" },
            senderModel: "Admin",
            receiverModel: "Agent",
            leadId: { $exists: false },
          });

          conversations.push({
            _id: admin._id,
            name: admin.username,
            email: admin.email,
            type: "admin",
            lastMessage: lastMessage
              ? {
                  text: lastMessage.text,
                  createdAt: lastMessage.createdAt,
                  sender: lastMessage.sender.toString(),
                }
              : null,
            unreadCount,
          });
        }
      }

      // Sort by last message time (most recent first)
      conversations.sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return 0;
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return (
          new Date(b.lastMessage.createdAt).getTime() -
          new Date(a.lastMessage.createdAt).getTime()
        );
      });

      res
        .status(200)
        .json(
          new ApiResponse(200, conversations, "Conversations fetched successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get messages between current user and another user (admin or agent)
   */
  static async getMessages(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const currentUserId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { receiverId } = req.params;

      if (!role || (role !== "admin" && role !== "agent" && role !== "lander")) {
        throw new ApiError(403, "Access denied");
      }

      if (!receiverId) {
        throw new ApiError(400, "Receiver ID is required");
      }

      // Verify receiver exists and is valid
      let receiver: any = null;
      if (role === "admin") {
        // Admin can chat with agents or landers
        receiver = await Agent.findById(receiverId).select("_id name email profilePictureUrl").lean();
        if (!receiver) {
          receiver = await Lander.findById(receiverId).select("_id name email profilePictureUrl").lean();
          if (!receiver) {
            throw new ApiError(404, "Agent or Lander not found");
          }
        }
      } else if (role === "lander") {
        // Lander can chat with admins
        receiver = await Admin.findById(receiverId).select("_id email username").lean();
        if (!receiver) {
          throw new ApiError(404, "Admin not found");
        }
      } else {
        // Agent can chat with admins
        receiver = await Admin.findById(receiverId).select("_id email username").lean();
        if (!receiver) {
          throw new ApiError(404, "Admin not found");
        }
      }

      // Get messages between current user and receiver
      const messages = await Message.find({
        $or: [
          { sender: currentUserId, receiver: receiverId },
          { sender: receiverId, receiver: currentUserId },
        ],
        senderModel: { $in: ["Admin", "Agent", "Lander"] },
        receiverModel: { $in: ["Admin", "Agent", "Lander"] },
        leadId: { $exists: false },
      })
        .sort({ createdAt: 1 })
        .lean();

      // Mark messages as read
      await Message.updateMany(
        {
          sender: receiverId,
          receiver: currentUserId,
          status: { $ne: "read" },
          leadId: { $exists: false },
        },
        {
          status: "read",
          readAt: new Date(),
        }
      );

      // Manually populate sender and receiver based on model type
      const serializedMessages = await Promise.all(
        messages.map(async (msg) => {
          let senderData: any = { _id: msg.sender.toString(), name: "Unknown", email: "" };
          let receiverData: any = { _id: msg.receiver.toString(), name: "Unknown", email: "" };

          // Fetch sender
          if (msg.senderModel === "Admin") {
            const admin = await Admin.findById(msg.sender).select("_id email username").lean();
            if (admin) {
              senderData = {
                _id: admin._id.toString(),
                name: admin.username,
                email: admin.email,
              };
            }
          } else if (msg.senderModel === "Agent") {
            const agent = await Agent.findById(msg.sender).select("_id name email profilePictureUrl").lean();
            if (agent) {
              senderData = {
                _id: agent._id.toString(),
                name: agent.name,
                email: agent.email,
                profilePictureUrl: agent.profilePictureUrl,
              };
            }
          } else if (msg.senderModel === "Lander") {
            const lander = await Lander.findById(msg.sender).select("_id name email profilePictureUrl").lean();
            if (lander) {
              senderData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
                profilePictureUrl: lander.profilePictureUrl,
              };
            }
          }

          // Fetch receiver
          if (msg.receiverModel === "Admin") {
            const admin = await Admin.findById(msg.receiver).select("_id email username").lean();
            if (admin) {
              receiverData = {
                _id: admin._id.toString(),
                name: admin.username,
                email: admin.email,
              };
            }
          } else if (msg.receiverModel === "Agent") {
            const agent = await Agent.findById(msg.receiver).select("_id name email profilePictureUrl").lean();
            if (agent) {
              receiverData = {
                _id: agent._id.toString(),
                name: agent.name,
                email: agent.email,
                profilePictureUrl: agent.profilePictureUrl,
              };
            }
          } else if (msg.receiverModel === "Lander") {
            const lander = await Lander.findById(msg.receiver).select("_id name email profilePictureUrl").lean();
            if (lander) {
              receiverData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
                profilePictureUrl: lander.profilePictureUrl,
              };
            }
          }

          return {
            _id: msg._id.toString(),
            text: msg.text,
            sender: senderData,
            receiver: receiverData,
            status: msg.status,
            readAt: msg.readAt,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
            senderModel: msg.senderModel,
            receiverModel: msg.receiverModel,
            isOwn: msg.sender.toString() === currentUserId.toString(),
          };
        })
      );

      res
        .status(200)
        .json(
          new ApiResponse(200, {
            messages: serializedMessages,
            receiver: {
              _id: receiver._id.toString(),
              name: receiver.name || receiver.username,
              email: receiver.email,
              profilePictureUrl: receiver.profilePictureUrl,
            },
          }, "Messages fetched successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a message
   */
  static async sendMessage(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const currentUserId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { text, receiverId } = req.body;

      if (!role || (role !== "admin" && role !== "agent" && role !== "lander")) {
        throw new ApiError(403, "Access denied");
      }

      if (!text || !text.trim()) {
        throw new ApiError(400, "Message text is required");
      }

      if (!receiverId) {
        throw new ApiError(400, "Receiver ID is required");
      }

      // Verify receiver exists and is valid
      let receiverModel: "Admin" | "Agent" | "Lander" = "Admin";
      if (role === "admin") {
        // Admin can send to agents or landers
        const agent = await Agent.findById(receiverId);
        if (agent) {
          receiverModel = "Agent";
        } else {
          const lander = await Lander.findById(receiverId);
          if (lander) {
            receiverModel = "Lander";
          } else {
            throw new ApiError(404, "Agent or Lander not found");
          }
        }
      } else if (role === "lander") {
        // Lander can send to admins
        const admin = await Admin.findById(receiverId);
        if (!admin) {
          throw new ApiError(404, "Admin not found");
        }
        receiverModel = "Admin";
      } else {
        // Agent can send to admins
        const admin = await Admin.findById(receiverId);
        if (!admin) {
          throw new ApiError(404, "Admin not found");
        }
        receiverModel = "Admin";
      }

      const senderModel = role === "admin" ? "Admin" : role === "lander" ? "Lander" : "Agent";

      // Create message
      const message = await Message.create({
        text: text.trim(),
        sender: currentUserId,
        receiver: receiverId,
        status: "sent",
        senderModel,
        receiverModel,
      });

      // Manually fetch sender and receiver data
      let senderData: any = { _id: currentUserId.toString(), name: "Unknown", email: "" };
      let receiverData: any = { _id: receiverId.toString(), name: "Unknown", email: "" };

      if (senderModel === "Admin") {
        const admin = await Admin.findById(currentUserId).select("_id email username").lean();
        if (admin) {
          senderData = {
            _id: admin._id.toString(),
            name: admin.username,
            email: admin.email,
          };
        }
      } else if (senderModel === "Agent") {
        const agent = await Agent.findById(currentUserId).select("_id name email profilePictureUrl").lean();
        if (agent) {
          senderData = {
            _id: agent._id.toString(),
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
          };
        }
      } else if (senderModel === "Lander") {
        const lander = await Lander.findById(currentUserId).select("_id name email profilePictureUrl").lean();
        if (lander) {
          senderData = {
            _id: lander._id.toString(),
            name: lander.name,
            email: lander.email,
            profilePictureUrl: lander.profilePictureUrl,
          };
        }
      }

      if (receiverModel === "Admin") {
        const admin = await Admin.findById(receiverId).select("_id email username").lean();
        if (admin) {
          receiverData = {
            _id: admin._id.toString(),
            name: admin.username,
            email: admin.email,
          };
        }
      } else if (receiverModel === "Agent") {
        const agent = await Agent.findById(receiverId).select("_id name email profilePictureUrl").lean();
        if (agent) {
          receiverData = {
            _id: agent._id.toString(),
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
          };
        }
      } else if (receiverModel === "Lander") {
        const lander = await Lander.findById(receiverId).select("_id name email profilePictureUrl").lean();
        if (lander) {
          receiverData = {
            _id: lander._id.toString(),
            name: lander.name,
            email: lander.email,
            profilePictureUrl: lander.profilePictureUrl,
          };
        }
      }

      const messageId = message._id instanceof Types.ObjectId 
        ? message._id.toString() 
        : String(message._id);

      const serializedMessage = {
        _id: messageId,
        text: message.text,
        sender: senderData,
        receiver: receiverData,
        status: message.status,
        readAt: message.readAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        senderModel: message.senderModel,
        receiverModel: message.receiverModel,
        isOwn: true,
      };

      // Emit socket event if socket.io is available
      const app = (req as any).app;
      const io = app?.get("socketio");
      if (io) {
        io.emit("adminAgentMessage", {
          message: serializedMessage,
          receiverId,
        });
      }

      res
        .status(201)
        .json(new ApiResponse(201, serializedMessage, "Message sent successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark messages as read
   */
  static async markAsRead(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const currentUserId = (req as any).user?._id;
      const { role } = (req as any).user || {};
      const { receiverId } = req.params;

      if (!role || (role !== "admin" && role !== "agent" && role !== "lander")) {
        throw new ApiError(403, "Access denied");
      }

      if (!receiverId) {
        throw new ApiError(400, "Receiver ID is required");
      }

      const result = await Message.updateMany(
        {
          sender: receiverId,
          receiver: currentUserId,
          status: { $ne: "read" },
          senderModel: { $in: ["Admin", "Agent"] },
          receiverModel: { $in: ["Admin", "Agent"] },
          leadId: { $exists: false },
        },
        {
          status: "read",
          readAt: new Date(),
        }
      );

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { markedCount: result.modifiedCount },
            "Messages marked as read"
          )
        );
    } catch (error) {
      next(error);
    }
  }
}

