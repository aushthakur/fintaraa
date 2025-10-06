import admin from "../utils/firebase";
import { config } from "../config/config";
import Admin from "../modals/admin.model";
import mongoose, { Types } from "mongoose";
import { User } from "../modals/user.model";
import { sendSMS } from "../utils/smsService";
import ApiResponse from "../utils/ApiResponse";
import { sendEmail } from "../utils/emailService";
import { paginationResult } from "../utils/helper";
import { Request, Response, NextFunction } from "express";
import { UserType, Notification } from "../modals/notification.model";
import { NotificationMessages } from "./../config/notificationMessages";

interface SendNotificationOptions {
  type: string;
  title: string;
  message: string;
  toUserId: string;
  toRole: UserType;
  fromUser?: { _id: string; role: UserType };
}

interface DualNotifyOptions {
  type: string;
  senderId: string;
  receiverId: string;
  senderRole: UserType;
  receiverRole: UserType;
  context: Record<string, string | number>;
}

interface SingleNotifyOptions {
  type: string;
  toUserId: string;
  toRole: UserType;
  direction?: "sender" | "receiver";
  context: Record<string, string | number>;
  fromUser?: { _id: string; role: UserType };
}

export const NotificationService = {
  async send(
    options: SendNotificationOptions,
    authUser?: { _id: string; role: UserType }
  ) {
    const { type, title, message, toRole, toUserId, fromUser } = options;
    const sender = fromUser || authUser;

    if (!sender) throw new Error("Sender information is missing.");

    let notification: any;

    try {
      // Create notification
      notification = await Notification.create({
        type,
        title,
        message,
        to: { user: new Types.ObjectId(toUserId), role: toRole },
        from: { user: new Types.ObjectId(sender._id), role: sender.role },
      });

      const resolveUserByRole = async (id: string, role: UserType) => {
        switch (role) {
          case "admin":
            return Admin.findById(id).lean();
          // case "agent":
          //   return Agent.findById(id).lean();
          case "worker":
          case "employer":
          case "contractor":
          default:
            return User.findById(id).lean();
        }
      };

      // Fetch sender and recipient
      const [recipient, senderUser]: any = await Promise.all([
        resolveUserByRole(toUserId, toRole),
        resolveUserByRole(sender._id, sender.role),
      ]);

      if (!recipient) throw new Error(`Recipient not found: ${toUserId}`);
      if (!senderUser) throw new Error(`Sender not found: ${sender._id}`);

      const isUserRole = ["worker", "contractor", "employer"].includes(toRole);
      const preferences = isUserRole
        ? recipient?.preferences?.notifications || {}
        : {};
      const smsAllowed = preferences.sms !== false;
      const pushAllowed = preferences.push !== false;
      const emailAllowed = isUserRole ? preferences.email !== false : true; // Always true for non-user roles

      const tasks: Promise<any>[] = [];
      const { fcmToken, mobile, email }: any = recipient;

      // --- Push Notification ---
      if (pushAllowed && fcmToken && admin) {
        tasks.push(
          admin
            .messaging()
            .send({
              token: fcmToken,
              notification: { title, body: message },
              data: {
                type,
                notificationId: notification._id.toString(),
              },
            })
            .then(() => {
              if (config.env === "development") {
                console.log(`[Notification] Push sent to userId=${toUserId}`);
              }
            })
            .catch((err) => {
              console.log(
                `[Notification Error] Push failed for userId=${toUserId}: ${err.message}`
              );
            })
        );
      }

      // --- Email Notification ---
      // if (emailAllowed && email && config?.email?.enabled) {
      //   tasks.push(
      //     sendEmail({
      //       to: email,
      //       subject: title,
      //       text: message,
      //       html: `<p>${message}</p>`,
      //       from: {
      //         name: senderUser?.fullName || senderUser?.name || "Notification Service",
      //         email: senderUser?.email || config?.email?.from,
      //       },
      //     })
      //       .then(() => {
      //         if (config.env === "development") {
      //           console.log(`[Notification] Email sent to ${email}`);
      //         }
      //       })
      //       .catch((err) => {
      //         console.log(
      //           `[Notification Error] Email failed for ${email}: ${err.message}`
      //         );
      //       })
      //   );
      // }

      // --- SMS Notification ---
      // if (smsAllowed && mobile && config.sms.enabled) {
      //   tasks.push(
      //     sendSMS({ to: mobile, message })
      //       .then(() => {
      //         if (config.env === "development") {
      //           console.log(`[Notification] SMS sent to ${mobile}`);
      //         }
      //       })
      //       .catch((err) => {
      //         console.log(
      //           `[Notification Error] SMS failed for ${mobile}: ${err.message}`
      //         );
      //       })
      //   );
      // }
      await Promise.all(tasks);
    } catch (err: any) {
      console.log(`[Notification Critical] ${err.message}`);
      if (!notification) throw err;
    }
    return notification;
  },
};

