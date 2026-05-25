import { NextFunction, Request, Response } from "express";
import ApiResponse from "../../utils/ApiResponse";
import { UserType } from "../../modals/notification.model";
import {
  getVapidPublicKey,
  removeWebPushSubscription,
  upsertWebPushSubscription,
} from "../../services/webPush.service";

type AuthRequest = Request & {
  user?: {
    _id: string;
    role: UserType;
  };
};

export class WebPushController {
  static async getPublicKey(req: Request, res: Response, next: NextFunction) {
    try {
      const publicKey = getVapidPublicKey();
      return res
        .status(200)
        .json(new ApiResponse(200, { publicKey }, "VAPID public key fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async subscribe(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?._id || !req.user?.role) {
        return res
          .status(401)
          .json(new ApiResponse(401, null, "Unauthorized"));
      }

      const record = await upsertWebPushSubscription({
        userId: req.user._id,
        role: req.user.role,
        subscription: req.body?.subscription,
        userAgent: req.headers["user-agent"],
      });

      return res
        .status(200)
        .json(new ApiResponse(200, record, "Web push subscription saved"));
    } catch (error) {
      next(error);
    }
  }

  static async unsubscribe(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?._id) {
        return res
          .status(401)
          .json(new ApiResponse(401, null, "Unauthorized"));
      }

      await removeWebPushSubscription({
        userId: req.user._id,
        endpoint: req.body?.endpoint,
      });

      return res
        .status(200)
        .json(new ApiResponse(200, null, "Web push subscription removed"));
    } catch (error) {
      next(error);
    }
  }
}
