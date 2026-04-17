import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Request, Response, NextFunction } from "express";
import { Message } from "../../modals/message.model";
import Lead from "../../modals/lead.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { InsuranceQuery } from "../../modals/insurancequery.model";
import { User } from "../../modals/user.model";
import Admin from "../../modals/admin.model";
import Agent from "../../modals/agent.model";
import Lander from "../../modals/lander.model";
import { Types } from "mongoose";
import { decryptQueryMessageText } from "../../utils/queryChatCrypto";

const buildUnreadChatMatch = (userId: any, role?: string) => {
  const objectId = userId ? new Types.ObjectId(String(userId)) : null;
  if (!objectId) return { _id: null };

  if (role === "admin") {
    return {
      receiver: objectId,
      status: { $ne: "read" },
      senderModel: { $in: ["Agent", "Lander", "User"] },
      receiverModel: { $in: ["Admin", "User"] },
    };
  }

  if (role === "agent") {
    return {
      receiver: objectId,
      status: { $ne: "read" },
      senderModel: { $in: ["Admin", "User"] },
      receiverModel: { $in: ["Agent", "User"] },
    };
  }

  return {
    receiver: objectId,
    status: { $ne: "read" },
    senderModel: { $in: ["Admin", "User"] },
    receiverModel: { $in: ["Lander", "User"] },
  };
};

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

      const currentObjectId = new Types.ObjectId(String(currentUserId));

      const rows = await Message.aggregate([
        {
          $match: {
            $or: [{ sender: currentObjectId }, { receiver: currentObjectId }],
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $addFields: {
            threadKind: {
              $switch: {
                branches: [
                  { case: { $ne: ["$leadId", null] }, then: "lead" },
                  { case: { $ne: ["$loanQueryId", null] }, then: "loan" },
                  { case: { $ne: ["$insuranceQueryId", null] }, then: "insurance" },
                ],
                default: "internal",
              },
            },
            otherParticipantId: {
              $cond: [{ $eq: ["$sender", currentObjectId] }, "$receiver", "$sender"],
            },
            otherParticipantModel: {
              $cond: [{ $eq: ["$sender", currentObjectId] }, "$receiverModel", "$senderModel"],
            },
            threadId: {
              $switch: {
                branches: [
                  {
                    case: { $ne: ["$leadId", null] },
                    then: { $toString: "$leadId" },
                  },
                  {
                    case: { $ne: ["$loanQueryId", null] },
                    then: { $toString: "$loanQueryId" },
                  },
                  {
                    case: { $ne: ["$insuranceQueryId", null] },
                    then: { $toString: "$insuranceQueryId" },
                  },
                ],
                default: {
                  $concat: [
                    { $toString: "$otherParticipantId" },
                    ":",
                    { $ifNull: ["$otherParticipantModel", "Unknown"] },
                  ],
                },
              },
            },
            isUnread: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", currentObjectId] },
                    { $ne: ["$status", "read"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              kind: "$threadKind",
              threadId: "$threadId",
              participantId: "$otherParticipantId",
              participantModel: "$otherParticipantModel",
            },
            lastMessage: { $first: "$$ROOT" },
            unreadCount: { $sum: "$isUnread" },
          },
        },
        { $sort: { "lastMessage.createdAt": -1 } },
      ]);

      const isValidObjectIdString = (value: any) => {
        const normalized = String(value || "").trim();
        return (
          normalized &&
          normalized !== "null" &&
          normalized !== "undefined" &&
          Types.ObjectId.isValid(normalized)
        );
      };

      const leadIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "lead")
          .map((r: any) => String(r?._id?.threadId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const loanIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "loan")
          .map((r: any) => String(r?._id?.threadId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const insuranceIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "insurance")
          .map((r: any) => String(r?._id?.threadId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const leadParticipantIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "lead")
          .map((r: any) => String(r?._id?.participantId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const loanParticipantIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "loan")
          .map((r: any) => String(r?._id?.participantId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const insuranceParticipantIds = [...new Set(
        rows
          .filter((r: any) => r?._id?.kind === "insurance")
          .map((r: any) => String(r?._id?.participantId || "").trim())
          .filter(isValidObjectIdString),
      )];
      const leadCustomerIds: string[] = [];
      const loanCustomerIds: string[] = [];
      const insuranceCustomerIds: string[] = [];
      const internalParticipantIds = [...new Set(rows.filter((r: any) => r?._id?.kind === "internal").map((r: any) => String(r?._id?.participantId)).filter(Boolean))];

      const [leads, loanQueries, insuranceQueries] = await Promise.all([
        Lead.find({ _id: { $in: leadIds } })
          .select("_id leadRef fullName mobile borrowerProfile")
          .lean(),
        LoanQuery.find({ _id: { $in: loanIds } })
          .select("_id loanId firstName lastName mobile loanType customerId")
          .lean(),
        InsuranceQuery.find({ _id: { $in: insuranceIds } })
          .select("_id firstName lastName mobile typeOfInsurance customerId")
          .lean(),
      ]);

      for (const lead of leads as any[]) {
        const customerId = String(lead?.borrowerProfile || "");
        if (customerId) leadCustomerIds.push(customerId);
      }
      for (const query of loanQueries as any[]) {
        const customerId = String(query?.customerId || "");
        if (customerId) loanCustomerIds.push(customerId);
      }
      for (const query of insuranceQueries as any[]) {
        const customerId = String(query?.customerId || "");
        if (customerId) insuranceCustomerIds.push(customerId);
      }

      const customerIds = [...new Set([
        ...leadCustomerIds,
        ...loanCustomerIds,
        ...insuranceCustomerIds,
        ...leadParticipantIds,
        ...loanParticipantIds,
        ...insuranceParticipantIds,
      ].filter(Boolean))];

      const [users, admins, agents, landers] = await Promise.all([
        User.find({ _id: { $in: customerIds } })
          .select("_id name firstName lastName email mobile profilePictureUrl")
          .lean(),
        Admin.find({ _id: { $in: internalParticipantIds } })
          .select("_id username name email profilePictureUrl")
          .lean(),
        Agent.find({ _id: { $in: internalParticipantIds } })
          .select("_id name email profilePictureUrl availability")
          .lean(),
        Lander.find({ _id: { $in: internalParticipantIds } })
          .select("_id name email profilePictureUrl availability")
          .lean(),
      ]);

      const leadMap = new Map<string, any>(
        (leads as any[]).map((item: any) => [String(item._id), item] as [string, any]),
      );
      const loanMap = new Map<string, any>(
        (loanQueries as any[]).map((item: any) => [String(item._id), item] as [string, any]),
      );
      const insuranceMap = new Map<string, any>(
        (insuranceQueries as any[]).map((item: any) => [String(item._id), item] as [string, any]),
      );
      const userMap = new Map<string, any>(
        (users as any[]).map((item: any) => [String(item._id), item] as [string, any]),
      );
      const staffEntries: [string, any][] = [
        ...(admins as any[]).map((item: any) => [String(item._id), { ...item, role: "Admin" }] as [string, any]),
        ...(agents as any[]).map((item: any) => [String(item._id), { ...item, role: "Agent" }] as [string, any]),
        ...(landers as any[]).map((item: any) => [String(item._id), { ...item, role: "Lander" }] as [string, any]),
      ];
      const staffMap = new Map<string, any>(staffEntries);

      const conversations = rows.map((row: any) => {
        const kind = String(row?._id?.kind || "internal");
        const threadId = String(row?._id?.threadId || "");
        const participantId = String(row?._id?.participantId || "");
        const participantModel = String(row?._id?.participantModel || "");
        const msg = row?.lastMessage || {};
        const unreadCount = Number(row?.unreadCount) || 0;
        const decodedText = decryptQueryMessageText(String(msg?.text || "")) || String(msg?.text || "");

        if (kind === "lead") {
          const lead = leadMap.get(threadId);
          const customer = userMap.get(String(lead?.borrowerProfile || participantId));
          const customerName = String(
            customer?.name ||
            [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
            lead?.fullName ||
            "Customer",
          ).trim();
          const leadRef = String(lead?.leadRef || "").trim();
          const hasLeadRef = Boolean(leadRef);

          return {
            _id: `lead:${threadId}:${participantId}`,
            kind: "lead",
            title: customerName,
            subtitle: hasLeadRef
              ? `Lead #${leadRef} · ${lead?.mobile || customer?.mobile || ""}`.trim()
              : `${lead?.mobile || customer?.mobile || ""}`.trim(),
            unreadCount,
            leadId: isValidObjectIdString(threadId) ? threadId : undefined,
            leadRef: hasLeadRef ? leadRef : undefined,
            leadName: lead?.fullName || customerName,
            receiverId: String(customer?._id || participantId || ""),
            receiverModel: "User",
            user: customer
              ? {
                  _id: String(customer._id),
                  name: customerName,
                  email: customer.email,
                  mobile: customer.mobile,
                  profilePictureUrl: customer.profilePictureUrl,
                  role: "User",
                }
              : undefined,
            agent: {
              _id: String(currentUserId),
              name: "You",
              role: role === "admin" ? "Admin" : role === "lander" ? "Lander" : "Agent",
            },
            lastMessage: {
              _id: String(msg?._id || ""),
              text: decodedText,
              createdAt: msg?.createdAt,
              senderModel: msg?.senderModel,
              attachmentsCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
            },
          };
        }

        if (kind === "loan") {
          const query = loanMap.get(threadId);
          const customer = userMap.get(String(query?.customerId || participantId));
          const customerName = String(
            customer?.name ||
            [query?.firstName, query?.lastName].filter(Boolean).join(" ") ||
            "Customer",
          ).trim();
          const loanId = String(query?.loanId || "").trim();

          return {
            _id: `loan:${threadId}:${participantId}`,
            kind: "loan",
            title: customerName,
            subtitle: loanId
              ? `Loan #${loanId} · ${query?.loanType || "Loan"}`
              : `${query?.loanType || "Loan"}`,
            unreadCount,
            loanQueryId: threadId,
            receiverId: String(customer?._id || participantId || ""),
            receiverModel: "User",
            user: customer
              ? {
                  _id: String(customer._id),
                  name: customerName,
                  email: customer.email,
                  mobile: customer.mobile,
                  profilePictureUrl: customer.profilePictureUrl,
                  role: "User",
                }
              : undefined,
            agent: {
              _id: String(currentUserId),
              name: "You",
              role: role === "admin" ? "Admin" : role === "lander" ? "Lander" : "Agent",
            },
            lastMessage: {
              _id: String(msg?._id || ""),
              text: decodedText,
              createdAt: msg?.createdAt,
              senderModel: msg?.senderModel,
              attachmentsCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
            },
          };
        }

        if (kind === "insurance") {
          const query = insuranceMap.get(threadId);
          const customer = userMap.get(String(query?.customerId || participantId));
          const customerName = String(
            customer?.name ||
            [query?.firstName, query?.lastName].filter(Boolean).join(" ") ||
            "Customer",
          ).trim();
          const insuranceLabel = String(query?.typeOfInsurance || "").trim();

          return {
            _id: `insurance:${threadId}:${participantId}`,
            kind: "insurance",
            title: customerName,
            subtitle: insuranceLabel
              ? `Insurance · ${insuranceLabel}`
              : "Insurance application",
            unreadCount,
            insuranceQueryId: threadId,
            receiverId: String(customer?._id || participantId || ""),
            receiverModel: "User",
            user: customer
              ? {
                  _id: String(customer._id),
                  name: customerName,
                  email: customer.email,
                  mobile: customer.mobile,
                  profilePictureUrl: customer.profilePictureUrl,
                  role: "User",
                }
              : undefined,
            agent: {
              _id: String(currentUserId),
              name: "You",
              role: role === "admin" ? "Admin" : role === "lander" ? "Lander" : "Agent",
            },
            lastMessage: {
              _id: String(msg?._id || ""),
              text: decodedText,
              createdAt: msg?.createdAt,
              senderModel: msg?.senderModel,
              attachmentsCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
            },
          };
        }

        const staff = staffMap.get(participantId) as any;
        const staffRole = String(staff?.role || participantModel || "Staff");
        const staffName = String(staff?.name || staff?.username || "Conversation");

        return {
          _id: `internal:${participantId}:${participantModel}`,
          kind: "internal",
          title: staffName,
          subtitle: `${staffRole} chat`,
          unreadCount,
          receiverId: participantId,
          receiverModel:
            participantModel === "Agent"
              ? "Agent"
              : participantModel === "Lander"
                ? "Lander"
                : "Admin",
          peer: {
            _id: participantId,
            name: staffName,
            email: staff?.email,
            profilePictureUrl: staff?.profilePictureUrl,
            role:
              participantModel === "Agent"
                ? "Agent"
                : participantModel === "Lander"
                  ? "Lander"
                  : "Admin",
          },
          lastMessage: {
            _id: String(msg?._id || ""),
            text: decodedText,
            createdAt: msg?.createdAt,
            senderModel: msg?.senderModel,
            attachmentsCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
          },
        };
      });

      const sortedConversations = conversations.sort((a, b) => {
        const unreadDelta = (b.unreadCount || 0) - (a.unreadCount || 0);
        if (unreadDelta !== 0) return unreadDelta;
        return (
          new Date(b.lastMessage?.createdAt || 0).getTime() -
          new Date(a.lastMessage?.createdAt || 0).getTime()
        );
      });

      res
        .status(200)
        .json(
          new ApiResponse(200, sortedConversations, "Conversations fetched successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  static async getSidebarCounts(
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

      const unread = await Message.countDocuments({
        receiver: new Types.ObjectId(String(currentUserId)),
        status: { $ne: "read" },
      });

      res
        .status(200)
        .json(new ApiResponse(200, { unread }, "Chat sidebar counts fetched successfully"));
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
        // Admin can chat with agents, landers, or users
        receiver = await Agent.findById(receiverId).select("_id name email profilePictureUrl").lean();
        if (!receiver) {
          receiver = await Lander.findById(receiverId).select("_id name email profilePictureUrl").lean();
          if (!receiver) {
            receiver = await User.findById(receiverId).select("_id name email avatar").lean();
          }
          if (!receiver) {
            throw new ApiError(404, "Agent, Lander, or User not found");
          }
        }
      } else if (role === "lander") {
        // Lander can chat with admins
        receiver = await Admin.findById(receiverId).select("_id email username").lean();
        if (!receiver) {
          throw new ApiError(404, "Admin not found");
        }
      } else {
        // Agent can chat with admins or users
        receiver = await Admin.findById(receiverId).select("_id email username").lean();
        if (!receiver) {
          receiver = await User.findById(receiverId).select("_id name email avatar").lean();
          if (!receiver) {
            throw new ApiError(404, "Admin or User not found");
          }
        }
      }

      // Get messages between current user and receiver
      const messages = await Message.find({
        $or: [
          { sender: currentUserId, receiver: receiverId },
          { sender: receiverId, receiver: currentUserId },
        ],
        senderModel: { $in: ["Admin", "Agent", "Lander", "User"] },
        receiverModel: { $in: ["Admin", "Agent", "Lander", "User"] },
      })
        .sort({ createdAt: 1 })
        .lean();

      // Mark messages as read
      await Message.updateMany(
        {
          sender: receiverId,
          receiver: currentUserId,
          status: { $ne: "read" },
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
          } else if (msg.receiverModel === "User") {
            const user = await User.findById(msg.receiver).select("_id name email avatar").lean();
            if (user) {
              receiverData = {
                _id: user._id.toString(),
                name: user.name,
                email: user.email,
                profilePictureUrl: (user as any).avatar,
              };
            }
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
              profilePictureUrl: (receiver as any).avatar,
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
      const { text, receiverId, media } = req.body;

      if (!role || (role !== "admin" && role !== "agent" && role !== "lander")) {
        throw new ApiError(403, "Access denied");
      }

      // Either text or media must be provided
      if ((!text || !text.trim()) && (!media || media.length === 0)) {
        throw new ApiError(400, "Message text or media is required");
      }

      if (!receiverId) {
        throw new ApiError(400, "Receiver ID is required");
      }

      // Verify receiver exists and is valid
      let receiverModel: "Admin" | "Agent" | "Lander" | "User" = "Admin";
      if (role === "admin") {
        // Admin can send to agents, landers, or users
        const agent = await Agent.findById(receiverId);
        if (agent) {
          receiverModel = "Agent";
        } else {
          const lander = await Lander.findById(receiverId);
          if (lander) {
            receiverModel = "Lander";
          } else {
            const customer = await User.findById(receiverId);
            if (customer) {
              receiverModel = "User";
            } else {
              throw new ApiError(404, "Agent, Lander, or User not found");
            }
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
        if (admin) {
          receiverModel = "Admin";
        } else {
          const customer = await User.findById(receiverId);
          if (!customer) {
            throw new ApiError(404, "Admin or User not found");
          }
          receiverModel = "User";
        }
      }

      const senderModel = role === "admin" ? "Admin" : role === "lander" ? "Lander" : "Agent";

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
        sender: currentUserId,
        receiver: receiverId,
        status: "sent",
        senderModel,
        receiverModel,
        attachments,
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
      } else if (receiverModel === "User") {
        const user = await User.findById(receiverId).select("_id name email avatar").lean();
        if (user) {
          receiverData = {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            profilePictureUrl: (user as any).avatar,
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
        text: decryptQueryMessageText(message.text || "") || message.text,
        sender: senderData,
        receiver: receiverData,
        status: message.status,
        readAt: message.readAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        senderModel: message.senderModel,
        receiverModel: message.receiverModel,
        attachments: message.attachments || [],
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
          senderModel: { $in: ["Admin", "Agent", "Lander", "User"] },
          receiverModel: { $in: ["Admin", "Agent", "Lander", "User"] },
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
