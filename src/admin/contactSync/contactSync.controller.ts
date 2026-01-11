import { NextFunction, Request, Response } from "express";
import { CommonService } from "../../services/common.services";
import { ContactSync } from "../../modals/contactSync.model";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";

const ContactSyncService = new CommonService(ContactSync);

export class ContactSyncController {
  static async getAllContactSyncs(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userData",
          },
        },
        {
          $unwind: { path: "$userData", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            recordId: 1,
            phones: 1,
            syncedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            userId: "$userData._id",
            userName: "$userData.name",
            userMobile: "$userData.mobile",
            userEmail: "$userData.email",
          },
        },
      ];

      const result = await ContactSyncService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getContactSyncById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContactSyncService.getById(req.params.id, {
        path: "user",
        select: "name mobile email",
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Data fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteContactSyncById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const result = await ContactSyncService.deleteById(req.params.id);
      if (!result) {
        return res
          .status(404)
          .json(new ApiError(404, "Contact not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (error) {
      next(error);
    }
  }
}
