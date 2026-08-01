import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Message } from "../../modals/message.model";
import { ChatService } from "../../services/chat.service";
import Lead from "../../modals/lead.model";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import Lander from "../../modals/lander.model";
import { User } from "../../modals/user.model";
import { Types } from "mongoose";
import { decryptQueryMessageText } from "../../utils/queryChatCrypto";
import { resolveChatActorRole } from "../../utils/chatStaffRole";

const normalizeChatId = (value: any) => String(value?._id || value || "");

const assertLeadChatAccess = (lead: any, role: string, actorId: any) => {
  if (role === "admin") return;
  if (role === "agent" || role === "lander") {
    const assignedAgentId = normalizeChatId(lead?.assignment?.current?.agent);
    if (assignedAgentId && assignedAgentId === normalizeChatId(actorId)) {
      return;
    }
    throw new ApiError(403, "Access denied");
  }
  if (
    normalizeChatId(lead?.borrowerProfile) === normalizeChatId(actorId)
  ) {
    return;
  }
  throw new ApiError(403, "Access denied");
};

const resolveLeadStaffModel = async (
  staffId: any,
): Promise<"Admin" | "Agent" | "Lander" | null> => {
  if (!staffId || !Types.ObjectId.isValid(String(staffId))) return null;
  const admin = await Admin.exists({ _id: staffId, status: true });
  if (admin) return "Admin";
  const agent = await Agent.exists({ _id: staffId });
  if (agent) return "Agent";
  const lander = await Lander.exists({ _id: staffId });
  return lander ? "Lander" : null;
};

