import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import {
  KycVerificationStatus,
  RegistrationSource,
  User,
  UserStatus,
} from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { InsuranceQuery } from "../../modals/insurancequery.model";
import { Notification, UserType } from "../../modals/notification.model";
import { CustomerActivity } from "../../modals/customerActivity.model";
import { sendSingleNotification } from "../../services/notification.service";
import ApiError from "../../utils/ApiError";
import {
  getLoanTypeDisplayLabel,
  normalizeLoanType,
} from "../../utils/loanType";

const safeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPositiveInt = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const normalizeRegistrationSource = (user: any) => {
  const explicit = String(user?.registrationSource || "").trim();
  if (explicit && explicit !== RegistrationSource.UNKNOWN) return explicit;
  if (user?.referredBy) return RegistrationSource.REFERRAL;
  const accountSource = String(user?.accountSource || "").trim();
  if (accountSource === "app") return RegistrationSource.APP;
  if (accountSource === "website") return RegistrationSource.WEBSITE;
  if (accountSource === "admin") return RegistrationSource.ADMIN;
  if (accountSource === "crm") return RegistrationSource.CRM;
  return RegistrationSource.UNKNOWN;
};

const resolveCity = (user: any) =>
  user?.kycProfile?.personalDetails?.city ||
  user?.addresses?.find((address: any) => address?.isDefault)?.city ||
  user?.addresses?.[0]?.city ||
  "";

const addAndCondition = (
  match: Record<string, any>,
  condition: Record<string, any>,
) => {
  match.$and = Array.isArray(match.$and) ? match.$and : [];
  match.$and.push(condition);
};

const buildCustomerMatch = (query: Record<string, any>) => {
  const includeDeleted = String(query.includeDeleted || "") === "true";
  const match: Record<string, any> = {
    role: "user",
    ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
  };

  const status = String(query.status || "").trim().toLowerCase();
  if (status && status !== "all") match.status = status;

  const source = String(
    query.registrationSource || query.source || "",
  ).trim().toLowerCase();
  if (source && source !== "all") {
    if (source === RegistrationSource.REFERRAL) {
      addAndCondition(match, {
        $or: [
          { registrationSource: RegistrationSource.REFERRAL },
          { referredBy: { $exists: true, $ne: null } },
        ],
      });
    } else if (
      [RegistrationSource.APP, RegistrationSource.WEBSITE].includes(
        source as RegistrationSource,
      )
    ) {
      addAndCondition(match, {
        $or: [
          { registrationSource: source },
          {
            registrationSource: {
              $in: [RegistrationSource.UNKNOWN, null, ""],
            },
            accountSource: source,
          },
          {
            registrationSource: { $exists: false },
            accountSource: source,
          },
        ],
      });
    } else {
      if (source === RegistrationSource.UNKNOWN) {
        addAndCondition(match, {
          $or: [
            { registrationSource: RegistrationSource.UNKNOWN },
            { registrationSource: { $exists: false } },
            { registrationSource: null },
            { registrationSource: "" },
          ],
        });
      } else {
        match.registrationSource = source;
      }
    }
  }

  const city = String(query.city || "").trim();
  if (city) {
    const cityRegex = new RegExp(safeRegex(city), "i");
    addAndCondition(match, {
      $or: [
        { "addresses.city": cityRegex },
        { "kycProfile.personalDetails.city": cityRegex },
      ],
    });
  }

  const search = String(query.q || query.search || "").trim();
  if (search) {
    const searchRegex = new RegExp(safeRegex(search), "i");
    addAndCondition(match, {
      $or: [
        { name: searchRegex },
        { mobile: searchRegex },
        { email: searchRegex },
        { customerId: searchRegex },
        { panCard: searchRegex },
        { "kycProfile.personalDetails.panNumber": searchRegex },
        { "kycProfile.personalDetails.city": searchRegex },
        { "addresses.city": searchRegex },
      ],
    });
  }

  const startDate = query.startDate ? new Date(String(query.startDate)) : null;
  const endDate = query.endDate ? new Date(String(query.endDate)) : null;
  if (startDate && !Number.isNaN(startDate.getTime())) {
    startDate.setHours(0, 0, 0, 0);
    match.createdAt = { ...(match.createdAt || {}), $gte: startDate };
  }
  if (endDate && !Number.isNaN(endDate.getTime())) {
    endDate.setHours(23, 59, 59, 999);
    match.createdAt = { ...(match.createdAt || {}), $lte: endDate };
  }

  return match;
};