export async function sendDualNotification({
  type,
  context,
  senderId,
  senderRole,
  receiverId,
  receiverRole,
}: DualNotifyOptions) {
  const template = NotificationMessages[type];

  const [receiverMsg, senderMsg] = [
    template.receiver(context),
    template.sender(context),
  ];

  await Promise.all([
    NotificationService.send({
      type,
      toUserId: receiverId,
      toRole: receiverRole,
      title: receiverMsg.title.toString(),
      message: receiverMsg.message.toString(),
      fromUser: { _id: senderId, role: senderRole },
    }),
    NotificationService.send({
      type,
      toUserId: senderId,
      toRole: senderRole,
      title: senderMsg.title.toString(),
      message: senderMsg.message.toString(),
      fromUser: { _id: receiverId, role: receiverRole },
    }),
  ]);
}

export async function sendSingleNotification({
  type,
  context,
  toUserId,
  toRole,
  fromUser,
  direction = "receiver",
}: SingleNotifyOptions) {
  const template = NotificationMessages[type]?.[direction];
  if (!template) throw new Error(`Missing notification template for ${type}`);

  const { title, message } = template(context);

  await NotificationService.send({
    type,
    toRole,
    toUserId,
    fromUser,
    title: title.toString(),
    message: message.toString(),
  });
}

export const getAllNotifications = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) => {
  try {
    const { user } = req;
    const { page = 1, limit = 10, user: queryUser, queryRole } = req.query;

    const pageNumber = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit as string, 10) || 10, 10);

    // Safe check for userId from query or logged-in user
    const rawUserId = queryUser || user?._id;
    const targetRole = queryUser ? queryRole : user?.role;

    // This is the fix
    if (
      !rawUserId ||
      typeof rawUserId !== "string" ||
      !mongoose.isValidObjectId(rawUserId)
    ) {
      return res
        .status(400)
        .json(
          new ApiResponse(
            400,
            null,
            `Invalid or missing user ID. Received: ${rawUserId}`
          )
        );
    }

    if (!targetRole) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Missing role for user."));
    }

    const userObjectId = new mongoose.Types.ObjectId(rawUserId as string);

    const matchStage =
      user?.role === "admin" && !queryUser
        ? {}
        : { "to.user": userObjectId, "to.role": targetRole };

    const notifications = await Notification.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: (pageNumber - 1) * limitNumber },
      { $limit: limitNumber },
      {
        $lookup: {
          from: "users",
          localField: "to.user",
          foreignField: "_id",
          as: "toUser",
        },
      },
      {
        $lookup: {
          from: "admins",
          localField: "to.user",
          foreignField: "_id",
          as: "toAdmin",
        },
      },
      {
        $lookup: {
          from: "agents",
          localField: "to.user",
          foreignField: "_id",
          as: "toAgent",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "from.user",
          foreignField: "_id",
          as: "fromUser",
        },
      },
      {
        $lookup: {
          from: "admins",
          localField: "from.user",
          foreignField: "_id",
          as: "fromAdmin",
        },
      },
      {
        $lookup: {
          from: "agents",
          localField: "from.user",
          foreignField: "_id",
          as: "fromAgent",
        },
      },
      {
        $lookup: {
          from: "fileuploads",
          let: { userId: "$to.user" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$refId", "$$userId"] },
                    { $eq: ["$tag", "profilePic"] },
                  ],
                },
              },
            },
            { $project: { url: 1, _id: 0 } },
            { $limit: 1 },
          ],
          as: "toProfilePic",
        },
      },
      {
        $lookup: {
          from: "fileuploads",
          let: { userId: "$from.user" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$refId", "$$userId"] },
                    { $eq: ["$tag", "profilePic"] },
                  ],
                },
              },
            },
            { $project: { url: 1, _id: 0 } },
            { $limit: 1 },
          ],
          as: "fromProfilePic",
        },
      },
      {
        $addFields: {
          to: {
            $mergeObjects: [
              { role: "$to.role" },
              {
                $first: {
                  $concatArrays: ["$toUser", "$toAdmin", "$toAgent"],
                },
              },
              { profilePic: { $arrayElemAt: ["$toProfilePic.url", 0] } },
            ],
          },
          from: {
            $mergeObjects: [
              { role: "$from.role" },
              {
                $first: {
                  $concatArrays: ["$fromUser", "$fromAdmin", "$fromAgent"],
                },
              },
              { profilePic: { $arrayElemAt: ["$fromProfilePic.url", 0] } },
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          type: 1,
          title: 1,
          readAt: 1,
          status: 1,
          message: 1,
          createdAt: 1,
          to: {
            _id: 1,
            name: 1,
            email: 1,
            status: 1,
            mobile: 1,
            userType: 1,
            fullName: 1,
            profilePic: 1,
          },
          from: {
            _id: 1,
            name: 1,
            email: 1,
            status: 1,
            mobile: 1,
            userType: 1,
            fullName: 1,
            profilePic: 1,
          },
        },
      },
    ]);

    const total = await Notification.countDocuments(matchStage);
    const data = paginationResult(
      pageNumber,
      limitNumber,
      total,
      notifications
    );

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          data,
          notifications.length
            ? "Notifications fetched successfully."
            : "No notifications found."
        )
      );
  } catch (error) {
    next(error);
  }
};

