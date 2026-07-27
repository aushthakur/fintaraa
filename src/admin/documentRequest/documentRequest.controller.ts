import { NextFunction, Request, Response } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { DocumentRequest } from "../../modals/documentRequest.model";
import { UserType } from "../../modals/notification.model";
import { sendSingleNotification } from "../../services/notification.service";

export class DocumentRequestController {
  static async getMine(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const targetUser = req.user?._id;
      if (!targetUser) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const rows = await DocumentRequest.find({
        targetUser,
        status: { $ne: "cancelled" },
      })
        .sort({ status: 1, createdAt: -1 })
        .populate("loanQuery", "loanId loanType status")
        .lean();
      return res
        .status(200)
        .json(new ApiResponse(200, rows, "Document requests fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async markUploaded(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const record = await DocumentRequest.findOneAndUpdate(
        {
          _id: req.params.id,
          targetUser: req.user?._id,
          status: "pending",
        },
        {
          $set: {
            status: "uploaded",
            fulfilledAt: new Date(),
          },
        },
        { new: true },
      );
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Pending document request not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, record, "Document request completed"));
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const targetUser = req.body?.targetUser;
      const targetRole = req.body?.targetRole || UserType.USER;
      const requestedDocuments = Array.isArray(req.body?.requestedDocuments)
        ? req.body.requestedDocuments
        : String(req.body?.requestedDocuments || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

      if (!targetUser) {
        return res.status(400).json(new ApiError(400, "Target user is required"));
      }
      if (!requestedDocuments.length) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one document is required"));
      }

      const record = await DocumentRequest.create({
        targetUser,
        targetRole,
        requestedDocuments,
        loanQuery: req.body?.loanQuery || undefined,
        message: req.body?.message,
        requestedBy: req.user?._id,
      });

      await sendSingleNotification({
        type: "documents-requested",
        toUserId: String(targetUser),
        toRole: targetRole,
        context: {
          documents: requestedDocuments.join(", "),
          loanId: req.body?.loanId || "",
          name: req.body?.name || "",
        },
        fromUser: req.user?._id
          ? { _id: String(req.user._id), role: UserType.ADMIN }
          : undefined,
      }).catch((error) =>
        console.log("Failed to send document request notification:", error),
      );

      return res
        .status(201)
        .json(new ApiResponse(201, record, "Document request created"));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const status = String(req.query.status || "").trim();
      const query: Record<string, any> = {};
      if (status && status !== "all") query.status = status;

      const skip = (page - 1) * limit;
      const [rows, totalItems] = await Promise.all([
        DocumentRequest.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("loanQuery", "loanId loanType status")
          .populate("requestedBy", "name username email")
          .lean(),
        DocumentRequest.countDocuments(query),
      ]);

      const result = rows.map((row: any) => ({
        ...row,
        requestedDocumentsText: (row.requestedDocuments || []).join(", "),
        loanId: row.loanQuery?.loanId || "-",
        loanType: row.loanQuery?.loanType || "-",
        requestedByName:
          row.requestedBy?.name || row.requestedBy?.username || row.requestedBy?.email || "-",
      }));

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            result,
            pagination: {
              totalPages: Math.max(Math.ceil(totalItems / limit), 1),
              totalItems,
              currentPage: page,
              itemsPerPage: limit,
            },
          },
          "Document requests fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