export class LeadChatController {
  /**
   * Get unique live chat conversations between agents and users (lead chats only)
   */
  static async getConversations(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const currentUserId = (req as any).user?._id;
      const role = await resolveChatActorRole(
        currentUserId,
        (req as any).user?.role,
      );

      if (!role || !["admin", "agent", "lander"].includes(role)) {
        throw new ApiError(403, "Access denied");
      }

      const match: any = {
        leadId: { $exists: true, $ne: null },
        $or: [
          { senderModel: "User", receiverModel: { $in: ["Agent", "Admin", "Lander"] } },
          { senderModel: { $in: ["Agent", "Admin", "Lander"] }, receiverModel: "User" },
        ],
      };

      if ((role === "agent" || role === "lander") && currentUserId) {
        match.$or = [
          {
            senderModel: { $in: ["Agent", "Admin", "Lander"] },
            receiverModel: "User",
            sender: new Types.ObjectId(String(currentUserId)),
          },
          {
            senderModel: "User",
            receiverModel: { $in: ["Agent", "Admin", "Lander"] },
            receiver: new Types.ObjectId(String(currentUserId)),
          },
        ];
      }

      const rows = await Message.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
          $addFields: {
            userId: {
              $cond: [
                { $eq: ["$senderModel", "User"] },
                "$sender",
                {
                  $cond: [
                    { $eq: ["$receiverModel", "User"] },
                    "$receiver",
                    null,
                  ],
                },
              ],
            },
            staffId: {
              $cond: [
                { $eq: ["$senderModel", "User"] },
                "$receiver",
                "$sender",
              ],
            },
            staffModel: {
              $cond: [
                { $eq: ["$senderModel", "User"] },
                "$receiverModel",
                "$senderModel",
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              leadId: "$leadId",
              userId: "$userId",
              staffId: "$staffId",
              staffModel: "$staffModel",
            },
            lastMessage: { $first: "$$ROOT" },
            unreadCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$receiver", new Types.ObjectId(String(currentUserId))] },
                      { $ne: ["$status", "read"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { "lastMessage.createdAt": -1 } },
      ]);

      const leadIds = [...new Set(rows.map((r: any) => String(r?._id?.leadId)).filter(Boolean))];
      const userIds = [...new Set(rows.map((r: any) => String(r?._id?.userId)).filter(Boolean))];
      const staffIds = [...new Set(rows.map((r: any) => String(r?._id?.staffId)).filter(Boolean))];

      const [leads, users, agents, admins, landers] = await Promise.all([
        Lead.find({ _id: { $in: leadIds } })
          .select("_id leadRef fullName mobile")
          .lean(),
        User.find({ _id: { $in: userIds } })
          .select("_id name email mobile")
          .lean(),
        Agent.find({ _id: { $in: staffIds } })
          .select("_id name email")
          .lean(),
        Admin.find({ _id: { $in: staffIds } })
          .select("_id username name email")
          .lean(),
        Lander.find({ _id: { $in: staffIds } })
          .select("_id name email")
          .lean(),
      ]);

      const leadMap = new Map(leads.map((lead: any) => [String(lead._id), lead]));
      const userMap = new Map(users.map((u: any) => [String(u._id), u]));
      const agentMap = new Map(
        [...agents, ...admins, ...landers].map((a: any) => [String(a._id), a]),
      );

      const conversations = rows.map((row: any) => {
        const leadId = String(row?._id?.leadId || "");
        const userId = String(row?._id?.userId || "");
        const staffId = String(row?._id?.staffId || "");
        const staffModel = String(row?._id?.staffModel || "");
        const lead = leadMap.get(leadId);
        const user = userMap.get(userId);
        const agent = agentMap.get(staffId);
        const msg = row?.lastMessage || {};

        return {
          _id: `${leadId}:${userId}:${staffId}:${staffModel}`,
          leadId,
          leadRef: lead?.leadRef || leadId.slice(-8),
          leadName: lead?.fullName || "Lead",
          user: {
            _id: userId,
            name: user?.name || "User",
            email: user?.email || "",
            mobile: user?.mobile || "",
          },
          agent: staffId
            ? {
                _id: staffId,
                name: agent?.name || agent?.username || "Agent",
                email: agent?.email || "",
                role:
                  staffModel === "Admin"
                    ? "Admin"
                    : staffModel === "Lander"
                      ? "Lander"
                      : "Agent",
              }
            : undefined,
          unreadCount: Number(row?.unreadCount) || 0,
          lastMessage: {
            _id: String(msg?._id || ""),
            text: msg?.text || "",
            createdAt: msg?.createdAt,
            senderModel: msg?.senderModel,
            attachmentsCount: Array.isArray(msg?.attachments)
              ? msg.attachments.length
              : 0,
          },
        };
      });

      return res
        .status(200)
        .json(new ApiResponse(200, conversations, "Conversations fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

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
      const role = await resolveChatActorRole(
        userId,
        (req as any).user?.role,
      );

      // Verify lead exists
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }

      assertLeadChatAccess(lead, role, userId);

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
            } else {
              const admin = await Admin.findById(msg.sender)
                .select("_id email username name")
                .lean();
              if (admin) {
                senderData = {
                  _id: admin._id.toString(),
                  name: admin.name || admin.username,
                  email: admin.email,
                };
              }
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
          } else if (msg.senderModel === "Lander") {
            const lander = await Lander.findById(msg.sender)
              .select("_id name email profilePictureUrl")
              .lean();
            if (lander) {
              senderData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
                profilePictureUrl: lander.profilePictureUrl,
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
            } else {
              const admin = await Admin.findById(msg.receiver)
                .select("_id email username name")
                .lean();
              if (admin) {
                receiverData = {
                  _id: admin._id.toString(),
                  name: admin.name || admin.username,
                  email: admin.email,
                };
              }
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
          } else if (msg.receiverModel === "Lander") {
            const lander = await Lander.findById(msg.receiver)
              .select("_id name email profilePictureUrl")
              .lean();
            if (lander) {
              receiverData = {
                _id: lander._id.toString(),
                name: lander.name,
                email: lander.email,
                profilePictureUrl: lander.profilePictureUrl,
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
            text: decryptQueryMessageText(msg.text || "") || msg.text,
            sender: senderData,
            receiver: receiverData,
            status: msg.status,
            readAt: msg.readAt,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
            senderModel: msg.senderModel,
            receiverModel: msg.receiverModel,
            attachments: msg.attachments || [],
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
      const { text, receiverId, media } = req.body;
      const senderId = (req as any).user?._id;
      const role = await resolveChatActorRole(
        senderId,
        (req as any).user?.role,
      );

      // Either text or media must be provided
      if ((!text || !text.trim()) && (!media || media.length === 0)) {
        throw new ApiError(400, "Message text or media is required");
      }

      // Verify lead exists
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }
      assertLeadChatAccess(lead, role, senderId);

      // Determine sender and receiver models
      const senderModel =
        role === "admin"
          ? "Admin"
          : role === "agent" || role === "lander"
            ? (await resolveLeadStaffModel(senderId)) ||
              (role === "lander" ? "Lander" : "Agent")
            : "User";
      
      // Determine receiver: 
      // - If admin/agent is sending, receiver should be the lead owner (borrowerProfile)
      // - If user is sending, receiver should be the assigned agent/admin
      // Ensure receiverId is a string if provided
      let finalReceiverId: string | undefined = receiverId 
        ? (typeof receiverId === 'string' ? receiverId : (receiverId as any)?._id?.toString() || receiverId.toString())
        : undefined;
      let receiverModel: "User" | "Admin" | "Agent" | "Lander" = "User";

      if (
        senderModel === "Admin" ||
        senderModel === "Agent" ||
        senderModel === "Lander"
      ) {
        // Staff replies always go to the customer attached to this lead.
        if (lead.borrowerProfile) {
          // Priority 1: Send to lead owner (borrowerProfile)
          // Extract _id if populated, otherwise use the ObjectId directly
          const borrowerId = (lead.borrowerProfile as any)?._id 
            ? (lead.borrowerProfile as any)._id.toString()
            : (lead.borrowerProfile as Types.ObjectId).toString();
          finalReceiverId = borrowerId;
          receiverModel = "User";
        } else if (
          finalReceiverId &&
          (await User.exists({ _id: finalReceiverId }))
        ) {
          receiverModel = "User";
        } else {
          throw new ApiError(
            400,
            "Cannot determine the customer for this lead conversation",
          );
        }
      } else {
        // Customer messages are restricted to the lead's current assignee.
        const assignedId = normalizeChatId(lead.assignment?.current?.agent);
        if (!assignedId) {
          throw new ApiError(400, "Lead must have an assigned agent");
        }
        if (finalReceiverId && normalizeChatId(finalReceiverId) !== assignedId) {
          throw new ApiError(403, "Receiver is not assigned to this lead");
        }
        finalReceiverId = assignedId;
        receiverModel = (await resolveLeadStaffModel(assignedId)) || "Agent";
      }

      if (!finalReceiverId || !Types.ObjectId.isValid(finalReceiverId)) {
        throw new ApiError(400, "Invalid message receiver");
      }

      // Helper function to determine media type from mimetype
      const getMediaType = (mimetype: string): "image" | "video" | "audio" | "document" | "other" => {
        if (mimetype.startsWith("image/")) return "image";
        if (mimetype.startsWith("video/")) return "video";
        if (mimetype.startsWith("audio/")) return "audio";
        if (
          mimetype.includes("pdf") ||
          mimetype.includes("document") ||
          mimetype.includes("text") ||
          mimetype.includes("msword") ||
          mimetype.includes("wordprocessingml") ||
          mimetype.includes("spreadsheet") ||
          mimetype.includes("presentation")
        ) return "document";
        return "other";
      };

      // Process media attachments if present
      const attachments = media && Array.isArray(media) 
        ? media.map((file: any) => ({
            url: file.url,
            type: getMediaType(file.mimetype),
            name: file.name || file.originalname,
            size: file.size,
            mimetype: file.mimetype,
          }))
        : [];

      // Create message
      const message = await Message.create({
        text: text ? text.trim() : "",
        sender: senderId,
        receiver: finalReceiverId,
        leadId: leadId,
        status: "sent",
        senderModel,
        receiverModel,
        attachments,
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
        } else {
          const admin = await Admin.findById(senderId)
            .select("_id email username name")
            .lean();
          if (admin) {
            senderData = {
              _id: admin._id.toString(),
              name: admin.name || admin.username,
              email: admin.email,
            };
          }
        }
      } else if (senderModel === "Lander") {
        const lander = await Lander.findById(senderId)
          .select("_id name email profilePictureUrl")
          .lean();
        if (lander) {
          senderData = {
            _id: lander._id.toString(),
            name: lander.name,
            email: lander.email,
            profilePictureUrl: lander.profilePictureUrl,
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

      // Fetch receiver based on receiverModel.
      if (receiverModel === "Agent") {
        const agent = await Agent.findById(finalReceiverId).select("_id name email profilePictureUrl").lean();
        if (agent) {
          receiverData = {
            _id: agent._id.toString(),
            name: agent.name,
            email: agent.email,
            profilePictureUrl: agent.profilePictureUrl,
          };
        } else {
          const admin = await Admin.findById(finalReceiverId)
            .select("_id email username name")
            .lean();
          if (admin) {
            receiverData = {
              _id: admin._id.toString(),
              name: admin.name || admin.username,
              email: admin.email,
            };
          }
        }
      } else if (receiverModel === "Admin") {
        const admin = await Admin.findById(finalReceiverId)
          .select("_id email username name")
          .lean();
        if (admin) {
          receiverData = {
            _id: admin._id.toString(),
            name: admin.name || admin.username,
            email: admin.email,
          };
        }
      } else if (receiverModel === "Lander") {
        const lander = await Lander.findById(finalReceiverId)
          .select("_id name email profilePictureUrl")
          .lean();
        if (lander) {
          receiverData = {
            _id: lander._id.toString(),
            name: lander.name,
            email: lander.email,
            profilePictureUrl: lander.profilePictureUrl,
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
        text: decryptQueryMessageText(message.text || "") || message.text,
        sender: senderData,
        receiver: receiverData,
        status: message.status,
        readAt: message.readAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        senderModel: message.senderModel,
        receiverModel: message.receiverModel,
        leadId: message.leadId ? (message.leadId as Types.ObjectId).toString() : undefined,
        attachments: message.attachments || [],
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
