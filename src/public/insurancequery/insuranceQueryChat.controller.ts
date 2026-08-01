import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Message } from "../../modals/message.model";
import { InsuranceQuery } from "../../modals/insurancequery.model";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import Lander from "../../modals/lander.model";
import { User } from "../../modals/user.model";
import { Types } from "mongoose";
import {
  decryptQueryMessageText,
  encryptQueryMessageText,
} from "../../utils/queryChatCrypto";
import { resolveChatActorRole } from "../../utils/chatStaffRole";

// Helper to determine file type from mimetype
const getFileType = (
  mimetype: string,
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
const MAX_CHAT_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const toObjectId = (value: any): Types.ObjectId | null => {
  if (!value) return null;
  try {
    return new Types.ObjectId(String(value));
  } catch {
    return null;
  }
};

const normalizeId = (value: any) => String(value?._id || value || "");
const sameId = (a: any, b: any) => normalizeId(a) === normalizeId(b);

const assertInsuranceChatAccess = (query: any, role: string, actorId: any) => {
  const isStaff = ["admin", "lander", "agent"].includes(role);
  if (!isStaff && !sameId(query.customerId, actorId)) {
    throw new ApiError(403, "Access denied");
  }
  if (
    role === "lander" &&
    query.assignedLander &&
    !sameId(query.assignedLander, actorId)
  ) {
    throw new ApiError(403, "Access denied");
  }
  if (
    role === "agent" &&
    query.assignedAgent &&
    !sameId(query.assignedAgent, actorId)
  ) {
    throw new ApiError(403, "Access denied");
  }
};

const resolveSenderModel = async (role: string, senderId: any) => {
  if (role === "admin") return "Admin";
  if (role === "lander") return "Lander";
  if (role === "user") return "User";
  if (role === "agent") {
    const employee = await Admin.findById(senderId).select("_id").lean();
    if (employee) return "Admin";
    return "Agent";
  }
  return "User";
};

const resolveActorInfo = async (id: any, model?: string) => {
  if (!id) return { _id: "", name: "Unknown" };
  if (model === "Admin") {
    const admin = await Admin.findById(id)
      .select("_id email username name")
      .lean();
    if (admin) {
      return {
        _id: admin._id.toString(),
        name: admin.name || admin.username,
        email: admin.email,
      };
    }
  } else if (model === "Agent") {
    const agent = await Agent.findById(id).select("_id name email").lean();
    if (agent) {
      return {
        _id: agent._id.toString(),
        name: agent.name,
        email: agent.email,
      };
    }
  } else if (model === "Lander") {
    const lander = await Lander.findById(id).select("_id name email").lean();
    if (lander) {
      return {
        _id: lander._id.toString(),
        name: lander.name,
        email: lander.email,
      };
    }
  } else if (model === "User") {
    const user = await User.findById(id).select("_id name email").lean();
    if (user) {
      return {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
      };
    }
  }
  return { _id: String(id), name: "Unknown" };
};

export class InsuranceQueryChatController {
  /**
   * Get all messages for a specific insurance query
   */
  static async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const queryId = req.params.id;
      const { role: tokenRole, _id: actorId } = (req as any).user || {};
      const role = await resolveChatActorRole(actorId, tokenRole);

      // Verify insurance query exists
      const query = await InsuranceQuery.findById(queryId);
      if (!query) {
        throw new ApiError(404, "Insurance query not found");
      }

      assertInsuranceChatAccess(query, role, actorId);

      // Get messages for this insurance query
      const messages = await Message.find({ insuranceQueryId: queryId })
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

          senderData = await resolveActorInfo(msg.sender, msg.senderModel);
          receiverData = await resolveActorInfo(
            msg.receiver,
            msg.receiverModel,
          );

          return {
            ...msg,
            text: decryptQueryMessageText(msg.text || ""),
            sender: senderData,
            receiver: receiverData,
          };
        }),
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
    mimetype: string,
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
   * Send a message in insurance query chat
   */
  static async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const queryId = req.params.id;
      const { text, receiverId } = req.body;
      const senderId = (req as any).user?._id;
      const role = await resolveChatActorRole(
        senderId,
        (req as any).user?.role,
      );

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

      if (
        attachments.some(
          (file) => Number(file?.size || 0) > MAX_CHAT_FILE_SIZE_BYTES,
        )
      ) {
        throw new ApiError(400, "Each file must be 5 MB or smaller");
      }

      // Either text or media must be provided
      if ((!text || !text.trim()) && attachments.length === 0) {
        throw new ApiError(400, "Message text or media is required");
      }

      // Verify insurance query exists
      const query =
        await InsuranceQuery.findById(queryId).populate("customerId");
      if (!query) {
        throw new ApiError(404, "Insurance query not found");
      }
      assertInsuranceChatAccess(query, role, senderId);

      const senderModel = await resolveSenderModel(role, senderId);
      const customerId = (query.customerId as any)?._id || query.customerId;
      const assignedAgentId = query.assignedAgent || null;
      const assignedLanderId = query.assignedLander || null;

      const participantModels = new Map<
        string,
        "User" | "Admin" | "Agent" | "Lander"
      >();
      if (customerId) participantModels.set(String(customerId), "User");
      if (assignedAgentId)
        participantModels.set(String(assignedAgentId), "Admin");
      if (assignedLanderId)
        participantModels.set(String(assignedLanderId), "Lander");

      let finalReceiverId: any = receiverId;
      let receiverModel: "User" | "Admin" | "Agent" | "Lander" = "User";

      const requestedReceiver = receiverId ? String(receiverId) : "";
      if (senderModel === "User") {
        if (requestedReceiver && participantModels.has(requestedReceiver)) {
          finalReceiverId = requestedReceiver;
          receiverModel = participantModels.get(requestedReceiver)!;
        } else if (assignedAgentId) {
          finalReceiverId = assignedAgentId;
          receiverModel = "Admin";
        } else if (assignedLanderId) {
          finalReceiverId = assignedLanderId;
          receiverModel = "Lander";
        } else {
          const fallbackAdmin = await Admin.findOne({ status: true })
            .sort({ createdAt: 1 })
            .select("_id")
            .lean();
          if (!fallbackAdmin?._id) {
            throw new ApiError(400, "No admin available for chat");
          }
          finalReceiverId = fallbackAdmin._id;
          receiverModel = "Admin";
        }
      } else {
        finalReceiverId = customerId;
        receiverModel = "User";
      }

      if (sameId(finalReceiverId, senderId)) {
        throw new ApiError(400, "Sender and receiver cannot be the same");
      }
      const finalReceiverObjectId = toObjectId(finalReceiverId);
      if (!finalReceiverObjectId) {
        throw new ApiError(400, "Invalid receiver");
      }

      // Create message
      const plainText = (text || "").trim();
      const encryptedText = plainText ? encryptQueryMessageText(plainText) : "";
      const message = await Message.create({
        sender: senderId,
        receiver: finalReceiverObjectId,
        text: encryptedText,
        isEncrypted: Boolean(encryptedText),
        insuranceQueryId: queryId,
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

      senderData = await resolveActorInfo(senderId, senderModel);
      receiverData = await resolveActorInfo(
        finalReceiverObjectId,
        receiverModel,
      );

      const populatedMessage = {
        ...message.toObject(),
        text: plainText,
        sender: senderData,
        receiver: receiverData,
      };

      const app = (req as any).app;
      const io = app?.get("socketio");
      if (io) {
        io.emit("queryMessage", {
          kind: "insurance",
          queryId,
          message: populatedMessage,
        });
      }

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
          insuranceQueryId: queryId,
          receiver: userId,
          status: { $ne: "read" },
        },
        {
          $set: { status: "read", readAt: new Date() },
        },
      );

      res.status(200).json(new ApiResponse(200, {}, "Messages marked as read"));
    } catch (error) {
      next(error);
    }
  }
}
