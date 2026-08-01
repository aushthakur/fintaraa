import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import {
  Grievance,
  GrievanceCommentAuthor,
  GrievanceNature,
  GrievanceStatus,
  type IGrievance,
} from "../../modals/grievance.model";
import { allocatePrefixedSequence } from "../../utils/idAllocator";
import {
  DEFAULT_QUERY_TIMEZONE,
  parseDateInTimeZone,
} from "../../utils/helper";
import {
  queueGrievanceCommentNotification,
  queueGrievanceCreatedNotifications,
  queueGrievanceStatusNotification,
} from "../../services/grievanceNotification.service";

const nameRegex = /^[A-Za-z][A-Za-z\s.'-]{1,99}$/;
const mobileRegex = /^[6-9]\d{9}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const applicationIdRegex = /^[A-Za-z0-9][A-Za-z0-9_./-]{2,99}$/;

const clean = (value: unknown, max = 240) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const cleanMultiline = (value: unknown, max = 5000) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);

const normaliseMobile = (value: unknown) =>
  clean(value, 30)
    .replace(/\D/g, "")
    .replace(/^91(?=\d{10}$)/, "")
    .slice(-10);

const dateKeyInIndia = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}${value("month")}${value("day")}`;
};

export const addBusinessDays = (date: Date, businessDays: number) => {
  const due = new Date(date);
  let added = 0;
  while (added < businessDays) {
    due.setUTCDate(due.getUTCDate() + 1);
    const day = due.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return due;
};

const businessDaysBetween = (from: Date, to: Date) => {
  const cursor = new Date(from);
  let days = 0;
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && cursor <= to) days += 1;
  }
  return days;
};

const isOverdue = (grievance: {
  status: GrievanceStatus;
  slaDueAt: Date;
}) =>
  grievance.status !== GrievanceStatus.RESOLVED &&
  new Date(grievance.slaDueAt).getTime() < Date.now();

const safeGrievance = (grievance: any, customerView = false) => {
  const item = grievance?.toObject ? grievance.toObject() : grievance;
  const end = item.resolvedAt ? new Date(item.resolvedAt) : new Date();
  const common = {
    _id: item._id,
    ticketNumber: item.ticketNumber,
    fullName: item.fullName,
    mobile: customerView ? undefined : item.mobile,
    email: customerView ? undefined : item.email,
    applicationId: item.applicationId,
    nature: item.nature,
    description: item.description,
    status: item.status,
    resolutionNote: item.resolutionNote,
    comments: (item.comments || [])
      .filter((comment: any) => !customerView || comment.visibleToUser)
      .map((comment: any) => ({
        _id: comment._id,
        authorType: comment.authorType,
        message: comment.message,
        visibleToUser: comment.visibleToUser,
        createdAt: comment.createdAt,
      })),
    statusHistory: (item.statusHistory || []).map((entry: any) => ({
      _id: entry._id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
    slaDueAt: item.slaDueAt,
    isOverdue: isOverdue(item),
    businessDaysOpen: businessDaysBetween(new Date(item.createdAt), end),
    resolvedAt: item.resolvedAt,
    escalatedAt: item.escalatedAt,
    lastAdminResponseAt: item.lastAdminResponseAt,
    source: item.source,
    sourcePage: item.sourcePage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  return common;
};

const createPayload = (req: Request | any) => {
  const fullName = clean(req.body?.fullName, 100);
  const mobile = normaliseMobile(req.body?.mobile);
  const email = clean(req.body?.email, 254).toLowerCase();
  const applicationId = clean(req.body?.applicationId, 100);
  const nature = clean(req.body?.nature, 80) as GrievanceNature;
  const description = cleanMultiline(req.body?.description, 5000);

  if (!nameRegex.test(fullName)) {
    throw new ApiError(400, "Please enter a valid full name.");
  }
  if (!mobileRegex.test(mobile)) {
    throw new ApiError(400, "Please enter a valid 10-digit mobile number.");
  }
  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Please enter a valid email address.");
  }
  if (
    applicationId &&
    !applicationIdRegex.test(applicationId)
  ) {
    throw new ApiError(400, "Application ID contains invalid characters.");
  }
  if (!Object.values(GrievanceNature).includes(nature)) {
    throw new ApiError(400, "Please select the nature of your grievance.");
  }
  if (description.length < 20) {
    throw new ApiError(
      400,
      "Please describe your grievance in at least 20 characters.",
    );
  }
  const ip = clean(
    req.get("cf-connecting-ip") ||
      req.get("x-real-ip") ||
      String(req.get("x-forwarded-for") || "").split(",")[0] ||
      req.socket.remoteAddress,
    100,
  );
  return {
    fullName,
    mobile,
    email,
    applicationId: applicationId || undefined,
    nature,
    description,
    user: req.user?._id,
    source: clean(req.body?.source, 100) || "website",
    sourcePage: clean(req.body?.sourcePage, 500) || "/grievance",
    createdByIpHash: ip
      ? crypto
          .createHash("sha256")
          .update(`${process.env.JWT_SECRET || "fintaraa"}:${ip}`)
          .digest("hex")
          .slice(0, 24)
      : undefined,
    userAgent: clean(req.get("user-agent"), 500),
  };
};

const queueSafely = (
  label: string,
  operation: Promise<unknown>,
) =>
  operation.catch((error) => {
    console.error(
      `[GrievanceNotification] ${label} could not be queued:`,
      error?.message || error,
    );
  });

const dateMatch = (startDate: unknown, endDate: unknown) => {
  const createdAt: Record<string, Date> = {};
  if (typeof startDate === "string" && startDate) {
    const start = parseDateInTimeZone(
      startDate,
      "start",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (start) createdAt.$gte = start;
  }
  if (typeof endDate === "string" && endDate) {
    const end = parseDateInTimeZone(
      endDate,
      "end",
      DEFAULT_QUERY_TIMEZONE,
    );
    if (end) createdAt.$lte = end;
  }
  return Object.keys(createdAt).length ? { createdAt } : {};
};

const findAdminGrievance = async (id: string) => {
  const match = Types.ObjectId.isValid(id)
    ? { _id: new Types.ObjectId(id) }
    : { ticketNumber: clean(id, 40).toUpperCase() };
  return Grievance.findOne(match);
};

export class GrievanceController {
  static async create(req: Request | any, res: Response, next: NextFunction) {
    try {
      const now = new Date();
      const dateKey = dateKeyInIndia(now);
      const ticketNumber = await allocatePrefixedSequence({
        key: `grievance:${dateKey}`,
        prefix: `GRV-${dateKey}-`,
        padLength: 4,
      });
      const payload = createPayload(req);
      const grievance = await Grievance.create({
        ...payload,
        ticketNumber,
        status: GrievanceStatus.OPEN,
        slaDueAt: addBusinessDays(now, 7),
        statusHistory: [
          {
            toStatus: GrievanceStatus.OPEN,
            note: "Grievance submitted",
            createdAt: now,
          },
        ],
      });
      await queueSafely(
        "creation emails",
        queueGrievanceCreatedNotifications(grievance),
      );
      return res.status(201).json(
        new ApiResponse(
          201,
          {
            ticketNumber: grievance.ticketNumber,
            status: grievance.status,
            slaDueAt: grievance.slaDueAt,
          },
          "Grievance submitted successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async track(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketNumber = clean(req.body?.ticketNumber, 40).toUpperCase();
      const credential = clean(req.body?.credential, 254).toLowerCase();
      if (!ticketNumber || !credential) {
        throw new ApiError(
          400,
          "Ticket number and registered mobile or email are required.",
        );
      }
      const credentialMobile = normaliseMobile(credential);
      const grievance = await Grievance.findOne({
        ticketNumber,
        $or: [
          { email: credential },
          ...(mobileRegex.test(credentialMobile)
            ? [{ mobile: credentialMobile }]
            : []),
        ],
      }).lean();
      if (!grievance) {
        return res
          .status(404)
          .json(
            new ApiError(
              404,
              "No complaint matched these tracking details.",
            ),
          );
      }
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            safeGrievance(grievance, true),
            "Grievance fetched",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async adminList(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const match: Record<string, any> = {
        ...dateMatch(req.query.startDate, req.query.endDate),
      };
      const status = clean(req.query.status, 60) as GrievanceStatus;
      const nature = clean(req.query.nature, 80) as GrievanceNature;
      const search = clean(req.query.search, 180);
      const overdue = clean(req.query.overdue, 10);
      const ticket = clean(req.query.ticket, 40).toUpperCase();
      if (Object.values(GrievanceStatus).includes(status)) match.status = status;
      if (Object.values(GrievanceNature).includes(nature)) match.nature = nature;
      if (overdue === "true") {
        match.status = { $ne: GrievanceStatus.RESOLVED };
        match.slaDueAt = { $lt: new Date() };
      }
      if (ticket) match.ticketNumber = ticket;
      if (search) {
        match.$or = [
          { ticketNumber: { $regex: search, $options: "i" } },
          { fullName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
          { applicationId: { $regex: search, $options: "i" } },
        ];
      }
      const openMatch = { status: GrievanceStatus.OPEN };
      const inProgressMatch = { status: GrievanceStatus.IN_PROGRESS };
      const escalatedMatch = { status: GrievanceStatus.ESCALATED };
      const resolvedMatch = { status: GrievanceStatus.RESOLVED };
      const overdueMatch = {
        status: { $ne: GrievanceStatus.RESOLVED },
        slaDueAt: { $lt: new Date() },
      };
      const [
        rows,
        total,
        open,
        inProgress,
        escalated,
        resolved,
        overdueCount,
      ] = await Promise.all([
        Grievance.find(match)
          .sort({ slaDueAt: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Grievance.countDocuments(match),
        Grievance.countDocuments(openMatch),
        Grievance.countDocuments(inProgressMatch),
        Grievance.countDocuments(escalatedMatch),
        Grievance.countDocuments(resolvedMatch),
        Grievance.countDocuments(overdueMatch),
      ]);
      return res.status(200).json(
        new ApiResponse(200, {
          items: rows.map((row) => safeGrievance(row)),
          summary: {
            total: open + inProgress + escalated + resolved,
            open,
            inProgress,
            escalated,
            resolved,
            overdue: overdueCount,
          },
          pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  static async adminGet(req: Request, res: Response, next: NextFunction) {
    try {
      const grievance = await findAdminGrievance(req.params.id);
      if (!grievance) {
        return res
          .status(404)
          .json(new ApiError(404, "Grievance not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, safeGrievance(grievance)));
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const grievance = await findAdminGrievance(req.params.id);
      if (!grievance) {
        return res
          .status(404)
          .json(new ApiError(404, "Grievance not found"));
      }
      const nextStatus = clean(req.body?.status, 60) as GrievanceStatus;
      if (!Object.values(GrievanceStatus).includes(nextStatus)) {
        throw new ApiError(400, "Invalid grievance status.");
      }
      const suppliedResolution = cleanMultiline(
        req.body?.resolutionNote,
        4000,
      );
      const nextResolution =
        suppliedResolution || grievance.resolutionNote || "";
      if (
        nextStatus === GrievanceStatus.RESOLVED &&
        nextResolution.length < 10
      ) {
        throw new ApiError(
          400,
          "Add a resolution note of at least 10 characters before resolving.",
        );
      }
      const statusChanged = grievance.status !== nextStatus;
      const resolutionChanged =
        suppliedResolution &&
        suppliedResolution !== String(grievance.resolutionNote || "");
      if (!statusChanged && !resolutionChanged) {
        throw new ApiError(400, "No grievance update was provided.");
      }
      const previousStatus = grievance.status;
      grievance.status = nextStatus;
      if (suppliedResolution) grievance.resolutionNote = suppliedResolution;
      if (nextStatus === GrievanceStatus.RESOLVED) {
        grievance.resolvedAt = new Date();
      } else if (previousStatus === GrievanceStatus.RESOLVED) {
        grievance.resolvedAt = undefined;
      }
      if (
        nextStatus === GrievanceStatus.ESCALATED &&
        previousStatus !== GrievanceStatus.ESCALATED
      ) {
        grievance.escalatedAt = new Date();
      }
      grievance.lastAdminResponseAt = new Date();
      grievance.statusHistory.push({
        fromStatus: previousStatus,
        toStatus: nextStatus,
        note: suppliedResolution || undefined,
        changedBy: req.user?._id,
        createdAt: new Date(),
      });
      await grievance.save();
      const history = grievance.statusHistory.at(-1);
      await queueSafely(
        "status notification",
        queueGrievanceStatusNotification({
          grievance,
          eventKey: String(history?._id || grievance.updatedAt.getTime()),
        }),
      );
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            safeGrievance(grievance),
            "Grievance status updated",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async addAdminComment(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const grievance = await findAdminGrievance(req.params.id);
      if (!grievance) {
        return res
          .status(404)
          .json(new ApiError(404, "Grievance not found"));
      }
      const message = cleanMultiline(req.body?.message, 4000);
      if (message.length < 3) {
        throw new ApiError(400, "Comment must contain at least 3 characters.");
      }
      grievance.comments.push({
        authorType: GrievanceCommentAuthor.ADMIN,
        author: req.user?._id,
        message,
        visibleToUser: true,
        createdAt: new Date(),
      });
      grievance.lastAdminResponseAt = new Date();
      await grievance.save();
      const comment = grievance.comments.at(-1)!;
      await queueSafely(
        "comment email",
        queueGrievanceCommentNotification({ grievance, comment }),
      );
      return res.status(201).json(
        new ApiResponse(
          201,
          safeGrievance(grievance),
          "Comment added and customer email queued",
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
