import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import {
  DocumentRequest,
  DocumentRequestTargetRole,
} from "../../modals/documentRequest.model";
import { UserType } from "../../modals/notification.model";
import { User } from "../../modals/user.model";
import { Agency } from "../../modals/agency.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { sendSingleNotification } from "../../services/notification.service";
import { syncApplicationDocumentReviewUpload } from "../../services/applicationDocumentReview.service";
import { notifyLoanDocumentReuploadRequested } from "../../services/loanCustomerNotification.service";
import {
  isDocumentRequestFulfilled,
  mergeUploadedDocumentEvidence,
  normalizeRequestedDocuments,
  resolveRequestedDocument,
  validateDocumentFileUrl,
} from "../../services/documentRequest.service";

const targetRoles = new Set<DocumentRequestTargetRole>([
  "user",
  "agency",
  "agency_member",
]);

const normalizeTargetRole = (
  value: unknown,
): DocumentRequestTargetRole | null => {
  const role = String(value || "").trim().toLowerCase();
  return targetRoles.has(role as DocumentRequestTargetRole)
    ? (role as DocumentRequestTargetRole)
    : null;
};

const safeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findTarget = async (
  targetUser: string,
  targetRole: DocumentRequestTargetRole,
) => {
  if (targetRole === "user") {
    return User.findOne({
      _id: targetUser,
      role: "user",
      isDeleted: { $ne: true },
    })
      .select("_id name email mobile customerId role")
      .lean();
  }
  return Agency.findOne({
    _id: targetUser,
    role: targetRole,
  })
    .select("_id name email mobile agencyId role")
    .lean();
};

const targetSummary = (target: any, role: DocumentRequestTargetRole) => ({
  targetName: target?.name || "-",
  targetEmail: target?.email || "-",
  targetMobile: target?.mobile || "-",
  targetDisplayId:
    role === "user" ? target?.customerId || "-" : target?.agencyId || "-",
});

const ownsUploadedDocument = async (
  targetUser: string,
  targetRole: DocumentRequestTargetRole,
  fileUrl: string,
) => {
  const projection = "digiLockerVault.documents.fileUrl kycProfile.documents.fileUrl";
  const owner =
    targetRole === "user"
      ? await User.findOne({ _id: targetUser, role: "user" })
          .select(projection)
          .lean()
      : await Agency.findOne({ _id: targetUser, role: targetRole })
          .select(projection)
          .lean();
  const documents = [
    ...(((owner as any)?.digiLockerVault?.documents || []) as any[]),
    ...(((owner as any)?.kycProfile?.documents || []) as any[]),
  ];
  return documents.some(
    (document) => validateDocumentFileUrl(document?.fileUrl) === fileUrl,
  );
};

