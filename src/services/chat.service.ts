import { User } from "../modals/user.model";
import { Types, PipelineStage } from "mongoose";
import { Message, IMessage } from "../modals/message.model";

interface ConversationSummary {
  _id: string;
  participant: {
    _id: string;
    name?: string;
    username?: string;
    avatar?: string;
  };
  unreadCount: number;
  lastMessage: SerializedMessage | null;
}

export interface SerializedMessage {
  _id: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
  senderId: string;
  receiverId: string;
  readAt: Date | null;
  status: "sent" | "delivered" | "read";
}

const toObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);
const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id);

const serializeMessage = (message: any): SerializedMessage => {
  const sender =
    typeof message.sender === "string"
      ? message.sender
      : (message.sender as Types.ObjectId)?.toString();
  const receiver =
    typeof message.receiver === "string"
      ? message.receiver
      : (message.receiver as Types.ObjectId)?.toString();

  return {
    _id: message._id.toString(),
    text: message.text || "",
    status: (message.status as SerializedMessage["status"]) || "sent",
    senderId: sender || "",
    receiverId: receiver || "",
    createdAt: message.createdAt as Date,
    updatedAt: message.updatedAt as Date,
    readAt: (message.readAt as Date) || null,
  };
};

export class ChatService {
  static serialize(message: IMessage): SerializedMessage {
    return serializeMessage(
      typeof message.toObject === "function" ? message.toObject() : message
    );
  }

  private static formatUser(user: any) {
    if (!user) return null;
    const firstName = user.firstName || "";
    const lastName = user.lastName || "";
    const fullName = `${firstName} ${lastName}`.trim();
    return {
      _id: user._id.toString(),
      name: fullName || user.username || user.email || "Unknown user",
      username: user.username || undefined,
      avatar: user.avatar || undefined,
    };
  }

  static async createMessage(
    senderId: string,
    receiverId: string,
    text: string
  ): Promise<SerializedMessage> {
    const message = await Message.create({
      sender: senderId,
      receiver: receiverId,
      text,
      status: "sent",
    });
    return this.serialize(message);
  }

  static async getConversationSummaries(
    userId: string
  ): Promise<ConversationSummary[]> {
    const userObjectId = toObjectId(userId);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          $or: [{ sender: userObjectId }, { receiver: userObjectId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          participantId: {
            $cond: [{ $eq: ["$sender", userObjectId] }, "$receiver", "$sender"],
          },
          isUnread: {
            $cond: [
              {
                $and: [
                  { $eq: ["$receiver", userObjectId] },
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
          _id: "$participantId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: { $sum: "$isUnread" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "participant",
        },
      },
      { $unwind: "$participant" },
      {
        $project: {
          _id: 1,
          unreadCount: 1,
          participant: {
            _id: "$participant._id",
            name: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ["$participant.firstName", ""] },
                    " ",
                    { $ifNull: ["$participant.lastName", ""] },
                  ],
                },
              },
            },
            username: "$participant.username",
            avatar: "$participant.avatar",
          },
          lastMessage: {
            _id: "$lastMessage._id",
            text: "$lastMessage.text",
            status: "$lastMessage.status",
            readAt: "$lastMessage.readAt",
            sender: "$lastMessage.sender",
            receiver: "$lastMessage.receiver",
            createdAt: "$lastMessage.createdAt",
            updatedAt: "$lastMessage.updatedAt",
          },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ] as PipelineStage[];

    const results = await Message.aggregate(pipeline);
    return results.map((item: any) => ({
      _id: item._id.toString(),
      participant: {
        _id: item.participant._id.toString(),
        name: item.participant.name,
        avatar: item.participant.avatar,
        username: item.participant.username,
      },
      unreadCount: item.unreadCount || 0,
      lastMessage: item.lastMessage
        ? serializeMessage({
            ...item.lastMessage,
            _id: item.lastMessage._id,
            sender: item.lastMessage.sender,
            receiver: item.lastMessage.receiver,
          })
        : null,
    }));
  }

