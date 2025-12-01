import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Message } from "../../modals/message.model";
import { ChatService } from "../../services/chat.service";
import Lead from "../../modals/lead.model";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import { User } from "../../modals/user.model";
import { Types } from "mongoose";

export class LeadChatController {
  /**
   * Get all messages for a specific lead
   */
  static async getLeadMessages(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const leadId = req.params.id;
      const userId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      // Verify lead exists
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }

      // Check permissions: admin/agent can access, or user if they own the lead
      if (role !== "admin" && role !== "agent") {
        // For regular users, check if they're the lead owner
        // This would need to be implemented based on your lead-user relationship
        throw new ApiError(403, "Access denied");
      }

      // Get messages for this lead
      const messages = await Message.find({ leadId })
        .sort({ createdAt: 1 })
        .lean();

      // Manually populate sender and receiver based on model type
      const serializedMessages = await Promise.all(
        messages.map(async (msg) => {
          let senderData: any = { _id: msg.sender.toString(), name: "Unknown", email: "" };
          let receiverData: any = { _id: msg.receiver.toString(), name: "Unknown", email: "" };

          // Fetch sender based on senderModel
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
          } else if (msg.senderModel === "User") {
            const user = await User.findById(msg.sender).select("_id name email").lean();
            if (user) {
              senderData = {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
              };
            }
          } else {
            // Fallback
            senderData = {
              _id: msg.sender.toString(),
              name: "Unknown",
              email: "",
            };
          }

          // Fetch receiver based on receiverModel
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
          } else if (msg.receiverModel === "User") {
            const user = await User.findById(msg.receiver).select("_id name email").lean();
            if (user) {
              receiverData = {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
              };
            }
          } else {
            // Fallback
            receiverData = {
              _id: msg.receiver.toString(),
              name: "Unknown",
              email: "",
            };
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
          };
        })
      );

      res
        .status(200)
        .json(
          new ApiResponse(200, serializedMessages, "Messages fetched successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a message in lead chat
   */
  static async sendMessage(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const leadId = req.params.id;
      const { text, receiverId } = req.body;
      const senderId = (req as any).user?._id;
      const { role } = (req as any).user || {};

      if (!text || !text.trim()) {
        throw new ApiError(400, "Message text is required");
      }

      // Verify lead exists
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }

      // Determine sender and receiver models
      const senderModel = role === "admin" ? "Admin" : role === "agent" ? "Agent" : "User";
      
      // Determine receiver: 
      // - If admin/agent is sending, receiver should be the lead owner (borrowerProfile)
      // - If user is sending, receiver should be the assigned agent/admin
      // Ensure receiverId is a string if provided
      let finalReceiverId: string | undefined = receiverId 
        ? (typeof receiverId === 'string' ? receiverId : (receiverId as any)?._id?.toString() || receiverId.toString())
        : undefined;
      let receiverModel: "User" | "Admin" | "Agent" | "Lander" = "User";

      if (senderModel === "Admin" || senderModel === "Agent") {
        // Admin/Agent sending to lead owner or assigned agent
        if (lead.borrowerProfile) {
          // Priority 1: Send to lead owner (borrowerProfile)
          // Extract _id if populated, otherwise use the ObjectId directly
          const borrowerId = (lead.borrowerProfile as any)?._id 
            ? (lead.borrowerProfile as any)._id.toString()
            : (lead.borrowerProfile as Types.ObjectId).toString();
          finalReceiverId = borrowerId;
          receiverModel = "User";
        } else if (finalReceiverId) {
          // Priority 2: Use provided receiverId
          receiverModel = "User"; // Assume it's a user unless we check the actual model
        } else if (lead.assignment?.current?.agent) {
          // Priority 3: If no borrowerProfile and no receiverId, send to assigned agent
          const agentId = (lead.assignment.current.agent as any)?._id
            ? (lead.assignment.current.agent as any)._id.toString()
            : (lead.assignment.current.agent as Types.ObjectId).toString();
          finalReceiverId = agentId;
          receiverModel = "Agent";
        } else {
          // No way to determine receiver
          throw new ApiError(400, "Cannot determine message receiver. Lead has no borrower profile, no assigned agent, and no receiverId provided.");
        }
      } else {
        // User sending to admin/agent - use provided receiverId or assigned agent
        if (!finalReceiverId) {
          // Try to get assigned agent from assignment
          if (lead.assignment?.current?.agent) {
            const agentId = (lead.assignment.current.agent as any)?._id
              ? (lead.assignment.current.agent as any)._id.toString()
              : (lead.assignment.current.agent as Types.ObjectId).toString();
            finalReceiverId = agentId;
            receiverModel = "Agent";
          } else {
            throw new ApiError(400, "Receiver ID is required or lead must have an assigned agent");
          }
        }
      }
      
      // Try to determine receiver model by checking if it's a user
      // For simplicity, assume receiver is a User (lead owner)
      // You can enhance this by checking the receiver's actual role

      // Create message
      const message = await Message.create({
        text: text.trim(),
        sender: senderId,
        receiver: finalReceiverId,
        leadId: leadId,
        status: "sent",
        senderModel,
        receiverModel,
      });

      // Manually fetch sender and receiver data based on model type
      let senderData: any = { _id: senderId, name: "Unknown", email: "" };
      let receiverData: any = { _id: finalReceiverId, name: "Unknown", email: "" };

      // Fetch sender based on senderModel
      if (senderModel === "Admin") {
        const admin = await Admin.findById(senderId).select("_id email username").lean();
        if (admin) {
          senderData = {
            _id: admin._id.toString(),
            name: admin.username,
            email: admin.email,
          };
        }
      } else if (senderModel === "Agent") {
        const agent = await Agent.findById(senderId).select("_id name email profilePictureUrl").lean();
        if (agent) {
          senderData = {
            _id: agent._id.toString(),
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
          };
        }
      } else if (senderModel === "User") {
        const user = await User.findById(senderId).select("_id name email").lean();
        if (user) {
          senderData = {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
          };
        }
      }

      // Fetch receiver based on receiverModel
      // Note: In sendMessage, receiverModel is only "User" or "Agent", never "Admin"
      if (receiverModel === "Agent") {
        const agent = await Agent.findById(finalReceiverId).select("_id name email profilePictureUrl").lean();
        if (agent) {
          receiverData = {
            _id: agent._id.toString(),
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
          };
        }
      } else if (receiverModel === "User") {
        const user = await User.findById(finalReceiverId).select("_id name email").lean();
        if (user) {
          receiverData = {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
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
        leadId: message.leadId ? (message.leadId as Types.ObjectId).toString() : undefined,
      };

      // Emit socket event if socket.io is available
      const app = (req as any).app;
      const io = app?.get("socketio");
      if (io) {
        io.emit("leadMessage", {
          leadId,
          message: serializedMessage,
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
      const leadId = req.params.id;
      const userId = (req as any).user?._id;

      // Mark all unread messages in this lead conversation as read
      const result = await Message.updateMany(
        {
          leadId,
          receiver: userId,
          status: { $ne: "read" },
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