export class DocumentRequestController {
  static async getMine(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const targetUser = req.user?._id;
      const targetRole = normalizeTargetRole(req.user?.role);
      if (!targetUser) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!targetRole) {
        return res
          .status(403)
          .json(new ApiError(403, "Document requests are not available for this role"));
      }
      const rows = await DocumentRequest.find({
        targetUser,
        targetRole,
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
      const targetRole = normalizeTargetRole(req.user?.role);
      if (!targetRole) {
        return res
          .status(403)
          .json(new ApiError(403, "Document requests are not available for this role"));
      }
      const record = await DocumentRequest.findOne({
        _id: req.params.id,
        targetUser: req.user?._id,
        targetRole,
        status: "pending",
      });
      if (!record) {
        return res
          .status(404)
          .json(new ApiError(404, "Pending document request not found"));
      }

      const fileUrl = validateDocumentFileUrl(req.body?.fileUrl);
      if (!fileUrl) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "A valid uploaded document URL is required",
            ),
          );
      }
      if (
        !(await ownsUploadedDocument(
          String(req.user?._id),
          targetRole,
          fileUrl,
        ))
      ) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Upload the file to your secure document vault before completing this request",
            ),
          );
      }
      const requestedDocument = resolveRequestedDocument(
        record.requestedDocuments,
        req.body?.documentKey,
      );
      if (!requestedDocument) {
        return res
          .status(400)
          .json(new ApiError(400, "Document does not match this request"));
      }
      if (record.loanQuery && fileUrl && requestedDocument) {
        const review = await syncApplicationDocumentReviewUpload({
          applicationId: record.loanQuery,
          customerId: record.targetUser,
          customerRole: targetRole,
          documentKey: requestedDocument,
          fileUrl,
          notify: true,
        });
        if (!review) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Uploaded document could not be linked to the application",
              ),
            );
        }
      }

      const uploadedDocuments = mergeUploadedDocumentEvidence(
        record.uploadedDocuments?.map((item: any) =>
          item?.toObject ? item.toObject() : item,
        ),
        {
          documentKey: requestedDocument,
          fileUrl,
          uploadedAt: new Date(),
        },
      );
      record.set("uploadedDocuments", uploadedDocuments);
      const fulfilled = isDocumentRequestFulfilled(
        record.requestedDocuments,
        uploadedDocuments,
      );
      record.status = fulfilled ? "uploaded" : "pending";
      record.fulfilledAt = fulfilled ? new Date() : undefined;
      await record.save();
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            record,
            fulfilled
              ? "Document request completed"
              : "Document uploaded; more requested documents are pending",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request & { user?: any }, res: Response, next: NextFunction) {
    try {
      const targetUser = String(req.body?.targetUser || "").trim();
      const targetRole = normalizeTargetRole(
        req.body?.targetRole || UserType.USER,
      );
      const requestedDocuments = normalizeRequestedDocuments(
        req.body?.requestedDocuments,
      );

      if (!targetUser || !Types.ObjectId.isValid(targetUser)) {
        return res.status(400).json(new ApiError(400, "Target user is required"));
      }
      if (!targetRole) {
        return res.status(400).json(new ApiError(400, "Invalid target role"));
      }
      if (!requestedDocuments.length) {
        return res
          .status(400)
          .json(new ApiError(400, "At least one document is required"));
      }
      const target = await findTarget(targetUser, targetRole);
      if (!target) {
        return res
          .status(404)
          .json(new ApiError(404, "Selected customer or partner was not found"));
      }

      const loanQueryId = String(req.body?.loanQuery || "").trim();
      if (loanQueryId) {
        if (!Types.ObjectId.isValid(loanQueryId)) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid loan query ID"));
        }
        const linkedLoan = await LoanQuery.exists({
          _id: loanQueryId,
          ...(targetRole === UserType.USER
            ? { customerId: targetUser }
            : {
                $or: [
                  { customerId: targetUser },
                  { channelAgency: targetUser },
                  { ownerAgency: targetUser },
                ],
              }),
        });
        if (!linkedLoan) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Loan query does not belong to the selected customer or partner",
              ),
            );
        }
      }

      const record = await DocumentRequest.create({
        targetUser,
        targetRole,
        requestedDocuments,
        loanQuery: loanQueryId || undefined,
        message: String(req.body?.message || "").trim().slice(0, 1000) || undefined,
        requestedBy: req.user?._id,
      });

      await sendSingleNotification({
        type: "documents-requested",
        toUserId: String(targetUser),
        toRole: targetRole as UserType,
        context: {
          documents: requestedDocuments.join(", "),
          loanId: req.body?.loanId || "",
          name: req.body?.name || "",
          url:
            targetRole === "user"
              ? "/account/profile/uploaded-documents"
              : "/partner/profile",
        },
        fromUser: req.user?._id
          ? { _id: String(req.user._id), role: UserType.ADMIN }
          : undefined,
      }).catch((error) =>
        console.log("Failed to send document request notification:", error),
      );
      if (record.loanQuery) {
        await notifyLoanDocumentReuploadRequested(
          record.loanQuery,
          requestedDocuments.join(", "),
          record.message,
          `request:${record._id.toString()}`,
        ).catch((error) =>
          console.log(
            "Failed to queue document request communications:",
            error?.message || error,
          ),
        );
      }

      return res
        .status(201)
        .json(new ApiResponse(201, record, "Document request created"));
    } catch (error) {
      next(error);
    }
  }

  static async searchTargets(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const targetRole = normalizeTargetRole(req.query.role || "user");
      if (!targetRole) {
        return res.status(400).json(new ApiError(400, "Invalid target role"));
      }
      const q = String(req.query.q || "").trim().slice(0, 120);
      const search = q ? new RegExp(safeRegex(q), "i") : null;
      const commonSearch = search
        ? [{ name: search }, { email: search }, { mobile: search }]
        : [];
      const rows =
        targetRole === "user"
          ? await User.find({
              role: "user",
              isDeleted: { $ne: true },
              ...(search
                ? {
                    $or: [
                      ...commonSearch,
                      { customerId: search },
                      { panCard: search },
                    ],
                  }
                : {}),
            })
              .select("_id name email mobile customerId role")
              .sort({ updatedAt: -1 })
              .limit(20)
              .lean()
          : await Agency.find({
              role: targetRole,
              ...(search
                ? { $or: [...commonSearch, { agencyId: search }] }
                : {}),
            })
              .select("_id name email mobile agencyId role")
              .sort({ updatedAt: -1 })
              .limit(20)
              .lean();

      return res.status(200).json(
        new ApiResponse(
          200,
          rows.map((row: any) => ({
            _id: row._id,
            name: row.name || "Unnamed account",
            email: row.email || "",
            mobile: row.mobile || "",
            displayId:
              targetRole === "user" ? row.customerId || "" : row.agencyId || "",
            role: targetRole,
          })),
          "Document request targets fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 20, 1);
      const status = String(req.query.status || "").trim();
      const targetRole = normalizeTargetRole(req.query.targetRole);
      const query: Record<string, any> = {};
      if (status && status !== "all") query.status = status;
      if (targetRole) query.targetRole = targetRole;

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

      const userTargetIds = rows
        .filter((row: any) => row.targetRole === "user")
        .map((row: any) => row.targetUser);
      const agencyTargetIds = rows
        .filter((row: any) => row.targetRole !== "user")
        .map((row: any) => row.targetUser);
      const [users, agencies] = await Promise.all([
        User.find({ _id: { $in: userTargetIds } })
          .select("_id name email mobile customerId")
          .lean(),
        Agency.find({ _id: { $in: agencyTargetIds } })
          .select("_id name email mobile agencyId role")
          .lean(),
      ]);
      const targets = new Map(
        [...users, ...agencies].map((target: any) => [
          String(target._id),
          target,
        ]),
      );

      const result = rows.map((row: any) => {
        const target = targets.get(String(row.targetUser));
        return {
          ...row,
          ...targetSummary(target, row.targetRole),
          requestedDocumentsText: (row.requestedDocuments || []).join(", "),
          uploadedDocumentsText: (row.uploadedDocuments || [])
            .map((item: any) => item.documentKey)
            .join(", "),
          loanId: row.loanQuery?.loanId || "-",
          loanType: row.loanQuery?.loanType || "-",
          requestedByName:
            row.requestedBy?.name ||
            row.requestedBy?.username ||
            row.requestedBy?.email ||
            "-",
        };
      });

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
