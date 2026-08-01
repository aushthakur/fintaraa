import mongoose, { Types } from "mongoose";
import { Request, Response, NextFunction } from "express";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { Agency } from "../../modals/agency.model";
import { UserStatus } from "../../modals/user.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { AgencyCommissionRule } from "../../modals/agencyCommissionRule.model";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import { AgencyPayoutRequest } from "../../modals/agencyPayoutRequest.model";
import { AgencyPayoutProfile } from "../../modals/agencyPayoutProfile.model";
import { Knowledge } from "../../modals/knowledge.model";
import { agencyLeadsService } from "../../services/agencyLeads.service";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import { agencyPayoutProfileService } from "../../services/agencyPayoutProfile.service";
import { logger } from "../../config/logger";
import { enqueueCommunication } from "../../services/communicationOutbox.service";
import { CommunicationChannel } from "../../modals/communicationOutbox.model";
import { NotificationService } from "../../services/notification.service";
import { UserType } from "../../modals/notification.model";
import {
  getLoanTypeMatchValues,
  normalizeLoanType,
} from "../../utils/loanType";

const params = (query: any, maxLimit = 100) => {
  const page = Math.max(Number(query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const publicProfile = (agency: any) => ({
  _id: agency._id,
  agencyId: agency.agencyId,
  referralCode: agency.referralCode,
  name: agency.name,
  businessName: agency.businessName,
  email: agency.email,
  mobile: agency.mobile,
  role: agency.role,
  status: agency.status,
  onboardingStatus:
    agency.status === UserStatus.SUSPENDED
      ? "suspended"
      : agency.status === UserStatus.ACTIVE && agency.approvalReview?.status !== "rejected"
      ? "approved"
      : agency.approvalReview?.status || "pending",
  rejectionReason: agency.approvalReview?.rejectionReason,
  reviewNotes: agency.approvalReview?.notes,
  gstin: agency.gstin || agency.verificationRecords?.gst?.number,
  gstVerified: Boolean(agency.verificationRecords?.gst?.verified),
  pan: agency.verificationRecords?.pan?.number,
  panVerified: Boolean(agency.verificationRecords?.pan?.verified),
  isMobileVerified: Boolean(agency.isMobileVerified),
  agentProfileCompleted: Boolean(agency.agentProfileCompleted),
  city:
    agency.kycProfile?.personalDetails?.city ||
    agency.kycProfile?.addressDetails?.currentAddress?.city,
  onboardingSubmittedAt: agency.onboardingSubmittedAt,
  lastLoginAt: agency.lastLoginAt,
  createdAt: agency.createdAt,
  updatedAt: agency.updatedAt,
});

const profileSelect =
  "agencyId referralCode name businessName email mobile role parentAgency status approvalReview gstin verificationRecords.pan.number verificationRecords.pan.verified verificationRecords.gst.number verificationRecords.gst.verified isMobileVerified agreedToTerms privacyPolicyAccepted agentProfileCompleted kycProfile.personalDetails.city kycProfile.addressDetails.currentAddress.city onboardingSubmittedAt lastLoginAt createdAt updatedAt";

const dateRange = (from?: unknown, to?: unknown) => {
  const result: Record<string, Date> = {};
  if (from) {
    const parsed = new Date(String(from));
    if (!Number.isNaN(parsed.getTime())) result.$gte = parsed;
  }
  if (to) {
    const parsed = new Date(String(to));
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      result.$lte = parsed;
    }
  }
  return Object.keys(result).length ? result : undefined;
};

const parseLoanTypes = (value: any): string[] => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {}
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
};

const uploadedUrl = (value: any) => {
  const item = Array.isArray(value) ? value[0] : value;
  return String(item?.url || item || "").trim() || undefined;
};

const uploadedMeta = (value: any) => (Array.isArray(value) ? value[0] : value);

const csvCell = (value: any) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const escapeHtml = (value: any) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export class DsaAdminController {
  static async summary(_req: Request, res: Response, next: NextFunction) {
    try {
      const [profiles, commissions, paidRows, payouts, totalApplications, approvedApplications, trainingResources, outstandingRows] = await Promise.all([
        Agency.aggregate([
          { $match: { role: "agency" } },
          { $group: { _id: { $cond: [{ $eq: ["$status", "active"] }, "approved", { $cond: [{ $eq: ["$status", "suspended"] }, "suspended", { $ifNull: ["$approvalReview.status", "pending"] }] }] }, count: { $sum: 1 } } },
        ]),
        AgencyCommissionTransaction.aggregate([
          { $match: { isCanonical: { $ne: false } } },
          { $group: { _id: "$earningStatus", amount: { $sum: "$commissionAmount" }, count: { $sum: 1 } } },
        ]),
        AgencyCommissionTransaction.aggregate([
          { $match: { isCanonical: { $ne: false } } },
          { $group: { _id: null, amount: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] }, "$paidAmount", { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] }] } } } },
        ]),
        AgencyPayoutRequest.aggregate([
          { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
        LoanQuery.countDocuments({ ownerAgency: { $exists: true, $ne: null }, isDeleted: { $ne: true } }),
        LoanQuery.countDocuments({
          ownerAgency: { $exists: true, $ne: null },
          isDeleted: { $ne: true },
          status: { $in: ["approved", "login_approved", "sanctioned", "approved_with_conditions", "disbursed", "disbursed_partial_full", "completed_success"] },
        }),
        Knowledge.countDocuments({ audience: "dsa", isActive: true }),
        AgencyCommissionTransaction.aggregate([
          { $match: { earningStatus: "earned", isCanonical: { $ne: false } } },
          { $group: { _id: null, amount: { $sum: { $subtract: ["$commissionAmount", { $ifNull: ["$paidAmount", 0] }] } } } },
        ]),
      ]);
      const profileMap = Object.fromEntries(profiles.map((row: any) => [row._id, row.count]));
      const commissionMap = Object.fromEntries(commissions.map((row: any) => [row._id, { amount: row.amount, count: row.count }]));
      const payoutMap = Object.fromEntries(payouts.map((row: any) => [row._id, { amount: row.amount, count: row.count }]));
      const totalDsas = profiles.reduce((sum: number, row: any) => sum + row.count, 0);
      const activeDsas = profileMap.approved || 0;
      const pendingApprovals = profileMap.pending || 0;
      const unpaidCommission = Number(outstandingRows?.[0]?.amount || 0);
      const paidCommission = Number(paidRows?.[0]?.amount || 0);
      const pendingPayouts = ["pending", "approved", "processing"].reduce(
        (sum, key) => sum + Number(payoutMap[key]?.count || 0),
        0,
      );
      return res.status(200).json(new ApiResponse(200, {
        totalDsas,
        activeDsas,
        pendingApprovals,
        totalApplications,
        approvedApplications,
        unpaidCommission,
        paidCommission,
        pendingPayouts,
        trainingResources,
        profiles: {
          total: totalDsas,
          pending: profileMap.pending || 0,
          approved: profileMap.approved || 0,
          rejected: profileMap.rejected || 0,
        },
        commissions: commissionMap,
        payouts: payoutMap,
      }, "DSA command centre summary fetched"));
    } catch (error) { next(error); }
  }

  static async profiles(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = params(req.query, 500);
      const filter: Record<string, any> = { role: "agency" };
      const status = String(req.query.status || "").toLowerCase();
      if (status === "approved") {
        filter.status = UserStatus.ACTIVE;
        filter["approvalReview.status"] = { $ne: "rejected" };
      } else if (status === "rejected") {
        filter["approvalReview.status"] = "rejected";
      } else if (status === "suspended") {
        filter.status = UserStatus.SUSPENDED;
      } else if (status === "pending") {
        filter.status = UserStatus.PENDING_VERIFICATION;
        filter["approvalReview.status"] = { $ne: "rejected" };
      }
      const search = String(req.query.search || "").trim();
      const andFilters: Record<string, any>[] = [];
      if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        andFilters.push({ $or: [
          { name: regex }, { businessName: regex }, { email: regex },
          { mobile: regex }, { agencyId: regex }, { referralCode: regex }, { gstin: regex },
        ] });
      }
      if (req.query.city) {
        const city = new RegExp(`^${escapeRegex(String(req.query.city))}$`, "i");
        andFilters.push({ $or: [
          { "kycProfile.personalDetails.city": city },
          { "kycProfile.addressDetails.currentAddress.city": city },
        ] });
      }
      if (andFilters.length) filter.$and = andFilters;
      const [rows, total] = await Promise.all([
        Agency.find(filter).select(profileSelect).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Agency.countDocuments(filter),
      ]);
      const ownerIds = rows.map((row: any) => row._id);
      const [payoutProfiles, commissionRows] = await Promise.all([
        AgencyPayoutProfile.find({ agency: { $in: ownerIds } })
          .select("agency method maskedDestination bankName ifsc")
          .lean(),
        AgencyCommissionTransaction.aggregate([
          { $match: { ownerAgency: { $in: ownerIds }, isCanonical: { $ne: false } } },
          { $group: {
            _id: "$ownerAgency",
            totalCommission: {
              $sum: {
                $cond: [
                  { $in: ["$earningStatus", ["pending", "earned", "paid"]] },
                  "$commissionAmount",
                  0,
                ],
              },
            },
            paidCommission: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] }, "$paidAmount", { $cond: [{ $eq: ["$earningStatus", "paid"] }, "$commissionAmount", 0] }] } },
            earnedCommission: { $sum: { $cond: [{ $eq: ["$earningStatus", "earned"] }, { $subtract: ["$commissionAmount", { $ifNull: ["$paidAmount", 0] }] }, 0] } },
          } },
        ]),
      ]);
      const payoutMap = new Map(payoutProfiles.map((item: any) => [String(item.agency), item]));
      const earningMap = new Map(commissionRows.map((item: any) => [String(item._id), item]));
      const items = rows.map((row: any) => {
        const payout = payoutMap.get(String(row._id));
        const earning: any = earningMap.get(String(row._id)) || {};
        return {
          ...publicProfile(row),
          payoutProfile: payout
            ? {
                method: payout.method,
                maskedDestination: payout.maskedDestination,
                bankName: payout.bankName,
                ifsc: payout.ifsc,
              }
            : null,
          totalCommission: Number(earning.totalCommission || 0),
          earnedCommission: Number(earning.earnedCommission || 0),
          paidCommission: Number(earning.paidCommission || 0),
        };
      });
      return res.status(200).json(new ApiResponse(200, {
        items, pagination: pagination(page, limit, total),
      }, "DSA profiles fetched"));
    } catch (error) { next(error); }
  }

  static async profile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new ApiError(400, "Invalid DSA id");
      const agency = await Agency.findById(req.params.id).select(profileSelect).lean();
      if (!agency) throw new ApiError(404, "DSA account not found");
      const ownerId = String(agency.parentAgency || agency._id);
      const [payoutProfile, leads, earnings] = await Promise.all([
        AgencyPayoutProfile.findOne({ agency: ownerId }).select("-encryptedPayload").lean(),
        agencyLeadsService.getLeadSummary(String(agency._id)),
        agencyEarningsService.getAgencySummary(String(agency._id)),
      ]);
      return res.status(200).json(new ApiResponse(200, {
        profile: publicProfile(agency), payoutProfile, leadSummary: leads, earningsSummary: earnings,
      }, "DSA profile fetched"));
    } catch (error) { next(error); }
  }

  static async updateProfileStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = String(req.body?.status || "").toLowerCase();
      if (!["approved", "rejected", "suspended", "pending"].includes(status)) {
        throw new ApiError(400, "Status must be approved, rejected, suspended, or pending");
      }
      const agency: any = await Agency.findById(req.params.id);
      if (!agency) throw new ApiError(404, "DSA account not found");
      if (agency.role !== "agency" || agency.parentAgency) {
        throw new ApiError(400, "Only a primary DSA profile can be reviewed here");
      }
      const now = new Date();
      const notes = String(req.body?.notes || "").trim();
      const reason = String(req.body?.reason || "").trim();
      if (status === "approved") {
        const personal = agency.kycProfile?.personalDetails || {};
        const currentAddress = agency.kycProfile?.addressDetails?.currentAddress || {};
        const payoutProfile = await AgencyPayoutProfile.exists({ agency: agency._id });
        const checklist: Record<string, boolean> = {
          mobileVerified: Boolean(agency.isMobileVerified),
          name: Boolean(String(agency.name || "").trim()),
          email: Boolean(/^\S+@\S+\.\S+$/.test(String(agency.email || "").trim())),
          termsAccepted: agency.agreedToTerms === true,
          privacyAccepted: agency.privacyPolicyAccepted === true,
          onboardingSubmitted: Boolean(agency.onboardingSubmittedAt),
          businessName: Boolean(String(agency.businessName || "").trim()),
          address: Boolean(String(personal.address || currentAddress.street || "").trim()),
          city: Boolean(String(personal.city || currentAddress.city || "").trim()),
          pincode: Boolean(String(personal.pinCode || personal.pincode || currentAddress.pinCode || currentAddress.pincode || "").trim()),
          pan: Boolean(String(agency.verificationRecords?.pan?.number || "").trim()),
          gstin: Boolean(String(agency.gstin || agency.verificationRecords?.gst?.number || "").trim()),
          payoutProfile: Boolean(payoutProfile),
        };
        const missing = Object.entries(checklist)
          .filter(([, complete]) => !complete)
          .map(([key]) => key);
        if (missing.length) {
          throw new ApiError(400, `DSA onboarding is incomplete: ${missing.join(", ")}`);
        }
        agency.status = UserStatus.ACTIVE;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "approved", reviewedBy: (req as any).user?._id, reviewedAt: now,
          notes, rejectionReason: undefined, checklist,
        };
      } else if (status === "rejected") {
        if (!reason) throw new ApiError(400, "Rejection reason is required");
        agency.status = UserStatus.PENDING_VERIFICATION;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "rejected", reviewedBy: (req as any).user?._id, reviewedAt: now,
          notes, rejectionReason: reason,
        };
      } else if (status === "suspended") {
        agency.status = UserStatus.SUSPENDED;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          notes: notes || agency.approvalReview?.notes,
        };
      } else {
        agency.status = UserStatus.PENDING_VERIFICATION;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "pending", reviewedBy: (req as any).user?._id, reviewedAt: now,
          notes, rejectionReason: undefined,
        };
      }
      await agency.save();
      const statusLabel = status === "pending" ? "sent back for review" : status;
      const statusMessage =
        status === "rejected"
          ? `Your Fintaraa DSA onboarding was rejected. Reason: ${reason}`
          : status === "approved"
            ? "Your Fintaraa DSA profile is approved. You can now access partner applications, commissions and payouts."
            : status === "suspended"
              ? `Your Fintaraa DSA account has been suspended.${notes ? ` ${notes}` : ""}`
              : "Your Fintaraa DSA profile has been moved back to pending review.";
      const notificationTasks: Promise<any>[] = [
        NotificationService.send({
          type: "dsa_onboarding_status",
          title: `DSA profile ${statusLabel}`,
          message: statusMessage,
          toUserId: String(agency._id),
          toRole: UserType.AGENCY,
          data: { status, reason: reason || "", url: "/partner/onboarding" },
          fromUser: (req as any).user?._id
            ? { _id: String((req as any).user._id), role: UserType.ADMIN }
            : undefined,
        }),
      ];
      if (agency.email && agency.notification?.email !== false) {
        notificationTasks.push(enqueueCommunication({
          channel: CommunicationChannel.EMAIL,
          eventName: "dsa_onboarding_status",
          referenceId: String(agency._id),
          recipient: String(agency.email).trim().toLowerCase(),
          idempotencyKey: `dsa-status:${String(agency._id)}:${status}:${now.getTime()}`,
          payload: {
            to: String(agency.email).trim().toLowerCase(),
            subject: `Fintaraa DSA profile ${statusLabel}`,
            html: `<p>Hello ${escapeHtml(agency.name)},</p><p>${escapeHtml(statusMessage)}</p><p>Regards,<br>Fintaraa Partner Team</p>`,
          },
        }));
      }
      const notificationResults = await Promise.allSettled(notificationTasks);
      if (notificationResults.some((item) => item.status === "rejected")) {
        logger.warn(`[DSA status] one or more notifications could not be queued agency=${String(agency._id)} status=${status}`);
      }
      return res.status(200).json(new ApiResponse(200, publicProfile(agency), `DSA ${status}`));
    } catch (error) { next(error); }
  }

  static async commissionRules(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = params(req.query);
      const filter: Record<string, any> = {};
      if (req.query.loanType) {
        const loanTypes = getLoanTypeMatchValues(String(req.query.loanType));
        if (!loanTypes.length) throw new ApiError(400, "Invalid loan type");
        filter.loanType = { $in: loanTypes };
      }
      if (req.query.agencyId && Types.ObjectId.isValid(String(req.query.agencyId))) filter.agency = req.query.agencyId;
      if (req.query.isActive !== undefined) filter.isActive = String(req.query.isActive) !== "false";
      const [items, total] = await Promise.all([
        AgencyCommissionRule.find(filter).populate("agency", "agencyId name businessName").sort({ priority: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
        AgencyCommissionRule.countDocuments(filter),
      ]);
      const normalizedItems = items.map((item: any) => ({
        ...item,
        loanType: normalizeLoanType(item.loanType) || item.loanType,
      }));
      return res.status(200).json(new ApiResponse(200, { items: normalizedItems, pagination: pagination(page, limit, total) }, "Commission rules fetched"));
    } catch (error) { next(error); }
  }

  static normalizeRule(body: any) {
    const loanType = normalizeLoanType(String(body?.loanType || ""));
    const calculationType = String(body?.calculationType || "");
    const value = Number(body?.value);
    if (!loanType) throw new ApiError(400, "Invalid loan type");
    if (!["percentage", "flat"].includes(calculationType)) throw new ApiError(400, "Invalid calculation type");
    if (!Number.isFinite(value) || value < 0 || (calculationType === "percentage" && value > 100)) throw new ApiError(400, "Invalid commission value");
    const agencyId = body?.agencyId ? String(body.agencyId) : undefined;
    if (agencyId && !Types.ObjectId.isValid(agencyId)) throw new ApiError(400, "Invalid DSA id");
    const result: Record<string, any> = {
      agency: agencyId || undefined, loanType, calculationType, value,
      priority: Number(body?.priority) || 0,
      isActive: body?.isActive === undefined ? true : [true, "true", "1"].includes(body.isActive),
    };
    for (const key of ["minLoanAmount", "maxLoanAmount", "capAmount"]) {
      if (body?.[key] !== undefined && body?.[key] !== "") {
        const number = Number(body[key]);
        if (!Number.isFinite(number) || number < 0) throw new ApiError(400, `${key} must be a positive number`);
        result[key] = number;
      }
    }
    if (result.minLoanAmount !== undefined && result.maxLoanAmount !== undefined && result.minLoanAmount > result.maxLoanAmount) {
      throw new ApiError(400, "Minimum loan amount cannot exceed maximum loan amount");
    }
    for (const key of ["effectiveFrom", "effectiveTo"]) {
      if (body?.[key]) {
        const date = new Date(body[key]);
        if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${key}`);
        result[key] = date;
      }
    }
    if (result.effectiveFrom && result.effectiveTo && result.effectiveFrom > result.effectiveTo) {
      throw new ApiError(400, "Effective from cannot be after effective to");
    }
    return result;
  }

  static async createRule(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = DsaAdminController.normalizeRule(req.body);
      if (payload.agency) {
        const agency = await Agency.exists({ _id: payload.agency, role: "agency" });
        if (!agency) throw new ApiError(400, "Commission rule DSA does not exist");
      }
      const rule = await AgencyCommissionRule.create({
        ...payload, createdBy: (req as any).user?._id, updatedBy: (req as any).user?._id,
      });
      return res.status(201).json(new ApiResponse(201, rule, "Commission rule created"));
    } catch (error) { next(error); }
  }

  static async updateRule(req: Request, res: Response, next: NextFunction) {
    try {
      const existing = await AgencyCommissionRule.findById(req.params.id).lean();
      if (!existing) throw new ApiError(404, "Commission rule not found");
      const hasAgencyId = Object.prototype.hasOwnProperty.call(req.body || {}, "agencyId");
      const payload = DsaAdminController.normalizeRule({
        ...existing,
        ...req.body,
        agencyId: hasAgencyId ? req.body?.agencyId : existing.agency,
      });
      if (payload.agency) {
        const agency = await Agency.exists({ _id: payload.agency, role: "agency" });
        if (!agency) throw new ApiError(400, "Commission rule DSA does not exist");
      }
      const unset: Record<string, ""> = {};
      for (const key of ["minLoanAmount", "maxLoanAmount", "capAmount", "effectiveFrom", "effectiveTo"]) {
        if (
          Object.prototype.hasOwnProperty.call(req.body || {}, key) &&
          (req.body?.[key] === "" || req.body?.[key] === null)
        ) {
          unset[key] = "";
        }
      }
      if (hasAgencyId && (req.body?.agencyId === "" || req.body?.agencyId === null)) {
        unset.agency = "";
        delete payload.agency;
      }
      const rule = await AgencyCommissionRule.findByIdAndUpdate(req.params.id, {
        $set: { ...payload, updatedBy: (req as any).user?._id },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      }, { new: true, runValidators: true });
      return res.status(200).json(new ApiResponse(200, rule, "Commission rule updated"));
    } catch (error) { next(error); }
  }

  static async deleteRule(req: Request, res: Response, next: NextFunction) {
    try {
      const rule = await AgencyCommissionRule.findByIdAndUpdate(req.params.id, { $set: { isActive: false, updatedBy: (req as any).user?._id } }, { new: true });
      if (!rule) throw new ApiError(404, "Commission rule not found");
      return res.status(200).json(new ApiResponse(200, rule, "Commission rule deactivated"));
    } catch (error) { next(error); }
  }

  static async commissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = params(req.query);
      const filter: Record<string, any> = { isCanonical: { $ne: false } };
      if (req.query.agencyId && Types.ObjectId.isValid(String(req.query.agencyId))) filter.ownerAgency = req.query.agencyId;
      if (req.query.loanType) {
        const loanTypes = getLoanTypeMatchValues(String(req.query.loanType));
        if (!loanTypes.length) throw new ApiError(400, "Invalid loan type");
        filter.loanType = { $in: loanTypes };
      }
      if (["pending", "earned", "paid", "reversed", "clawback_required"].includes(String(req.query.status))) filter.earningStatus = req.query.status;
      const createdAt = dateRange(req.query.from, req.query.to);
      if (createdAt) filter.createdAt = createdAt;
      const [items, total] = await Promise.all([
        AgencyCommissionTransaction.find(filter).populate("ownerAgency", "agencyId name businessName").populate("commissionRuleId", "calculationType value").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AgencyCommissionTransaction.countDocuments(filter),
      ]);
      const normalizedItems = items.map((item: any) => ({
        ...item,
        loanType: normalizeLoanType(item.loanType) || item.loanType,
      }));
      return res.status(200).json(new ApiResponse(200, { items: normalizedItems, pagination: pagination(page, limit, total) }, "Commission ledger fetched"));
    } catch (error) { next(error); }
  }

  static async markCommissionPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const paymentReference = String(req.body?.paymentReference || "").trim();
      if (!paymentReference) throw new ApiError(400, "Payment reference is required");
      const tx: any = await AgencyCommissionTransaction.findById(req.params.id);
      if (!tx) throw new ApiError(404, "Commission transaction not found");
      if (tx.isCanonical === false) throw new ApiError(409, "Superseded commission records cannot be paid");
      if (tx.earningStatus === "paid") {
        if (tx.paymentReference && tx.paymentReference !== paymentReference) {
          throw new ApiError(409, "Commission is already paid with a different reference");
        }
        return res.status(200).json(new ApiResponse(200, tx, "Commission already paid"));
      }
      if (tx.earningStatus !== "earned") throw new ApiError(409, "Only earned commission can be paid");
      const activePayout = await AgencyPayoutRequest.exists({
        ownerAgency: tx.ownerAgency,
        $or: [
          { reservationActive: true },
          { status: { $in: ["pending", "approved", "processing"] } },
        ],
      });
      if (activePayout) throw new ApiError(409, "An active payout reservation exists for this DSA");
      tx.paidAmount = tx.commissionAmount;
      tx.earningStatus = "paid";
      tx.paidAt = new Date();
      tx.paidBy = (req as any).user?._id;
      tx.paymentReference = paymentReference;
      tx.notes = String(req.body?.notes || "").trim() || undefined;
      await tx.save();
      return res.status(200).json(new ApiResponse(200, tx, "Commission marked paid"));
    } catch (error) { next(error); }
  }

  static async payouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = params(req.query);
      const filter: Record<string, any> = {};
      if (req.query.agencyId && Types.ObjectId.isValid(String(req.query.agencyId))) filter.ownerAgency = req.query.agencyId;
      if (["pending", "approved", "processing", "paid", "failed", "rejected"].includes(String(req.query.status))) filter.status = req.query.status;
      const createdAt = dateRange(req.query.from, req.query.to);
      if (createdAt) filter.createdAt = createdAt;
      const [items, total] = await Promise.all([
        AgencyPayoutRequest.find(filter).select("-upiId -bankDetails").populate("ownerAgency", "agencyId name businessName").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AgencyPayoutRequest.countDocuments(filter),
      ]);
      return res.status(200).json(new ApiResponse(200, { items, pagination: pagination(page, limit, total) }, "Payout queue fetched"));
    } catch (error) { next(error); }
  }

  static async revealPayoutDestination(req: Request, res: Response, next: NextFunction) {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new ApiError(400, "Invalid payout id");
      const payout: any = await AgencyPayoutRequest.findOne({
        _id: req.params.id,
        status: { $in: ["pending", "approved", "processing"] },
      }).select("_id ownerAgency payoutProfile method status +destinationEncryptedSnapshot").lean();
      if (!payout) {
        throw new ApiError(404, "Active payout request not found");
      }
      let revealed;
      if (payout.destinationEncryptedSnapshot) {
        revealed = agencyPayoutProfileService.revealSnapshot({
          method: payout.method,
          encryptedPayload: payout.destinationEncryptedSnapshot,
        });
      } else {
        if (!payout.payoutProfile) {
          throw new ApiError(409, "Payout request has no encrypted destination profile");
        }
        const ownedProfile = await AgencyPayoutProfile.exists({
          _id: payout.payoutProfile,
          agency: payout.ownerAgency,
        });
        if (!ownedProfile) throw new ApiError(409, "Payout destination profile does not match the DSA");
        revealed = await agencyPayoutProfileService.reveal(String(payout.payoutProfile));
      }
      logger.info(
        `[DSA payout audit] destination revealed admin=${String((req as any).user?._id || "unknown")} payout=${String(payout._id)}`,
      );
      res.setHeader("Cache-Control", "no-store, private");
      return res.status(200).json(new ApiResponse(200, {
        payoutId: String(payout._id),
        method: revealed.method,
        destination: revealed.destination,
      }, "Payout destination revealed"));
    } catch (error) { next(error); }
  }

  static async updatePayoutStatus(req: Request, res: Response, next: NextFunction) {
    const session = await mongoose.startSession();
    try {
      const target = String(req.body?.status || "").toLowerCase();
      if (!["approved", "processing", "paid", "failed", "rejected"].includes(target)) throw new ApiError(400, "Invalid payout status");
      let finalRequest: any;
      await session.withTransaction(async () => {
        const payout: any = await AgencyPayoutRequest.findById(req.params.id).session(session);
        if (!payout) throw new ApiError(404, "Payout request not found");
        if (payout.status === target) {
          const requestedReference = String(req.body?.paymentReference || "").trim();
          if (
            target === "paid" &&
            requestedReference &&
            payout.paymentReference &&
            requestedReference !== payout.paymentReference
          ) {
            throw new ApiError(409, "Payout is already paid with a different reference");
          }
          finalRequest = payout;
          return;
        }
        const transitions: Record<string, string[]> = {
          pending: ["approved", "rejected"], approved: ["processing", "rejected"],
          processing: ["paid", "failed"], failed: ["rejected"],
        };
        if (!transitions[payout.status]?.includes(target)) throw new ApiError(409, `Cannot move payout from ${payout.status} to ${target}`);
        const now = new Date();
        const paymentReference = String(req.body?.paymentReference || "").trim();
        if (target === "paid") {
          if (!paymentReference) throw new ApiError(400, "Payment reference is required");
          const transactions: any[] = await AgencyCommissionTransaction.find({
            ownerAgency: payout.ownerAgency,
            earningStatus: "earned",
            isCanonical: { $ne: false },
            $expr: { $lt: [{ $ifNull: ["$paidAmount", 0] }, "$commissionAmount"] },
          }).sort({ disbursedAt: 1, createdAt: 1 }).session(session);
          let remaining = Number(payout.amount);
          const allocations: Array<{ transaction: Types.ObjectId; amount: number }> = [];
          for (const tx of transactions) {
            if (remaining <= 0.005) break;
            const outstanding = Math.max(0, Number(tx.commissionAmount) - Number(tx.paidAmount || 0));
            const amount = Math.min(outstanding, remaining);
            if (amount <= 0) continue;
            tx.paidAmount = Number(tx.paidAmount || 0) + amount;
            if (tx.paidAmount >= Number(tx.commissionAmount) - 0.005) {
              tx.earningStatus = "paid";
              tx.paidAt = now;
            }
            tx.paidBy = (req as any).user?._id;
            tx.paymentReference = paymentReference;
            await tx.save({ session });
            allocations.push({ transaction: tx._id, amount: Number(amount.toFixed(2)) });
            remaining -= amount;
          }
          if (remaining > 0.005) throw new ApiError(409, "Earned commission is insufficient for this payout");
          payout.payoutAllocations = allocations;
          payout.commissionTransactions = allocations.map((item) => item.transaction);
          payout.paidAt = now;
          payout.processedAt = now;
          payout.paymentReference = paymentReference;
          payout.reservationActive = false;
        } else if (target === "approved") {
          payout.approvedAt = now;
          payout.approvedBy = (req as any).user?._id;
        } else if (target === "processing") {
          payout.processedAt = now;
        } else {
          payout.reservationActive = false;
          payout.failureReason = String(req.body?.reason || "").trim() || undefined;
        }
        payout.status = target;
        payout.notes = String(req.body?.notes || payout.notes || "").trim() || undefined;
        await payout.save({ session });
        finalRequest = payout;
      });
      return res.status(200).json(new ApiResponse(200, finalRequest, "Payout status updated"));
    } catch (error) { next(error); }
    finally { await session.endSession(); }
  }

  static async leaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const period = ["month", "quarter", "all"].includes(String(req.query.period))
        ? String(req.query.period)
        : "month";
      const match: Record<string, any> = {
        ownerAgency: { $exists: true },
        isDeleted: { $ne: true },
      };
      const commissionPeriodMatch: Record<string, any> = {
        earningStatus: { $in: ["earned", "paid"] },
        isCanonical: { $ne: false },
      };
      if (period !== "all") {
        const from = new Date();
        from.setDate(1);
        from.setHours(0, 0, 0, 0);
        if (period === "quarter") from.setMonth(from.getMonth() - 2);
        match.createdAt = { $gte: from };
        commissionPeriodMatch.createdAt = { $gte: from };
      }
      const rows = await LoanQuery.aggregate([
        { $match: match },
        { $group: {
          _id: "$ownerAgency", applications: { $sum: 1 },
          approved: { $sum: { $cond: [{ $in: ["$status", ["approved", "login_approved", "sanctioned", "approved_with_conditions", "disbursed", "disbursed_partial_full", "completed_success"]] }, 1, 0] } },
          disbursed: { $sum: { $cond: [{ $in: ["$status", ["disbursed", "disbursed_partial_full", "completed_success"]] }, 1, 0] } },
          totalDisbursed: { $sum: { $ifNull: ["$disbursedAmount", 0] } },
        } },
        { $lookup: { from: "agencycommissiontransactions", let: { owner: "$_id" }, pipeline: [{ $match: { ...commissionPeriodMatch, $expr: { $eq: ["$ownerAgency", "$$owner"] } } }, { $group: { _id: null, revenue: { $sum: "$commissionAmount" } } }], as: "commission" } },
        { $lookup: { from: "agencies", localField: "_id", foreignField: "_id", as: "agency" } },
        { $unwind: "$agency" },
        { $addFields: { revenue: { $ifNull: [{ $first: "$commission.revenue" }, 0] }, approvalRate: { $cond: [{ $gt: ["$applications", 0] }, { $multiply: [{ $divide: ["$approved", "$applications"] }, 100] }, 0] } } },
        { $sort: { revenue: -1, disbursed: -1, approved: -1 } },
        { $limit: limit },
        { $project: { agencyId: "$agency.agencyId", referralCode: "$agency.referralCode", name: "$agency.name", businessName: "$agency.businessName", applications: 1, approved: 1, disbursed: 1, approvalRate: 1, revenue: 1, totalDisbursed: 1 } },
      ]);
      return res.status(200).json(new ApiResponse(200, { period, items: rows.map((row: any, index: number) => ({ rank: index + 1, ...row })) }, "DSA leaderboard fetched"));
    } catch (error) { next(error); }
  }

  static trainingPayload(req: Request, existing?: any) {
    const title = String(req.body?.title ?? existing?.title ?? "").trim();
    const trainingType = String(req.body?.type ?? req.body?.trainingType ?? existing?.trainingType ?? "").toLowerCase();
    if (!title) throw new ApiError(400, "Training title is required");
    if (!["pdf", "video", "product_guide"].includes(trainingType)) throw new ApiError(400, "Training type must be pdf, video, or product_guide");
    const fileMeta: any = uploadedMeta(req.body?.file);
    const documentUrl = uploadedUrl(req.body?.file) || String(req.body?.documentUrl || existing?.documentUrl || "").trim() || undefined;
    const videoUrl = String(req.body?.videoUrl || existing?.videoUrl || existing?.youtubeUrl || "").trim() || undefined;
    if (trainingType === "pdf" && !documentUrl) throw new ApiError(400, "PDF file is required");
    if (trainingType === "video" && !videoUrl && !documentUrl) throw new ApiError(400, "Video URL or file is required");
    const ensureHttps = (value: string, label: string) => {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") throw new Error("not https");
      } catch {
        throw new ApiError(400, `${label} must be a valid HTTPS URL`);
      }
    };
    if (documentUrl) ensureHttps(documentUrl, "Training file URL");
    if (videoUrl) ensureHttps(videoUrl, "Video URL");
    if (fileMeta?.mimetype) {
      const mimetype = String(fileMeta.mimetype).toLowerCase();
      if ((trainingType === "pdf" || trainingType === "product_guide") && mimetype !== "application/pdf") {
        throw new ApiError(400, "PDF training upload must use application/pdf");
      }
      if (trainingType === "video" && !mimetype.startsWith("video/")) {
        throw new ApiError(400, "Uploaded training video must use a video MIME type");
      }
    }
    const isActive = req.body?.isActive === undefined ? existing?.isActive ?? true : [true, "true", "1", "active"].includes(req.body.isActive);
    const productType = String(
      req.body?.productType ?? existing?.productType ?? "all",
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (!["loan", "insurance", "credit_card", "all"].includes(productType)) {
      throw new ApiError(
        400,
        "Product type must be loan, insurance, credit_card, or all",
      );
    }
    return {
      title, summary: String(req.body?.description ?? req.body?.summary ?? existing?.summary ?? "").trim(),
      content: String(req.body?.content ?? existing?.content ?? ""),
      audience: "dsa", trainingType,
      type: trainingType === "video" ? "video" : "tutorial",
      documentUrl, videoUrl,
      thumbnailUrl: uploadedUrl(req.body?.thumbnail) || String(req.body?.thumbnailUrl || existing?.thumbnailUrl || "").trim() || undefined,
      coverImageUrl: uploadedUrl(req.body?.thumbnail) || String(req.body?.thumbnailUrl || existing?.thumbnailUrl || existing?.coverImageUrl || "").trim(),
      productType,
      loanTypes: parseLoanTypes(req.body?.loanTypes ?? existing?.loanTypes),
      sortOrder: Number(req.body?.sortOrder ?? existing?.sortOrder) || 0,
      isActive,
      publishedAt: isActive ? existing?.publishedAt || new Date() : existing?.publishedAt,
    };
  }

  static async training(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = params(req.query);
      const filter: Record<string, any> = { audience: "dsa" };
      if (req.query.type) filter.trainingType = req.query.type;
      if (req.query.productType) filter.productType = req.query.productType;
      if (req.query.isActive !== undefined) filter.isActive = String(req.query.isActive) !== "false";
      const [items, total] = await Promise.all([
        Knowledge.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        Knowledge.countDocuments(filter),
      ]);
      return res.status(200).json(new ApiResponse(200, { items, pagination: pagination(page, limit, total) }, "DSA training fetched"));
    } catch (error) { next(error); }
  }

  static async createTraining(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await Knowledge.create({ ...DsaAdminController.trainingPayload(req), createdBy: String((req as any).user?._id || ""), createdByRole: "admin" });
      return res.status(201).json(new ApiResponse(201, item, "DSA training created"));
    } catch (error) { next(error); }
  }

  static async updateTraining(req: Request, res: Response, next: NextFunction) {
    try {
      const item: any = await Knowledge.findOne({ _id: req.params.id, audience: "dsa" });
      if (!item) throw new ApiError(404, "DSA training not found");
      Object.assign(item, DsaAdminController.trainingPayload(req, item.toObject()));
      item.editedBy = String((req as any).user?._id || "");
      item.editedByRole = "admin";
      item.editedAt = new Date();
      await item.save();
      return res.status(200).json(new ApiResponse(200, item, "DSA training updated"));
    } catch (error) { next(error); }
  }

  static async deleteTraining(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await Knowledge.findOneAndUpdate({ _id: req.params.id, audience: "dsa" }, { $set: { isActive: false, editedBy: String((req as any).user?._id || ""), editedAt: new Date() } }, { new: true });
      if (!item) throw new ApiError(404, "DSA training not found");
      return res.status(200).json(new ApiResponse(200, item, "DSA training deactivated"));
    } catch (error) { next(error); }
  }

  static async exportReport(req: Request, res: Response, next: NextFunction) {
    try {
      const report = String(req.query.report || "profiles").toLowerCase();
      let headers: string[] = [];
      let rows: any[][] = [];
      if (report === "profiles") {
        headers = ["Agency ID", "Referral Code", "Name", "Business", "Email", "Mobile", "Status", "Approval", "GSTIN", "Created At"];
        const items: any[] = await Agency.find({ role: "agency" }).select(profileSelect).sort({ createdAt: -1 }).lean();
        rows = items.map((item) => { const profile = publicProfile(item); return [profile.agencyId, profile.referralCode, profile.name, profile.businessName, profile.email, profile.mobile, profile.status, profile.onboardingStatus, profile.gstin, profile.createdAt]; });
      } else if (report === "commissions") {
        headers = ["Transaction ID", "Agency", "Loan Type", "Customer", "Disbursed", "Commission", "Paid", "Status", "Created At"];
        const filter: any = { isCanonical: { $ne: false } }; const range = dateRange(req.query.from, req.query.to); if (range) filter.createdAt = range;
        const items: any[] = await AgencyCommissionTransaction.find(filter).populate("ownerAgency", "agencyId").sort({ createdAt: -1 }).lean();
        rows = items.map((item) => [item._id, item.ownerAgency?.agencyId, item.loanType, item.customerName, item.disbursedAmount, item.commissionAmount, item.paidAmount || 0, item.earningStatus, item.createdAt]);
      } else if (report === "payouts") {
        headers = ["Payout ID", "Agency", "Amount", "Method", "Destination", "Status", "Reference", "Created At", "Paid At"];
        const filter: any = {}; const range = dateRange(req.query.from, req.query.to); if (range) filter.createdAt = range;
        const items: any[] = await AgencyPayoutRequest.find(filter).select("-upiId -bankDetails").populate("ownerAgency", "agencyId").sort({ createdAt: -1 }).lean();
        rows = items.map((item) => [item._id, item.ownerAgency?.agencyId, item.amount, item.method, item.destinationMasked, item.status, item.paymentReference, item.createdAt, item.paidAt]);
      } else throw new ApiError(400, "Report must be profiles, commissions, or payouts");
      const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="dsa-${report}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send(csv);
    } catch (error) { next(error); }
  }
}
