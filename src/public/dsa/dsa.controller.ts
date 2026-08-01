import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import ApiResponse from "../../utils/ApiResponse";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import { Agency } from "../../modals/agency.model";
import { UserStatus } from "../../modals/user.model";
import { Knowledge } from "../../modals/knowledge.model";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import { LoanQuery } from "../../modals/loanquery.model";
import { agencyLeadsService } from "../../services/agencyLeads.service";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import { agencyPayoutService } from "../../services/agencyPayout.service";
import { agencyPayoutProfileService } from "../../services/agencyPayoutProfile.service";
import { resolveDsaAttribution } from "../../services/dsaAttribution.service";
import { dsaMobileChangeService } from "../../services/dsaMobileChange.service";
import {
  getLoanTypeMatchValues,
  normalizeLoanType,
} from "../../utils/loanType";

const pageParams = (query: any) => {
  const page = Math.max(Number(query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
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

const ownerIdFor = (agency: any) =>
  String(agency?.parentAgency?._id || agency?.parentAgency || agency?._id || "");

const normalizedOnboardingStatus = (agency: any) => {
  if (
    agency?.status === UserStatus.ACTIVE &&
    agency?.approvalReview?.status !== "rejected"
  ) {
    return "approved";
  }
  return agency?.approvalReview?.status || "pending";
};

const profileCompletion = (agency: any, hasPayoutProfile = false) => {
  const personal = agency?.kycProfile?.personalDetails || {};
  const checks = [
    Boolean(agency?.name),
    Boolean(agency?.email),
    Boolean(agency?.mobile && agency?.isMobileVerified),
    Boolean(agency?.businessName),
    Boolean(agency?.gstin || agency?.verificationRecords?.gst?.number),
    Boolean(agency?.verificationRecords?.pan?.number),
    Boolean(personal?.address),
    Boolean(personal?.city),
    Boolean(personal?.state),
    Boolean(personal?.pinCode || personal?.pincode),
    hasPayoutProfile,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

const publicAgency = (agency: any) => {
  const plain = agency?.toObject ? agency.toObject() : { ...(agency || {}) };
  return {
    _id: plain._id,
    agencyId: plain.agencyId,
    referralCode: plain.referralCode,
    name: plain.name,
    businessName: plain.businessName,
    email: plain.email,
    mobile: plain.mobile,
    role: plain.role,
    parentAgency: plain.parentAgency,
    profilePictureUrl: plain.profilePictureUrl || plain.avatar,
    status: plain.status,
    onboardingStatus: normalizedOnboardingStatus(plain),
    rejectionReason: plain.approvalReview?.rejectionReason,
    reviewNotes: plain.approvalReview?.notes,
    gstin: plain.gstin || plain.verificationRecords?.gst?.number,
    gstVerified: Boolean(plain.verificationRecords?.gst?.verified),
    pan: plain.verificationRecords?.pan?.number,
    panVerified: Boolean(plain.verificationRecords?.pan?.verified),
    isMobileVerified: Boolean(plain.isMobileVerified),
    agreedToTerms: Boolean(plain.agreedToTerms),
    privacyPolicyAccepted: Boolean(plain.privacyPolicyAccepted),
    agentProfileCompleted: Boolean(plain.agentProfileCompleted),
    onboardingSubmittedAt: plain.onboardingSubmittedAt,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    address: plain.kycProfile?.personalDetails?.address,
    city: plain.kycProfile?.personalDetails?.city,
    state: plain.kycProfile?.personalDetails?.state,
    pincode:
      plain.kycProfile?.personalDetails?.pinCode ||
      plain.kycProfile?.personalDetails?.pincode,
  };
};

const dateMatch = (from?: unknown, to?: unknown) => {
  const range: Record<string, Date> = {};
  if (from) {
    const date = new Date(String(from));
    if (!Number.isNaN(date.getTime())) range.$gte = date;
  }
  if (to) {
    const date = new Date(String(to));
    if (!Number.isNaN(date.getTime())) {
      date.setHours(23, 59, 59, 999);
      range.$lte = date;
    }
  }
  return Object.keys(range).length ? range : undefined;
};

export class DsaController {
  static async sendMobileChangeOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await dsaMobileChangeService.sendOtp({
        agencyId: (req as any).user?._id,
        mobile: req.body?.mobile,
        ip: req.ip,
      });
      return res.status(200).json(
        new ApiResponse(200, result, "OTP sent to the new mobile number"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async verifyMobileChangeOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agency = await dsaMobileChangeService.verifyOtp({
        agencyId: (req as any).user?._id,
        mobile: req.body?.mobile,
        otp: req.body?.otp,
        ip: req.ip,
      });
      const payoutProfile = await agencyPayoutProfileService.get(
        ownerIdFor(agency),
      );
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...publicAgency(agency),
            profileCompletion: profileCompletion(
              agency,
              Boolean(payoutProfile),
            ),
            hasPayoutProfile: Boolean(payoutProfile),
          },
          "Mobile number updated successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getReferral(req: Request, res: Response, next: NextFunction) {
    try {
      const resolved = await resolveDsaAttribution(req.params.code);
      if (!resolved) return res.status(404).json(new ApiError(404, "Invalid DSA referral code"));
      const agency = await Agency.findById(resolved.channelAgency)
        .select("agencyId referralCode name businessName")
        .lean();
      const code = agency?.referralCode || agency?.agencyId;
      const shareUrl = `${String(config.dsa.referralBaseUrl).replace(/\/$/, "")}?dsa=${encodeURIComponent(String(code))}`;
      return res.status(200).json(
        new ApiResponse(200, {
          referralCode: code,
          shareUrl,
          dsa: {
            agencyId: agency?.agencyId,
            name: agency?.name,
            businessName: agency?.businessName,
          },
        }, "DSA referral verified"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async me(req: Request, res: Response, next: NextFunction) {
    try {
      const agency = await Agency.findById((req as any).user?._id)
        .select("agencyId referralCode name businessName email mobile role parentAgency profilePictureUrl avatar status approvalReview gstin verificationRecords.pan.number verificationRecords.pan.verified verificationRecords.gst.number verificationRecords.gst.verified isMobileVerified agreedToTerms privacyPolicyAccepted agentProfileCompleted onboardingSubmittedAt kycProfile.personalDetails createdAt updatedAt")
        .lean();
      if (!agency) return res.status(404).json(new ApiError(404, "DSA account not found"));
      const payoutProfile = await agencyPayoutProfileService.get(ownerIdFor(agency));
      const isPrimaryDsa = agency.role === "agency" && !agency.parentAgency;
      return res.status(200).json(
        new ApiResponse(200, {
          ...publicAgency(agency),
          profileCompletion: profileCompletion(agency, Boolean(payoutProfile)),
          hasPayoutProfile: Boolean(payoutProfile),
          payoutProfile: isPrimaryDsa ? payoutProfile : null,
        }, "DSA profile fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async updateOnboarding(req: Request, res: Response, next: NextFunction) {
    try {
      const agency: any = await Agency.findById((req as any).user?._id);
      if (!agency) return res.status(404).json(new ApiError(404, "DSA account not found"));
      if (agency.role === "agency_member") {
        return res.status(403).json(new ApiError(403, "Only the primary DSA can submit onboarding"));
      }
      const name = String(req.body?.name || agency.name || "").trim();
      const email = String(req.body?.email || agency.email || "").trim().toLowerCase();
      const businessName = String(req.body?.businessName || agency.businessName || "").trim();
      const gstin = String(req.body?.gstin || agency.gstin || "").trim().toUpperCase();
      const pan = String(req.body?.pan || agency.verificationRecords?.pan?.number || "").trim().toUpperCase();
      if (!name || !email) throw new ApiError(400, "Name and email are required");
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, "Valid email is required");
      if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
        throw new ApiError(400, "Valid GSTIN is required");
      }
      if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
        throw new ApiError(400, "Valid PAN is required");
      }
      const consentAccepted =
        agency.agreedToTerms === true && agency.privacyPolicyAccepted === true
          ? true
          : [true, "true", "1", "yes"].includes(req.body?.acceptedTerms);
      if (!consentAccepted) {
        throw new ApiError(400, "Terms and privacy consent are required");
      }
      const previousGstin = String(
        agency.gstin || agency.verificationRecords?.gst?.number || "",
      ).toUpperCase();
      const previousPan = String(
        agency.verificationRecords?.pan?.number || "",
      ).toUpperCase();
      const previousPersonal = agency.kycProfile?.personalDetails || {};
      const nextAddress = String(req.body?.address || previousPersonal.address || "").trim();
      const nextCity = String(req.body?.city || previousPersonal.city || "").trim();
      const nextState = String(req.body?.state || previousPersonal.state || "").trim();
      const nextPincode = String(
        req.body?.pincode || previousPersonal.pinCode || previousPersonal.pincode || "",
      ).trim();
      const reviewedProfileChanged = [
        [String(agency.name || "").trim(), name],
        [String(agency.email || "").trim().toLowerCase(), email],
        [String(agency.businessName || "").trim(), businessName],
        [previousGstin, gstin],
        [previousPan, pan],
        [String(previousPersonal.address || "").trim(), nextAddress],
        [String(previousPersonal.city || "").trim(), nextCity],
        [String(previousPersonal.state || "").trim(), nextState],
        [String(previousPersonal.pinCode || previousPersonal.pincode || "").trim(), nextPincode],
      ].some(([before, after]) => before !== after);
      const duplicate = await Agency.exists({ email, _id: { $ne: agency._id } });
      if (duplicate) throw new ApiError(409, "Email already belongs to another account");

      agency.name = name;
      agency.email = email;
      agency.businessName = businessName || undefined;
      agency.gstin = gstin || undefined;
      agency.agreedToTerms = true;
      agency.privacyPolicyAccepted = true;
      agency.onboardingSubmittedAt = new Date();
      agency.kycProfile = {
        ...(agency.kycProfile?.toObject?.() || agency.kycProfile || {}),
        personalDetails: {
          ...(agency.kycProfile?.personalDetails?.toObject?.() || agency.kycProfile?.personalDetails || {}),
          fullName: name,
          email,
          mobile: agency.mobile,
          address: nextAddress || undefined,
          city: nextCity || undefined,
          state: nextState || undefined,
          pinCode: nextPincode || undefined,
          businessName: businessName || undefined,
        },
        addressDetails: {
          ...(agency.kycProfile?.addressDetails?.toObject?.() || agency.kycProfile?.addressDetails || {}),
          currentAddress: {
            ...(agency.kycProfile?.addressDetails?.currentAddress?.toObject?.() || agency.kycProfile?.addressDetails?.currentAddress || {}),
            street: nextAddress || undefined,
            city: nextCity || undefined,
            state: nextState || undefined,
            postalCode: nextPincode || undefined,
            country: "India",
          },
        },
      };
      agency.verificationRecords = agency.verificationRecords || {};
      if (gstin) {
        agency.verificationRecords.gst = gstin !== previousGstin
          ? { number: gstin, verified: false, status: "pending" }
          : {
              ...(agency.verificationRecords.gst?.toObject?.() || agency.verificationRecords.gst || {}),
              number: gstin,
            };
      }
      if (pan) {
        agency.verificationRecords.pan = pan !== previousPan
          ? { number: pan, verified: false, status: "pending" }
          : {
              ...(agency.verificationRecords.pan?.toObject?.() || agency.verificationRecords.pan || {}),
              number: pan,
            };
      }
      if (agency.status !== UserStatus.ACTIVE || reviewedProfileChanged) {
        agency.status = UserStatus.PENDING_VERIFICATION;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "pending",
          resubmittedAt: new Date(),
        };
      }
      await agency.save();
      return res.status(200).json(
        new ApiResponse(200, {
          ...publicAgency(agency),
          profileCompletion: profileCompletion(agency, Boolean(await agencyPayoutProfileService.get(String(agency._id)))),
        }, "Onboarding submitted for review"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getPayoutProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const agency = await Agency.findById((req as any).user?._id)
        .select("_id role parentAgency")
        .lean();
      if (!agency) throw new ApiError(404, "DSA account not found");
      if (agency.role !== "agency" || agency.parentAgency) {
        const isConfigured = Boolean(
          await agencyPayoutProfileService.get(ownerIdFor(agency)),
        );
        return res.status(200).json(
          new ApiResponse(
            200,
            { isConfigured },
            "Payout profile availability fetched",
          ),
        );
      }
      const profile = await agencyPayoutProfileService.get(ownerIdFor(agency));
      return res.status(200).json(new ApiResponse(200, profile, "Payout profile fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async updatePayoutProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const agency: any = await Agency.findById((req as any).user?._id)
        .select("_id role parentAgency status approvalReview");
      if (!agency) throw new ApiError(404, "DSA account not found");
      if (agency.role !== "agency" || agency.parentAgency) {
        throw new ApiError(403, "Only the primary DSA can update payout details");
      }
      const profile = await agencyPayoutProfileService.upsert({
        agencyId: String(agency._id),
        updatedBy: String(agency._id),
        method: req.body?.method,
        upiId: req.body?.upiId,
        accountNumber: req.body?.accountNumber,
        ifsc: req.body?.ifsc,
        accountHolder: req.body?.accountHolder,
        bankName: req.body?.bankName,
      });
      if (agency.status === UserStatus.ACTIVE) {
        agency.status = UserStatus.PENDING_VERIFICATION;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "pending",
          resubmittedAt: new Date(),
          notes: "Payout details changed by DSA; admin re-approval required",
        };
        await agency.save();
      }
      return res.status(200).json(new ApiResponse(200, profile, "Encrypted payout profile saved"));
    } catch (error) {
      next(error);
    }
  }

  static async dashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = String((req as any).user?._id || "");
      const [profile, leads, earnings, payouts, recent] = await Promise.all([
        Agency.findById(agencyId).select("agencyId referralCode name businessName status approvalReview").lean(),
        agencyLeadsService.getLeadSummary(agencyId),
        agencyEarningsService.getAgencySummary(
          agencyId,
          typeof req.query.from === "string" ? req.query.from : undefined,
          typeof req.query.to === "string" ? req.query.to : undefined,
        ),
        agencyPayoutService.getSummary(agencyId),
        agencyLeadsService.listLeads({ agencyId, page: 1, limit: 5 }),
      ]);
      const kpis = {
        totalApplications: leads.summary.totalLeads,
        activeApplications: leads.summary.activePipelineCount,
        approvedApplications:
          leads.stageCounts.sanction + leads.stageCounts.disbursed,
        rejectedApplications: leads.stageCounts.rejected,
        disbursedApplications: leads.summary.disbursedCases,
        totalDisbursed: leads.summary.disbursedValue,
        totalDisbursedAmount: leads.summary.disbursedValue,
        projectedCommission: earnings.summary.projectedAmount,
        earnedCommission: earnings.summary.earnedAmount,
        paidCommission: earnings.summary.paidAmount,
        pendingCommission: leads.summary.pendingCommission,
        availablePayout: payouts.balances.availableToRequest,
        approvalRate:
          leads.summary.totalLeads > 0
            ? Number((
                ((leads.stageCounts.sanction + leads.stageCounts.disbursed) /
                  leads.summary.totalLeads) *
                100
              ).toFixed(2))
            : 0,
        conversionRate:
          leads.summary.totalLeads > 0
            ? Number(((leads.summary.disbursedCases / leads.summary.totalLeads) * 100).toFixed(2))
            : 0,
      };
      const agencyProfile = publicAgency(profile);
      return res.status(200).json(
        new ApiResponse(200, {
          agency: agencyProfile,
          profile: agencyProfile,
          range: {
            from: typeof req.query.from === "string" ? req.query.from : null,
            to: typeof req.query.to === "string" ? req.query.to : null,
          },
          kpis,
          statusCounts: leads.stageCounts,
          recentApplications: recent.result,
          metrics: kpis,
          stageCounts: leads.stageCounts,
          loanTypeBreakdown: leads.loanTypeBreakdown,
          payoutStats: payouts.stats,
          payoutBalances: payouts.balances,
        }, "DSA dashboard fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async applications(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyLeadsService.listLeads({
        agencyId: String((req as any).user?._id || ""),
        stage: ["pre_login", "login", "sanction", "disbursed"].includes(
          String(req.query.stage || ""),
        )
          ? (String(req.query.stage) as any)
          : "all",
        productType: typeof req.query.productType === "string" ? req.query.productType : "all",
        loanType: typeof req.query.loanType === "string" ? req.query.loanType : undefined,
        productVariant:
          typeof req.query.productVariant === "string"
            ? req.query.productVariant
            : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        minAmount:
          Number.isFinite(Number(req.query.minAmount))
            ? Math.max(0, Number(req.query.minAmount))
            : undefined,
        maxAmount:
          Number.isFinite(Number(req.query.maxAmount))
            ? Math.max(0, Number(req.query.maxAmount))
            : undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      return res.status(200).json(
        new ApiResponse(200, {
          items: result.result,
          pagination: pagination(
            result.pagination.currentPage,
            result.pagination.itemsPerPage,
            result.pagination.totalItems,
          ),
        }, "DSA applications fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async referralLink(req: Request, res: Response, next: NextFunction) {
    try {
      const agency = await Agency.findById((req as any).user?._id)
        .select("agencyId referralCode parentAgency")
        .populate("parentAgency", "agencyId referralCode")
        .lean();
      if (!agency) throw new ApiError(404, "DSA account not found");
      const owner: any = agency.parentAgency || agency;
      const referralCode = owner.referralCode || owner.agencyId;
      const shareUrl = `${String(config.dsa.referralBaseUrl).replace(/\/$/, "")}?dsa=${encodeURIComponent(referralCode)}`;
      const message = `Apply for a Fintaraa financial product using my DSA link: ${shareUrl}`;
      return res.status(200).json(
        new ApiResponse(200, {
          referralCode,
          shareUrl,
          whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
          smsText: message,
        }, "DSA referral link fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async commissions(req: Request, res: Response, next: NextFunction) {
    try {
      const agency = await Agency.findById((req as any).user?._id).select("_id parentAgency").lean();
      if (!agency) throw new ApiError(404, "DSA account not found");
      const ownerAgency = new Types.ObjectId(ownerIdFor(agency));
      const { page, limit, skip } = pageParams(req.query);
      const filter: Record<string, any> = {
        ownerAgency,
        isCanonical: { $ne: false },
      };
      const status = String(req.query.status || "");
      if (["pending", "earned", "paid", "reversed", "clawback_required"].includes(status)) filter.earningStatus = status;
      if (req.query.loanType) {
        const loanTypes = getLoanTypeMatchValues(String(req.query.loanType));
        if (!loanTypes.length) throw new ApiError(400, "Invalid loan type");
        filter.loanType = { $in: loanTypes };
      }
      const createdAt = dateMatch(req.query.from, req.query.to);
      if (createdAt) filter.createdAt = createdAt;
      const [rows, total] = await Promise.all([
        AgencyCommissionTransaction.find(filter)
          .select("queryRef customerName loanType productType disbursedAmount commissionAmount paidAmount earningStatus accrualStage disbursedAt paidAt paymentReference createdAt updatedAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AgencyCommissionTransaction.countDocuments(filter),
      ]);
      const items = rows.map((item: any) => ({
        ...item,
        loanType: normalizeLoanType(item.loanType) || item.loanType,
        id: String(item._id),
        applicationId: String(item.queryRef),
        status: item.earningStatus,
      }));
      return res.status(200).json(
        new ApiResponse(200, { items, pagination: pagination(page, limit, total) }, "Commission ledger fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async payouts(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyPayoutService.listRequests({
        agencyId: String((req as any).user?._id || ""),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      return res.status(200).json(
        new ApiResponse(200, {
          items: result.result.map((item: any) => ({
            _id: item._id,
            id: String(item._id),
            amount: item.amount,
            method: item.method,
            destinationMasked: item.destinationMasked,
            status: item.status,
            paymentReference: item.paymentReference,
            notes: item.notes,
            failureReason: item.failureReason,
            approvedAt: item.approvedAt,
            processedAt: item.processedAt,
            paidAt: item.paidAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
          pagination: pagination(
            result.pagination.currentPage,
            result.pagination.itemsPerPage,
            result.pagination.totalItems,
          ),
        }, "Payout requests fetched"),
      );
    } catch (error) {
      next(error);
    }
  }

  static async createPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const payout = await agencyPayoutService.createRequest({
        agencyId: String((req as any).user?._id || ""),
        amount: Number(req.body?.amount),
        method: req.body?.method,
        notes: req.body?.notes,
      });
      return res.status(201).json(new ApiResponse(201, payout, "Payout request created"));
    } catch (error) {
      next(error);
    }
  }

  static async leaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const period = ["month", "quarter", "all"].includes(String(req.query.period))
        ? String(req.query.period)
        : "month";
      const match: Record<string, any> = {
        earningStatus: { $in: ["earned", "paid"] },
        isCanonical: { $ne: false },
      };
      if (period !== "all") {
        const from = new Date();
        from.setDate(1);
        from.setHours(0, 0, 0, 0);
        if (period === "quarter") from.setMonth(from.getMonth() - 2);
        match.createdAt = { $gte: from };
      }
      const volumeMatch: Record<string, any> = {
        ownerAgency: { $exists: true },
        isDeleted: { $ne: true },
      };
      if (match.createdAt) volumeMatch.createdAt = match.createdAt;
      const rows = await LoanQuery.aggregate([
        { $match: volumeMatch },
        { $group: {
          _id: "$ownerAgency",
          applications: { $sum: 1 },
          approved: { $sum: { $cond: [{ $in: ["$status", ["approved", "login_approved", "sanctioned", "approved_with_conditions", "disbursed", "disbursed_partial_full", "completed_success"]] }, 1, 0] } },
          disbursed: { $sum: { $cond: [{ $in: ["$status", ["disbursed", "disbursed_partial_full", "completed_success"]] }, 1, 0] } },
          totalDisbursed: { $sum: { $ifNull: ["$disbursedAmount", 0] } },
        } },
        { $lookup: { from: "agencycommissiontransactions", let: { owner: "$_id" }, pipeline: [
          { $match: { ...match, $expr: { $eq: ["$ownerAgency", "$$owner"] } } },
          { $group: { _id: null, revenue: { $sum: "$commissionAmount" } } },
        ], as: "commission" } },
        { $lookup: { from: "agencies", localField: "_id", foreignField: "_id", as: "agency" } },
        { $unwind: "$agency" },
        { $addFields: {
          revenue: { $ifNull: [{ $first: "$commission.revenue" }, 0] },
          approvalRate: { $cond: [{ $gt: ["$applications", 0] }, { $multiply: [{ $divide: ["$approved", "$applications"] }, 100] }, 0] },
        } },
        { $sort: { revenue: -1, disbursed: -1, approved: -1 } },
        { $limit: limit },
        { $project: { agencyId: "$agency.agencyId", referralCode: "$agency.referralCode", name: "$agency.name", businessName: "$agency.businessName", applications: 1, approved: 1, disbursed: 1, approvalRate: 1, revenue: 1, totalDisbursed: 1 } },
      ]);
      const currentOwner = ownerIdFor(await Agency.findById((req as any).user?._id).select("_id parentAgency").lean());
      const items = rows.map((row: any, index: number) => ({
        rank: index + 1,
        ...row,
        totalCommission: row.revenue,
        disbursedCases: row.disbursed,
        disbursedApplications: row.disbursed,
        disbursedAmount: row.totalDisbursed,
        earnedCommission: row.revenue,
        isCurrentDsa: String(row._id) === currentOwner,
        isCurrentAgency: String(row._id) === currentOwner,
      }));
      return res.status(200).json(new ApiResponse(200, { period, items }, "DSA leaderboard fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async training(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, skip } = pageParams(req.query);
      const filter: Record<string, any> = {
        audience: { $in: ["dsa", "all"] },
        isActive: true,
        $or: [
          { publishedAt: { $exists: false } },
          { publishedAt: null },
          { publishedAt: { $lte: new Date() } },
        ],
      };
      if (req.query.type) filter.trainingType = String(req.query.type);
      if (req.query.productType) {
        filter.productType = {
          $in: [String(req.query.productType), "all"],
        };
      }
      if (req.query.loanType) filter.loanTypes = String(req.query.loanType);
      const [rows, total] = await Promise.all([
        Knowledge.find(filter)
          .select("title slug summary content trainingType documentUrl videoUrl youtubeUrl thumbnailUrl coverImageUrl productType loanTypes sortOrder publishedAt createdAt updatedAt")
          .sort({ sortOrder: 1, publishedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Knowledge.countDocuments(filter),
      ]);
      const items = rows.map((item: any) => ({
        ...item,
        id: String(item._id),
        type: item.trainingType,
        description: item.summary,
        url: item.trainingType === "video"
          ? item.videoUrl || item.youtubeUrl || item.documentUrl
          : item.documentUrl,
        thumbnailUrl: item.thumbnailUrl || item.coverImageUrl,
      }));
      return res.status(200).json(
        new ApiResponse(200, { items, pagination: pagination(page, limit, total) }, "DSA training content fetched"),
      );
    } catch (error) {
      next(error);
    }
  }
}