  static async getAllConversationSummaries() {
    const pipeline: PipelineStage[] = [
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          senderStr: { $toString: "$sender" },
          receiverStr: { $toString: "$receiver" },
        },
      },
      {
        $addFields: {
          orderedParticipants: {
            $cond: [
              { $lt: ["$senderStr", "$receiverStr"] },
              ["$sender", "$receiver"],
              ["$receiver", "$sender"],
            ],
          },
          conversationKey: {
            $cond: [
              { $lt: ["$senderStr", "$receiverStr"] },
              { $concat: ["$senderStr", "_", "$receiverStr"] },
              { $concat: ["$receiverStr", "_", "$senderStr"] },
            ],
          },
          isUnread: {
            $cond: [{ $ne: ["$status", "read"] }, 1, 0],
          },
        },
      },
      {
        $group: {
          _id: "$conversationKey",
          participants: { $first: "$orderedParticipants" },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: { $sum: "$isUnread" },
        },
      },
      {
        $lookup: {
          from: "users",
          let: { participantIds: "$participants" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$_id", "$$participantIds"],
                },
              },
            },
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                username: 1,
                avatar: 1,
                email: 1,
              },
            },
          ],
          as: "participantDocs",
        },
      },
      {
        $addFields: {
          participantDocs: {
            $map: {
              input: "$participants",
              as: "participantId",
              in: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$participantDocs",
                      cond: { $eq: ["$$this._id", "$$participantId"] },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          unreadCount: 1,
          participants: "$participantDocs",
          lastMessage: {
            _id: "$lastMessage._id",
            text: "$lastMessage.text",
            status: "$lastMessage.status",
            readAt: "$lastMessage.readAt",
            sender: "$lastMessage.sender",
            receiver: "$lastMessage.receiver",
            createdAt: "$lastMessage.createdAt",
            updatedAt: "$lastMessage.updatedAt",
          },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ];

    const results = await Message.aggregate(pipeline);
    return results.map((item: any) => {
      const participants =
        item.participants
          ?.map((participant: any) => this.formatUser(participant))
          ?.filter(Boolean) ?? [];

      return {
        conversationId: item._id,
        participants,
        unreadCount: item.unreadCount || 0,
        lastMessage: item.lastMessage
          ? serializeMessage({
              ...item.lastMessage,
              _id: item.lastMessage._id,
              sender: item.lastMessage.sender,
              receiver: item.lastMessage.receiver,
            })
          : null,
      };
    });
  }

  static async getConversationSummary(
    userId: string,
    participantId: string
  ): Promise<ConversationSummary | null> {
    const summaries = await this.getConversationSummaries(userId);
    return summaries.find((summary) => summary._id === participantId) || null;
  }

  static async getMessagesBetween(
    userId: string,
    withUserId: string,
    limit: number = 50,
    before?: string
  ): Promise<SerializedMessage[]> {
    const userObjectId = toObjectId(userId);
    const withUserObjectId = toObjectId(withUserId);

    const query: Record<string, any> = {
      $or: [
        { sender: userObjectId, receiver: withUserObjectId },
        { sender: withUserObjectId, receiver: userObjectId },
      ],
    };

    if (before && Types.ObjectId.isValid(before)) {
      query._id = { $lt: toObjectId(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 100)))
      .lean();

    return messages.reverse().map((msg) =>
      serializeMessage({
        ...msg,
        _id: msg._id,
        sender: msg.sender,
        receiver: msg.receiver,
      })
    );
  }

  static async markConversationRead(
    userId: string,
    fromUserId: string
  ): Promise<number> {
    const result = await Message.updateMany(
      {
        sender: fromUserId,
        receiver: userId,
        status: { $ne: "read" },
      },
      {
        status: "read",
        readAt: new Date(),
      }
    );
    return result.modifiedCount;
  }

  static async ensureParticipantExists(participantId: string) {
    const participant = await User.findById(participantId)
      .select("_id name username avatar")
      .lean();
    return participant;
  }

  static async getMessagesByConversationKey(
    conversationKey: string,
    limit: number = 100,
    before?: string
  ): Promise<SerializedMessage[]> {
    if (!conversationKey || !conversationKey.includes("_")) {
      throw new Error("Invalid conversation identifier");
    }

    const [first, second] = conversationKey.split("_");
    if (!isValidObjectId(first) || !isValidObjectId(second)) {
      throw new Error("Invalid conversation participant identifiers");
    }

    const firstId = toObjectId(first);
    const secondId = toObjectId(second);

    const query: Record<string, any> = {
      $or: [
        { sender: firstId, receiver: secondId },
        { sender: secondId, receiver: firstId },
      ],
    };

    if (before && Types.ObjectId.isValid(before)) {
      query._id = { $lt: toObjectId(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .lean();

    return messages.reverse().map((msg) =>
      serializeMessage({
        ...msg,
        _id: msg._id,
        sender: msg.sender,
        receiver: msg.receiver,
      })
    );
  }
}

export type { ConversationSummary };