const customerListProjection = [
  "-password",
  "-refreshToken",
  "-fcmToken",
  "-fcmTokens",
  "-cibilReport",
  "-cibilRequestPayload",
  "-cibilPdfReport",
  "-experianReport",
  "-digiLockerVault.documents.password",
  "-kycProfile.documents.password",
].join(" ");

const toCustomerRow = (user: any) => ({
  ...user,
  city: resolveCity(user),
  registrationSource: normalizeRegistrationSource(user),
  referredByName: user?.referredBy?.name || "-",
  usedReferralCode: user?.referredBy?.referralCode || "-",
  referredBy: user?.referredBy?._id || user?.referredBy || null,
});

const logActivity = async (
  req: Request,
  customerId: string,
  action: string,
  description: string,
  metadata: Record<string, unknown> = {},
) => {
  const actor = (req as any).user || {};
  await CustomerActivity.create({
    customer: customerId,
    action,
    description,
    actor: Types.ObjectId.isValid(actor._id) ? actor._id : undefined,
    actorRole: actor.role,
    actorEmail: actor.email,
    metadata,
  });
};

const csvCell = (value: unknown) => {
  const normalized =
    value instanceof Date
      ? value.toISOString()
      : value === null || value === undefined
        ? ""
        : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

const getDocumentRows = (user: any) => {
  const rows: any[] = [];
  const seenUrls = new Set<string>();
  const addDocument = (document: any, source: string, index: number) => {
    if (!document) return;
    const fileUrl = String(document.fileUrl || "").trim();
    if (fileUrl && seenUrls.has(fileUrl)) return;
    if (fileUrl) seenUrls.add(fileUrl);
    rows.push({
      id: `${source}:${index}`,
      source,
      index,
      docType: document.docType || "document",
      number: document.number || "",
      issuer: document.issuer || "",
      fileUrl,
      issuedOn: document.issuedOn,
      verified: Boolean(document.verified),
      referenceId: document.referenceId || "",
      canVerify: source === "kyc" || source === "digilocker",
    });
  };

  (user?.kycProfile?.documents || []).forEach((doc: any, index: number) =>
    addDocument(doc, "kyc", index),
  );
  (user?.digiLockerVault?.documents || []).forEach(
    (doc: any, index: number) => addDocument(doc, "digilocker", index),
  );

  [
    {
      docType: "pan_card",
      number: user?.panCard,
      fileUrl: user?.panCardUrl,
      issuer: "profile",
    },
    {
      docType: "aadhaar_card",
      number: user?.aadhaarCard,
      fileUrl: user?.aadhaarCardUrl,
      issuer: "profile",
    },
    {
      docType: "bank_document",
      fileUrl: user?.cancelledChequeOrPassbook,
      issuer: "profile",
    },
  ].forEach((doc, index) => {
    if (doc.fileUrl) addDocument(doc, "profile", index);
  });

  return rows;
};

export class CustomerController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = toPositiveInt(req.query.page, 1, 100000);
      const limit = toPositiveInt(req.query.limit, 20, 200);
      const match = buildCustomerMatch(req.query as Record<string, any>);
      const allowedSortFields = new Set([
        "createdAt",
        "updatedAt",
        "name",
        "mobile",
        "cibilScore",
        "status",
        "customerId",
        "registrationSource",
        "accountSource",
      ]);
      const requestedSort = String(req.query.sortKey || "createdAt");
      const sortKey = allowedSortFields.has(requestedSort)
        ? requestedSort
        : "createdAt";
      const sortDirection =
        String(req.query.sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;

      const [users, totalItems] = await Promise.all([
        User.find(match)
          .select(customerListProjection)
          .populate("referredBy", "name referralCode customerId mobile")
          .sort({ [sortKey]: sortDirection, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        User.countDocuments(match),
      ]);

      return res.status(200).json({
        success: true,
        message: "Customers fetched successfully",
        data: {
          result: users.map(toCustomerRow),
          pagination: {
            totalItems,
            totalPages: Math.max(Math.ceil(totalItems / limit), 1),
            currentPage: page,
            itemsPerPage: limit,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const match = buildCustomerMatch(req.query as Record<string, any>);
      const users = await User.find(match)
        .select(customerListProjection)
        .populate("referredBy", "name referralCode")
        .sort({ createdAt: -1 })
        .limit(50000)
        .lean();
      const headers = [
        "Customer ID",
        "Name",
        "Email",
        "Mobile",
        "PAN",
        "City",
        "Status",
        "Registration Source",
        "Account Source",
        "CIBIL Score",
        "Referral Code",
        "Referred By",
        "Registered On",
      ];
      const lines = users.map((rawUser: any) => {
        const user = toCustomerRow(rawUser);
        return [
          user.customerId,
          user.name,
          user.email,
          user.mobile,
          user.panCard,
          user.city,
          user.status,
          user.registrationSource,
          user.accountSource,
          user.cibilScore,
          user.referralCode,
          user.referredByName,
          user.createdAt,
        ]
          .map(csvCell)
          .join(",");
      });
      const dateKey = new Date().toISOString().slice(0, 10);

      return res.status(200).json({
        success: true,
        message: "Customer CSV prepared",
        data: {
          filename: `fintaraa-customers-${dateKey}.csv`,
          csv: `\uFEFF${headers.map(csvCell).join(",")}\n${lines.join("\n")}`,
          exportedRows: users.length,
          capped: users.length === 50000,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async detail(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = req.params.id;
      if (!Types.ObjectId.isValid(customerId)) {
        throw new ApiError(400, "Invalid customer ID");
      }

      const user: any = await User.findOne({
        _id: customerId,
        role: "user",
      })
        .select(customerListProjection)
        .populate("referredBy", "name referralCode customerId mobile email")
        .lean();
      if (!user) throw new ApiError(404, "Customer not found");

      const [loans, insurance, adminActivities, notifications] =
        await Promise.all([
          LoanQuery.find({ customerId })
            .select(
              "loanId loanType policyDetails.productVariant policyDetails.metaFlowKey policyDetails.requestedProductName policyDetails.requestedProductSlug policyDetails.productLabel loanAmount disbursedAmount bankName status createdAt updatedAt activities",
            )
            .sort({ createdAt: -1 })
            .lean(),
          InsuranceQuery.find({ customerId })
            .select(
              "applicationId typeOfInsurance annualIncome policyDetails status createdAt updatedAt activities",
            )
            .sort({ createdAt: -1 })
            .lean(),
          CustomerActivity.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
          Notification.find({
            "to.user": customerId,
            "to.role": UserType.USER,
            status: { $ne: "deleted" },
          })
            .select("type title message status createdAt")
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
        ]);

      const applicationActivities = [
        ...loans.flatMap((application: any) =>
          (application.activities || []).map((activity: any) => ({
            id: `loan:${application._id}:${activity._id || activity.createdAt}`,
            action: activity.type || "loan_activity",
            description:
              activity.description ||
              `${getLoanTypeDisplayLabel(
                application.loanType,
                application.policyDetails,
              )} application updated`,
            source: "loan",
            referenceId: application.loanId || application._id,
            createdAt: activity.createdAt || application.updatedAt,
          })),
        ),
        ...insurance.flatMap((application: any) =>
          (application.activities || []).map((activity: any) => ({
            id: `insurance:${application._id}:${activity._id || activity.createdAt}`,
            action: activity.type || "insurance_activity",
            description:
              activity.description ||
              `${application.typeOfInsurance || "Insurance"} application updated`,
            source: "insurance",
            referenceId: application.applicationId || application._id,
            createdAt: activity.createdAt || application.updatedAt,
          })),
        ),
      ];
      const activityLog = [
        {
          id: `account-created:${user._id}`,
          action: "account_created",
          description: "Customer account registered",
          source: "account",
          createdAt: user.createdAt,
        },
        ...adminActivities.map((activity: any) => ({
          id: activity._id,
          action: activity.action,
          description: activity.description,
          source: "admin",
          actorEmail: activity.actorEmail,
          metadata: activity.metadata,
          createdAt: activity.createdAt,
        })),
        ...applicationActivities,
        ...notifications.map((notification: any) => ({
          id: notification._id,
          action: notification.type || "notification",
          description: `${notification.title}: ${notification.message}`,
          source: "notification",
          status: notification.status,
          createdAt: notification.createdAt,
        })),
      ]
        .filter((activity) => activity.createdAt)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 200);

      return res.status(200).json({
        success: true,
        message: "Customer details fetched successfully",
        data: {
          user: toCustomerRow(user),
          cibil: {
            score: user.cibilScore ?? user.experianScore ?? null,
            lastCheckedAt:
              user.cibilLastFetchedAt || user.experianLastFetchedAt || null,
            cibilCredits: user.cibilScoreCheckCredits || 0,
            experianCredits: user.experianScoreCheckCredits || 0,
          },
          applications: {
            loans: loans.map(({ activities: _activities, ...loan }: any) => ({
              ...loan,
              loanType: normalizeLoanType(loan.loanType) || loan.loanType,
            })),
            insurance: insurance.map(
              ({ activities: _activities, ...item }: any) => item,
            ),
          },
          documents: getDocumentRows(user),
          activityLog,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = req.params.id;
      const user: any = await User.findOne({
        _id: customerId,
        role: "user",
        isDeleted: { $ne: true },
      });
      if (!user) throw new ApiError(404, "Customer not found");

      const allowedStatuses = new Set(Object.values(UserStatus));
      const allowedSources = new Set(Object.values(RegistrationSource));
      const changedFields: string[] = [];
      const assign = (field: string, value: unknown) => {
        if (value === undefined) return;
        user.set(field, value);
        changedFields.push(field);
      };

      if (req.body.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) throw new ApiError(400, "Name is required");
        assign("name", name);
      }
      if (req.body.email !== undefined) {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (email) {
          const existing = await User.exists({
            _id: { $ne: customerId },
            email,
          });
          if (existing) throw new ApiError(409, "Email already in use");
        }
        assign("email", email || undefined);
      }
      if (req.body.mobile !== undefined) {
        const mobile = String(req.body.mobile || "").replace(/\D/g, "");
        if (mobile.length < 10) {
          throw new ApiError(400, "Valid mobile number is required");
        }
        const existing = await User.exists({
          _id: { $ne: customerId },
          mobile,
        });
        if (existing) throw new ApiError(409, "Mobile number already in use");
        assign("mobile", mobile);
      }
      if (req.body.panCard !== undefined) {
        const panCard = String(req.body.panCard || "").trim().toUpperCase();
        if (panCard) {
          const existing = await User.exists({
            _id: { $ne: customerId },
            panCard,
          });
          if (existing) throw new ApiError(409, "PAN already in use");
        }
        assign("panCard", panCard || undefined);
      }
      if (req.body.status !== undefined) {
        const status = String(req.body.status || "").toLowerCase();
        if (!allowedStatuses.has(status as UserStatus)) {
          throw new ApiError(400, "Invalid account status");
        }
        assign("status", status);
      }
      if (req.body.registrationSource !== undefined) {
        const source = String(req.body.registrationSource || "").toLowerCase();
        if (!allowedSources.has(source as RegistrationSource)) {
          throw new ApiError(400, "Invalid registration source");
        }
        assign("registrationSource", source);
      }
      if (req.body.gender !== undefined) assign("gender", req.body.gender);
      if (req.body.dateOfBirth !== undefined) {
        assign(
          "dateOfBirth",
          req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : undefined,
        );
      }
      if (req.body.city !== undefined) {
        const city = String(req.body.city || "").trim();
        const addresses = Array.isArray(user.addresses)
          ? user.addresses.map((address: any) =>
              address?.toObject ? address.toObject() : address,
            )
          : [];
        if (addresses.length) addresses[0] = { ...addresses[0], city };
        else addresses.push({ city, isDefault: true });
        user.addresses = addresses;
        user.set("kycProfile.personalDetails.city", city);
        changedFields.push("city");
      }

      await user.save();
      await logActivity(
        req,
        customerId,
        "profile_updated",
        `Customer details updated: ${changedFields.join(", ") || "no fields"}`,
        { changedFields },
      );

      return res.status(200).json({
        success: true,
        message: "Customer updated successfully",
        data: toCustomerRow(user.toObject()),
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = req.params.id;
      const status = String(req.body.status || "").trim().toLowerCase();
      if (!Object.values(UserStatus).includes(status as UserStatus)) {
        throw new ApiError(400, "Invalid account status");
      }
      const user = await User.findOneAndUpdate(
        { _id: customerId, role: "user", isDeleted: { $ne: true } },
        {
          $set: { status },
          ...(status === UserStatus.SUSPENDED ||
          status === UserStatus.DEACTIVATED
            ? { $unset: { refreshToken: "" } }
            : {}),
        },
        { new: true, runValidators: true },
      ).select(customerListProjection);
      if (!user) throw new ApiError(404, "Customer not found");

      await logActivity(
        req,
        customerId,
        "status_changed",
        `Account status changed to ${status}`,
        { status },
      );
      return res.status(200).json({
        success: true,
        message: `Customer account ${status}`,
        data: toCustomerRow(user.toObject()),
      });
    } catch (error) {
      next(error);
    }
  }

  static async softDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = req.params.id;
      const actor = (req as any).user || {};
      const user = await User.findOneAndUpdate(
        { _id: customerId, role: "user", isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: actor._id,
            status: UserStatus.DEACTIVATED,
          },
          $unset: { refreshToken: "" },
        },
        { new: true },
      ).select("_id name customerId");
      if (!user) throw new ApiError(404, "Customer not found");

      await logActivity(
        req,
        customerId,
        "account_deleted",
        "Customer account soft deleted",
        { reason: String(req.body?.reason || "").trim() },
      );
      return res.status(200).json({
        success: true,
        message: "Customer account soft deleted",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const customerId = req.params.id;
      const source = String(req.body.source || "").toLowerCase();
      const index = Number(req.body.index);
      const verified = req.body.verified !== false;
      if (!["kyc", "digilocker"].includes(source)) {
        throw new ApiError(400, "Document source is not verifiable");
      }
      if (!Number.isInteger(index) || index < 0) {
        throw new ApiError(400, "Invalid document index");
      }

      const user: any = await User.findOne({
        _id: customerId,
        role: "user",
        isDeleted: { $ne: true },
      });
      if (!user) throw new ApiError(404, "Customer not found");
      const documents =
        source === "kyc"
          ? user.kycProfile?.documents
          : user.digiLockerVault?.documents;
      if (!documents?.[index]) throw new ApiError(404, "Document not found");

      documents[index].verified = verified;
      user.markModified(
        source === "kyc"
          ? "kycProfile.documents"
          : "digiLockerVault.documents",
      );
      const allDocuments = [
        ...(user.kycProfile?.documents || []),
        ...(user.digiLockerVault?.documents || []),
      ];
      if (allDocuments.length && allDocuments.every((doc: any) => doc.verified)) {
        user.set("kycProfile.verification.status", KycVerificationStatus.VERIFIED);
        user.set("kycProfile.verification.verifiedAt", new Date());
        user.set(
          "kycProfile.verification.verifiedBy",
          String((req as any).user?.email || (req as any).user?._id || "admin"),
        );
      } else if (verified) {
        user.set(
          "kycProfile.verification.status",
          KycVerificationStatus.IN_PROGRESS,
        );
      }
      await user.save();

      await logActivity(
        req,
        customerId,
        verified ? "document_verified" : "document_unverified",
        `${documents[index].docType || "Document"} marked ${
          verified ? "verified" : "unverified"
        }`,
        { source, index, docType: documents[index].docType },
      );
      return res.status(200).json({
        success: true,
        message: `Document marked ${verified ? "verified" : "unverified"}`,
        data: { source, index, verified },
      });
    } catch (error) {
      next(error);
    }
  }

  static async sendNotification(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const customerId = req.params.id;
      const title = String(req.body.title || "").trim();
      const message = String(req.body.message || "").trim();
      if (!title || !message) {
        throw new ApiError(400, "Notification title and message are required");
      }
      const user = await User.findOne({
        _id: customerId,
        role: "user",
        isDeleted: { $ne: true },
      }).select("_id name");
      if (!user) throw new ApiError(404, "Customer not found");

      const actor = (req as any).user || {};
      await sendSingleNotification({
        type: "general-alert",
        toUserId: customerId,
        toRole: UserType.USER,
        fromUser: { _id: actor._id, role: UserType.ADMIN },
        context: { title, message },
      });
      await logActivity(
        req,
        customerId,
        "notification_sent",
        `Notification sent: ${title}`,
        { title },
      );

      return res.status(200).json({
        success: true,
        message: "Notification sent to customer",
      });
    } catch (error) {
      next(error);
    }
  }
}