export const markNotificationRead = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId, role } = req.user || {};
    const { notificationId, markAll } = req.query;

    if (!userId || !role)
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Missing user information."));

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // =====================
    // 🔹 Mark ALL as Read
    // =====================
    if (markAll === "true") {
      const result = await Notification.updateMany(
        {
          "to.user": userObjectId,
          "to.role": role,
          status: "unread",
        },
        {
          $set: {
            status: "read",
            readAt: new Date(),
          },
        }
      );

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { modifiedCount: result.modifiedCount },
            `${result.modifiedCount} notifications marked as read.`
          )
        );
    }

    // =====================
    // 🔹 Mark ONE as Read
    // =====================
    if (!notificationId) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Notification ID is required."));
    }

    const updated = await Notification.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(notificationId as string),
        "to.user": userObjectId,
        "to.role": role,
        status: { $ne: "read" },
      },
      {
        $set: {
          status: "read",
          readAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json(
          new ApiResponse(
            404,
            null,
            "Notification not found or already marked as read."
          )
        );
    }

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updated,
          "Notification marked as read successfully."
        )
      );
  } catch (error) {
    next(error);
  }
};

export const getNotificationStats = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) => {
  try {
    const { user } = req;
    const { user: queryUser, role: queryRole } = req.query;

    const targetUserId = (queryUser as string) || user?._id;
    const targetUserRole = (queryRole as string) || user?.role;

    if (!targetUserId || !targetUserRole) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "User ID and role are required."));
    }

    const userObjectId = new mongoose.Types.ObjectId(targetUserId);

    const stats = await Notification.aggregate([
      {
        $match: {
          "to.user": userObjectId,
          "to.role": targetUserRole,
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const mapped = stats.reduce(
      (acc, curr) => {
        acc[curr._id] = curr.count;
        acc.total += curr.count;
        return acc;
      },
      {
        read: 0,
        unread: 0,
        deleted: 0,
        total: 0,
      }
    );
    return res
      .status(200)
      .json(
        new ApiResponse(200, mapped, "Notification stats fetched successfully.")
      );
  } catch (error) {
    next(error);
  }
};
