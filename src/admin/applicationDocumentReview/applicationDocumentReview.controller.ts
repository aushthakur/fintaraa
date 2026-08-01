import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  ApplicationDocumentReview,
  ApplicationDocumentReviewCustomerModel,
  ApplicationDocumentReviewStatus,
} from "../../modals/applicationDocumentReview.model";
import { DocumentRequest } from "../../modals/documentRequest.model";
import { UserType } from "../../modals/notification.model";
import { sendSingleNotification } from "../../services/notification.service";
import {
  backfillApplicationDocumentReviews,
  normalizeApplicationDocumentReviewRole,
} from "../../services/applicationDocumentReview.service";
import { notifyLoanDocumentReuploadRequested } from "../../services/loanCustomerNotification.service";

const positiveInteger = (value: unknown, fallback: number, maximum: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(Math.floor(number), maximum)
    : fallback;
};

export class ApplicationDocumentReviewController {
  static async getMine(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const customer = req.user?._id;
      const customerRole = normalizeApplicationDocumentReviewRole(
        req.user?.role,
      );
      if (!customer) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!customerRole) {
        return res
          .status(403)
          .json(new ApiError(403, "Document reviews are not available for this role"));
      }
      await backfillApplicationDocumentReviews();
      const items = await ApplicationDocumentReview.find({
        customer,
        ...(customerRole === UserType.USER
          ? {
              $or: [
                { customerRole },
                { customerRole: { $exists: false } },
              ],
            }
          : { customerRole }),
      })
        .populate("application", "loanId loanType status")
        .sort({ uploadedAt: -1, _id: -1 })
        .lean();
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            items,
            "Customer document review status fetched",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      await backfillApplicationDocumentReviews();
      const page = positiveInteger(req.query.page, 1, 100_000);
      const limit = positiveInteger(req.query.limit, 25, 100);
      const status = String(req.query.status || "").trim();
      const applicationId = String(req.query.applicationId || "").trim();
      const query: Record<string, unknown> = {};
      if (
        Object.values(ApplicationDocumentReviewStatus).includes(
          status as ApplicationDocumentReviewStatus,
        )
      ) {
        query.status = status;
      }
      if (applicationId) {
        if (!Types.ObjectId.isValid(applicationId)) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid application id"));
        }
        query.application = new Types.ObjectId(applicationId);
      }
      const [items, total] = await Promise.all([
        ApplicationDocumentReview.find(query)
          .populate("application", "loanId loanType status")
          .populate(
            "customer",
            "name mobile email customerId agencyId role",
          )
          .populate("reviewedBy", "name username email")
          .sort({ uploadedAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        ApplicationDocumentReview.countDocuments(query),
      ]);
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            items,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.max(1, Math.ceil(total / limit)),
            },
          },
          "Application document review queue fetched",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async review(
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) {
    try {
      await backfillApplicationDocumentReviews();
      const action = String(req.body?.action || "").trim();
      const note = String(req.body?.note || "").trim().slice(0, 1000);
      const statusByAction: Record<string, ApplicationDocumentReviewStatus> = {
        approve: ApplicationDocumentReviewStatus.APPROVED,
        reject: ApplicationDocumentReviewStatus.REJECTED,
        request_reupload: ApplicationDocumentReviewStatus.REUPLOAD_REQUESTED,
      };
      const status = statusByAction[action];
      if (!status) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Action must be approve, reject, or request_reupload",
            ),
          );
      }
      if (action !== "approve" && !note) {
        return res
          .status(400)
          .json(new ApiError(400, "A reason or re-upload note is required"));
      }
      const review = await ApplicationDocumentReview.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status,
            reviewNote: note,
            reviewedAt: new Date(),
            reviewedBy: req.user?._id,
          },
        },
        { new: true, runValidators: true },
      )
        .populate("application", "loanId loanType")
        .populate("customer", "name mobile email customerId agencyId role");
      if (!review) {
        return res
          .status(404)
          .json(new ApiError(404, "Document review record not found"));
      }
      const application: any = review.application;
      const customer: any = review.customer;
      const customerRole =
        normalizeApplicationDocumentReviewRole(review.customerRole) ||
        normalizeApplicationDocumentReviewRole(customer?.role) ||
        (review.customerModel === ApplicationDocumentReviewCustomerModel.AGENCY
          ? UserType.AGENCY
          : UserType.USER);
      const notificationRole =
        customerRole === UserType.AGENCY_MEMBER
          ? UserType.AGENCY_MEMBER
          : customerRole === UserType.AGENCY
            ? UserType.AGENCY
            : UserType.USER;
      if (action === "request_reupload") {
        await DocumentRequest.create({
          targetUser: customer?._id || review.customer,
          targetRole: customerRole,
          requestedDocuments: [review.documentKey],
          loanQuery: application?._id || review.application,
          sourceReview: review._id,
          message: note,
          requestedBy: req.user?._id,
        });
      }
      const notificationType =
        action === "approve"
          ? "loan-document-approved"
          : action === "reject"
            ? "loan-document-rejected"
            : "loan-document-reupload-requested";
      await sendSingleNotification({
        type: notificationType,
        toUserId: String(customer?._id || review.customer),
        toRole: notificationRole,
        context: {
          document: review.documentKey,
          loanId: application?.loanId || String(review.application),
          note,
          url:
            customerRole === UserType.USER
              ? "/account/profile/my-applications"
              : "/partner/profile",
        },
        fromUser: req.user?._id
          ? { _id: String(req.user._id), role: UserType.ADMIN }
          : undefined,
      }).catch((error) =>
        console.log("Failed to send document review notification:", error),
      );
      if (action === "request_reupload") {
        await notifyLoanDocumentReuploadRequested(
          application?._id || review.application,
          review.documentKey,
          note,
          `review:${review._id.toString()}:${review.reviewedAt?.getTime?.() || Date.now()}`,
        ).catch((error) =>
          console.log(
            "Failed to queue document re-upload communications:",
            error?.message || error,
          ),
        );
      }
      return res
        .status(200)
        .json(new ApiResponse(200, review, "Document review updated"));
    } catch (error) {
      next(error);
    }
  }
}
