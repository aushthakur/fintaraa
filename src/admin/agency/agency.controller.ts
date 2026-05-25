import ApiError from "../../utils/ApiError";
import ApiResponse from "../../utils/ApiResponse";
import { Agency, AgencyRole } from "../../modals/agency.model";
import { Gender, UserStatus } from "../../modals/user.model";
import { AgencyCommissionTransaction } from "../../modals/agencyCommissionTransaction.model";
import { CommonService } from "../../services/common.services";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import {
  fetchSurepassGstinVerification,
  fetchSurepassPanToAadhaar,
  fetchSurepassPanVerification,
  fetchSurepassPennyDropVerification,
  prepareSurepassGstinPayload,
  prepareSurepassPanVerificationPayload,
  prepareSurepassPennyDropPayload,
} from "../../services/surepass.service";
import { NextFunction, Request, Response } from "express";

const agencyService = new CommonService(Agency);
const ALLOWED_STATUSES = Object.values(UserStatus);
const ALLOWED_ROLES: AgencyRole[] = ["agency", "agency_member"];
const ALLOWED_GENDERS = Object.values(Gender);

const normalizeStatus = (value: any): UserStatus | null => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const status = ALLOWED_STATUSES.find((item) => item === normalized);
  return (status as UserStatus) || null;
};

const normalizeRole = (value: any): AgencyRole | null => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const role = ALLOWED_ROLES.find((item) => item === normalized);
  return role || null;
};

const normalizeBoolean = (value: any, fallback?: boolean) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "inactive"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeGender = (value: any): Gender | null => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  const gender = ALLOWED_GENDERS.find((item) => item === normalized);
  return (gender as Gender) || null;
};

const ensureVerificationConsent = (value: any) => {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : value;
  const hasConsent =
    value === true ||
    normalized === "y" ||
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1";

  if (!hasConsent) {
    throw new ApiError(400, "Consent is required before verification");
  }
};

const sanitizeBankDetails = (
  payload: any,
  options?: { fallback?: Record<string, any> },
) => {
  const source = payload?.bankDetails || payload;
  const fallback = options?.fallback || {};

  const accountNumber = String(
    source?.accountNumber ?? fallback?.accountNumber ?? "",
  )
    .replace(/\s+/g, "")
    .trim();
  const ifscCode = String(source?.ifscCode ?? fallback?.ifscCode ?? "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
  const accountHolderName = String(
    source?.accountHolderName ?? fallback?.accountHolderName ?? "",
  ).trim();
  const bankName = String(source?.bankName ?? fallback?.bankName ?? "").trim();
  const branchName = String(
    source?.branchName ?? fallback?.branchName ?? "",
  ).trim();
  const accountType = String(
    source?.accountType ?? fallback?.accountType ?? "",
  ).trim();
  const cancelledChequeUrl = String(
    source?.cancelledChequeUrl ?? fallback?.cancelledChequeUrl ?? "",
  ).trim();
  const verified = normalizeBoolean(
    source?.verified,
    normalizeBoolean(fallback?.verified, false),
  );
  const verificationStatus = String(
    source?.verificationStatus ?? fallback?.verificationStatus ?? "",
  ).trim();
  const verificationMessage = String(
    source?.verificationMessage ?? fallback?.verificationMessage ?? "",
  ).trim();
  const verificationReferenceId = String(
    source?.verificationReferenceId ?? fallback?.verificationReferenceId ?? "",
  ).trim();
  const verificationUtr = String(
    source?.verificationUtr ?? fallback?.verificationUtr ?? "",
  ).trim();
  const verifiedAtRaw = source?.verifiedAt ?? fallback?.verifiedAt;
  const verifiedAt = verifiedAtRaw ? new Date(verifiedAtRaw) : undefined;

  const hasAnyValue = [
    accountNumber,
    ifscCode,
    accountHolderName,
    bankName,
    branchName,
    accountType,
    cancelledChequeUrl,
    verificationStatus,
    verificationMessage,
    verificationReferenceId,
    verificationUtr,
    verified,
    verifiedAt,
  ].some(Boolean);

  if (!hasAnyValue) return undefined;

  const details: Record<string, any> = {
    accountNumber,
    ifscCode,
    accountHolderName,
    bankName,
    branchName,
    accountType,
    cancelledChequeUrl,
    verified: Boolean(verified),
    verificationStatus: verificationStatus || undefined,
    verificationMessage: verificationMessage || undefined,
    verificationReferenceId: verificationReferenceId || undefined,
    verificationUtr: verificationUtr || undefined,
    verifiedAt: verifiedAt && !Number.isNaN(verifiedAt.getTime()) ? verifiedAt : undefined,
  };

  if (!details.accountNumber || !details.ifscCode) {
    details.verified = false;
    details.verificationStatus = undefined;
    details.verificationMessage = undefined;
    details.verificationReferenceId = undefined;
    details.verificationUtr = undefined;
    details.verifiedAt = undefined;
  }

  return details;
};

const sanitizeVerificationRecordSection = (
  source: any = {},
  fallback: Record<string, any> = {},
) => {
  const number = String(source?.number ?? fallback?.number ?? "").trim().toUpperCase();
  const verified = normalizeBoolean(
    source?.verified,
    normalizeBoolean(fallback?.verified, false),
  );
  const status = String(source?.status ?? fallback?.status ?? "").trim();
  const message = String(source?.message ?? fallback?.message ?? "").trim();
  const referenceId = String(
    source?.referenceId ?? fallback?.referenceId ?? "",
  ).trim();
  const linkedAadhaarMasked = String(
    source?.linkedAadhaarMasked ?? fallback?.linkedAadhaarMasked ?? "",
  ).trim();
  const legalName = String(source?.legalName ?? fallback?.legalName ?? "").trim();
  const tradeName = String(source?.tradeName ?? fallback?.tradeName ?? "").trim();
  const verifiedAtRaw = source?.verifiedAt ?? fallback?.verifiedAt;
  const verifiedAt = verifiedAtRaw ? new Date(verifiedAtRaw) : undefined;
  const raw = source?.raw ?? fallback?.raw;

  const hasAnyValue = [
    number,
    verified,
    status,
    message,
    referenceId,
    linkedAadhaarMasked,
    legalName,
    tradeName,
    verifiedAt,
    raw,
  ].some(Boolean);

  if (!hasAnyValue) return undefined;

  return {
    number: number || undefined,
    verified: Boolean(verified),
    status: status || undefined,
    message: message || undefined,
    referenceId: referenceId || undefined,
    linkedAadhaarMasked: linkedAadhaarMasked || undefined,
    legalName: legalName || undefined,
    tradeName: tradeName || undefined,
    verifiedAt: verifiedAt && !Number.isNaN(verifiedAt.getTime()) ? verifiedAt : undefined,
    raw: raw || undefined,
  };
};

const sanitizeVerificationRecords = (
  payload: any,
  options?: { fallback?: Record<string, any> },
) => {
  const source = payload?.verificationRecords || payload;
  const fallback = options?.fallback || {};

  const pan = sanitizeVerificationRecordSection(source?.pan, fallback?.pan);
  const aadhaar = sanitizeVerificationRecordSection(
    source?.aadhaar,
    fallback?.aadhaar,
  );
  const gst = sanitizeVerificationRecordSection(source?.gst, fallback?.gst);

  if (!pan && !aadhaar && !gst) return undefined;
  return { pan, aadhaar, gst };
};

const sanitizeAgencyCreatePayload = (payload: any = {}) => {
  const role =
    normalizeRole(payload.role) || (payload.parentAgency ? "agency_member" : "agency");
  const status = normalizeStatus(payload.status) || UserStatus.PENDING_VERIFICATION;
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const name = String(payload.name || "").trim();
  const mobile = String(payload.mobile || "").trim();

  if (!name) throw new ApiError(400, "Name is required");
  if (!email) throw new ApiError(400, "Email is required");
  if (!mobile) throw new ApiError(400, "Mobile is required");

  const next: Record<string, any> = {
    name,
    email,
    mobile,
    role,
    status,
    gender: normalizeGender(payload.gender) || Gender.PREFER_NOT_TO_SAY,
    parentAgency: payload.parentAgency || undefined,
    avatar: payload.avatar,
    profilePictureUrl: payload.profilePictureUrl,
    isEmailVerified: normalizeBoolean(payload.isEmailVerified, false),
    isMobileVerified: normalizeBoolean(payload.isMobileVerified, false),
    agreedToTerms: normalizeBoolean(payload.agreedToTerms, true),
    privacyPolicyAccepted: normalizeBoolean(payload.privacyPolicyAccepted, true),
  };

  if (payload.rmName !== undefined) next.rmName = String(payload.rmName).trim();
  if (payload.rmMobile !== undefined)
    next.rmMobile = String(payload.rmMobile).trim();
  if (payload.agentProfileCompleted !== undefined) {
    next.agentProfileCompleted = normalizeBoolean(
      payload.agentProfileCompleted,
      false,
    );
  }

  const bankDetails = sanitizeBankDetails(payload);
  if (bankDetails) next.bankDetails = bankDetails;

  const verificationRecords = sanitizeVerificationRecords(payload);
  if (verificationRecords) next.verificationRecords = verificationRecords;

  if (payload.password) next.password = String(payload.password);
  if (role === "agency") next.parentAgency = undefined;

  return next;
};

const sanitizeAgencyUpdatePayload = (
  payload: any = {},
  options?: { fallback?: Record<string, any> },
) => {
  const next: Record<string, any> = {};
  const fallback = options?.fallback || {};

  if (payload.name !== undefined) next.name = payload.name;
  if (payload.email !== undefined)
    next.email = String(payload.email).trim().toLowerCase();
  if (payload.mobile !== undefined) next.mobile = payload.mobile;
  if (payload.rmName !== undefined) next.rmName = String(payload.rmName).trim();
  if (payload.rmMobile !== undefined)
    next.rmMobile = String(payload.rmMobile).trim();
  if (payload.agentProfileCompleted !== undefined) {
    next.agentProfileCompleted = normalizeBoolean(
      payload.agentProfileCompleted,
      false,
    );
  }
  if (payload.gender !== undefined) {
    const gender = normalizeGender(payload.gender);
    if (!gender) throw new ApiError(400, "Invalid gender");
    next.gender = gender;
  }
  if (payload.avatar !== undefined) next.avatar = payload.avatar;
  if (payload.profilePictureUrl !== undefined) {
    next.profilePictureUrl = payload.profilePictureUrl;
  }
  if (payload.parentAgency !== undefined) {
    next.parentAgency = payload.parentAgency || undefined;
  }

  if (payload.role !== undefined) {
    const role = normalizeRole(payload.role);
    if (!role) throw new ApiError(400, "Invalid role");
    next.role = role;
    if (role === "agency") next.parentAgency = undefined;
  }

  if (payload.status !== undefined) {
    const status = normalizeStatus(payload.status);
    if (!status) throw new ApiError(400, "Invalid status");
    next.status = status;
  }

  if (payload.isEmailVerified !== undefined) {
    next.isEmailVerified = normalizeBoolean(payload.isEmailVerified, false);
  }
  if (payload.isMobileVerified !== undefined) {
    next.isMobileVerified = normalizeBoolean(payload.isMobileVerified, false);
  }
  if (payload.agreedToTerms !== undefined) {
    next.agreedToTerms = normalizeBoolean(payload.agreedToTerms, false);
  }
  if (payload.privacyPolicyAccepted !== undefined) {
    next.privacyPolicyAccepted = normalizeBoolean(
      payload.privacyPolicyAccepted,
      false,
    );
  }

  if (payload.bankDetails !== undefined) {
    next.bankDetails = sanitizeBankDetails(payload, {
      fallback: fallback.bankDetails,
    });
  }
  if (payload.verificationRecords !== undefined) {
    next.verificationRecords = sanitizeVerificationRecords(payload, {
      fallback: fallback.verificationRecords,
    });
  }

  return next;
};

export class AgencyAdminController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = sanitizeAgencyCreatePayload(req.body);

      if (payload.role === "agency_member" && !payload.parentAgency) {
        return res
          .status(400)
          .json(new ApiError(400, "Parent agency is required for agency member"));
      }

      if (payload.parentAgency) {
        const parent = await Agency.findById(payload.parentAgency).select(
          "_id role",
        );
        if (!parent) {
          return res.status(404).json(new ApiError(404, "Parent agency not found"));
        }
      }

      const existing = await Agency.findOne({
        $or: [{ mobile: payload.mobile }, { email: payload.email }],
      }).select("_id mobile email");
      if (existing) {
        return res
          .status(409)
          .json(new ApiError(409, "Agency with mobile/email already exists"));
      }

      const result = await agencyService.create(payload);
      return res
        .status(201)
        .json(new ApiResponse(201, result, "Channel created successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const pipeline = [
        {
          $lookup: {
            from: "agencies",
            localField: "parentAgency",
            foreignField: "_id",
            as: "parentAgencyData",
          },
        },
        {
          $lookup: {
            from: "agencycommissiontransactions",
            let: { agencyId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$ownerAgency", "$$agencyId"],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  totalCommission: { $sum: "$commissionAmount" },
                  earnedCommission: {
                    $sum: {
                      $cond: [
                        { $eq: ["$earningStatus", "earned"] },
                        "$commissionAmount",
                        0,
                      ],
                    },
                  },
                  paidCommission: {
                    $sum: {
                      $cond: [
                        { $eq: ["$earningStatus", "paid"] },
                        "$commissionAmount",
                        0,
                      ],
                    },
                  },
                  totalCases: { $sum: 1 },
                  paidCases: {
                    $sum: {
                      $cond: [{ $eq: ["$earningStatus", "paid"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            as: "commissionStats",
          },
        },
        {
          $unwind: {
            path: "$parentAgencyData",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            commissionStats: {
              $ifNull: [
                { $arrayElemAt: ["$commissionStats", 0] },
                {
                  totalCommission: 0,
                  earnedCommission: 0,
                  paidCommission: 0,
                  totalCases: 0,
                  paidCases: 0,
                },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            agencyId: 1,
            name: 1,
            email: 1,
            mobile: 1,
            role: 1,
            status: 1,
            gender: 1,
            parentAgency: 1,
            parentAgencyName: "$parentAgencyData.name",
            rmName: 1,
            rmMobile: 1,
            agentProfileCompleted: 1,
            agreedToTerms: 1,
            privacyPolicyAccepted: 1,
            isEmailVerified: 1,
            isMobileVerified: 1,
            bankDetails: 1,
            verificationRecords: 1,
            kycProfile: 1,
            digiLockerVault: 1,
            createdAt: 1,
            updatedAt: 1,
            totalCommission: "$commissionStats.totalCommission",
            earnedCommission: "$commissionStats.earnedCommission",
            paidCommission: "$commissionStats.paidCommission",
            totalCommissionCases: "$commissionStats.totalCases",
            paidCommissionCases: "$commissionStats.paidCases",
            pendingCommissionCases: {
              $subtract: [
                "$commissionStats.totalCases",
                "$commissionStats.paidCases",
              ],
            },
          },
        },
      ];

      const result = await agencyService.getAll(req.query, pipeline);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channels fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyService.getById(req.params.id, {
        path: "parentAgency",
        select: "name email mobile status",
      });
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const current = await Agency.findById(req.params.id).select(
        "parentAgency bankDetails verificationRecords",
      );
      const payload = sanitizeAgencyUpdatePayload(req.body, {
        fallback: current?.toObject ? current.toObject() : current || {},
      });
      if (!Object.keys(payload).length) {
        return res
          .status(400)
          .json(new ApiError(400, "No valid fields provided to update"));
      }

      const nextRole = payload.role;
      if (nextRole === "agency_member" && !payload.parentAgency) {
        if (!current?.parentAgency) {
          return res
            .status(400)
            .json(new ApiError(400, "Parent agency is required for agency member"));
        }
      }

      if (payload.parentAgency) {
        if (String(payload.parentAgency) === String(req.params.id)) {
          return res
            .status(400)
            .json(new ApiError(400, "Parent agency cannot be the same channel"));
        }
        const parent = await Agency.findById(payload.parentAgency).select("_id");
        if (!parent) {
          return res.status(404).json(new ApiError(404, "Parent agency not found"));
        }
      }

      const result = await agencyService.updateById(req.params.id, payload);
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = normalizeStatus(req.body?.status);
      if (!status) {
        return res.status(400).json(new ApiError(400, "Invalid status"));
      }

      const result = await agencyService.updateById(req.params.id, { status });
      if (!result) {
        return res.status(404).json(new ApiError(404, "Channel not found"));
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel status updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const childCount = await Agency.countDocuments({
        parentAgency: req.params.id,
      });
      if (childCount > 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Channel has members and cannot be deleted"));
      }

      const result = await agencyService.deleteById(req.params.id);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel deleted successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async verifyBankAccount(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      ensureVerificationConsent(req.body?.consent);
      const payload = prepareSurepassPennyDropPayload(req.body || {});
      const verification = await fetchSurepassPennyDropVerification(payload);
      const responseData: any = verification?.data || {};
      const normalizedData: any =
        responseData?.data ||
        responseData?.result ||
        responseData?.details ||
        responseData;

      const accountExists =
        normalizedData?.account_exists ??
        normalizedData?.accountExists ??
        normalizedData?.verified ??
        normalizedData?.success;

      if (accountExists === false) {
        return res
          .status(400)
          .json(new ApiError(400, "Bank account verification failed", responseData));
      }

      const bankDetails = {
        accountNumber: payload.account_number,
        ifscCode: payload.ifsc,
        accountHolderName:
          normalizedData?.name_at_bank ||
          normalizedData?.account_holder_name ||
          normalizedData?.beneficiary_name ||
          payload.name ||
          "",
        bankName:
          normalizedData?.bank_name || normalizedData?.bankName || "",
        branchName:
          normalizedData?.branch_name || normalizedData?.branch || "",
        verified: true,
        verificationStatus:
          String(
            normalizedData?.verification_status ||
              normalizedData?.status ||
              responseData?.status ||
              "verified",
          ).trim() || "verified",
        verificationMessage:
          normalizedData?.message || responseData?.message || "Bank verified",
        verificationReferenceId:
          normalizedData?.reference_id ||
          normalizedData?.referenceId ||
          responseData?.reference_id ||
          responseData?.referenceId ||
          "",
        verificationUtr:
          normalizedData?.utr || normalizedData?.transaction_id || "",
        verifiedAt: new Date(),
      };

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            environment: verification.environment,
            bankDetails,
            providerResponse: responseData,
          },
          "Bank account verified successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async verifyPan(req: Request, res: Response, next: NextFunction) {
    try {
      ensureVerificationConsent(req.body?.consent);
      const payload = prepareSurepassPanVerificationPayload(req.body || {});
      const verification = await fetchSurepassPanVerification(payload);
      const responseData: any = verification?.data || {};
      const normalizedData: any =
        responseData?.data || responseData?.result || responseData;

      const panRecord = {
        number: payload.id_number,
        verified: true,
        status: String(
          normalizedData?.status || responseData?.status || "verified",
        ).trim(),
        message: normalizedData?.message || responseData?.message || "PAN verified",
        referenceId:
          normalizedData?.reference_id ||
          normalizedData?.referenceId ||
          responseData?.reference_id ||
          responseData?.referenceId ||
          "",
        linkedAadhaarMasked:
          normalizedData?.aadhaar_linked ||
          normalizedData?.aadhaar_number ||
          normalizedData?.masked_aadhaar ||
          "",
        legalName:
          normalizedData?.full_name ||
          normalizedData?.name_on_card ||
          normalizedData?.legal_name ||
          "",
        verifiedAt: new Date(),
        raw: responseData,
      };

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { environment: verification.environment, pan: panRecord },
            "PAN verified successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async verifyAadhaar(req: Request, res: Response, next: NextFunction) {
    try {
      ensureVerificationConsent(req.body?.consent);
      const panPayload = prepareSurepassPanVerificationPayload(req.body || {});
      const aadhaarNumber = String(req.body?.aadhaarNumber || "")
        .replace(/\D/g, "")
        .trim();

      if (!aadhaarNumber || aadhaarNumber.length !== 12) {
        return res
          .status(400)
          .json(new ApiError(400, "Aadhaar number must be 12 digits"));
      }

      const verification = await fetchSurepassPanToAadhaar({
        id_number: panPayload.id_number,
      });
      const responseData: any = verification?.data || {};
      const normalizedData: any =
        responseData?.data || responseData?.result || responseData;
      const linkedMasked =
        String(
          normalizedData?.aadhaar_number ||
            normalizedData?.masked_aadhaar ||
            normalizedData?.aadhaar_linked ||
            "",
        ).trim();
      const isMatch =
        !linkedMasked ||
        linkedMasked
          .replace(/\D/g, "")
          .slice(-4) === aadhaarNumber.slice(-4);

      if (!isMatch) {
        return res
          .status(400)
          .json(new ApiError(400, "Aadhaar does not match linked record", responseData));
      }

      const aadhaarRecord = {
        number: aadhaarNumber,
        verified: true,
        status: String(
          normalizedData?.status || responseData?.status || "verified",
        ).trim(),
        message:
          normalizedData?.message ||
          responseData?.message ||
          "Aadhaar linkage verified",
        referenceId:
          normalizedData?.reference_id ||
          normalizedData?.referenceId ||
          responseData?.reference_id ||
          responseData?.referenceId ||
          "",
        verifiedAt: new Date(),
        raw: responseData,
      };

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { environment: verification.environment, aadhaar: aadhaarRecord },
            "Aadhaar verified successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async verifyGst(req: Request, res: Response, next: NextFunction) {
    try {
      ensureVerificationConsent(req.body?.consent);
      const payload = prepareSurepassGstinPayload(req.body || {});
      const verification = await fetchSurepassGstinVerification(payload);
      const responseData: any = verification?.data || {};
      const normalizedData: any =
        responseData?.data || responseData?.result || responseData;

      const gstRecord = {
        number: payload.id_number,
        verified: true,
        status: String(
          normalizedData?.status || responseData?.status || "verified",
        ).trim(),
        message: normalizedData?.message || responseData?.message || "GST verified",
        referenceId:
          normalizedData?.reference_id ||
          normalizedData?.referenceId ||
          responseData?.reference_id ||
          responseData?.referenceId ||
          "",
        legalName:
          normalizedData?.legal_name ||
          normalizedData?.lgnm ||
          normalizedData?.taxpayer_name ||
          "",
        tradeName:
          normalizedData?.trade_name ||
          normalizedData?.tradeNam ||
          normalizedData?.trade_name_of_business ||
          "",
        verifiedAt: new Date(),
        raw: responseData,
      };

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { environment: verification.environment, gst: gstRecord },
            "GST verified successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async uploadBankDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const document = req.body?.document?.[0];
      if (!document?.url) {
        return res
          .status(400)
          .json(new ApiError(400, "Document upload is required"));
      }

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            url: document.url,
            name: document.name || document.originalname,
            mimetype: document.mimetype,
            size: document.size,
          },
          "Document uploaded successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getEarnings(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const tabRaw = String(req.query?.tab || "earned").toLowerCase();
      const tab = tabRaw === "paid" ? "paid" : tabRaw === "projected" ? "projected" : "earned";
      const from = typeof req.query?.from === "string" ? req.query.from : undefined;
      const to = typeof req.query?.to === "string" ? req.query.to : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 20;
      const result = await agencyEarningsService.getAgencyEarningsForAdmin({
        agencyId: id,
        tab,
        from,
        to,
        page,
        limit,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Channel earnings fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async markEarningPaid(req: Request | any, res: Response, next: NextFunction) {
    try {
      const transactionId = req.params.transactionId;
      const adminId = req.user?._id;
      const paymentReference = req.body?.paymentReference;
      const notes = req.body?.notes;

      const transaction = await agencyEarningsService.markCommissionPaid({
        transactionId,
        paymentReference,
        notes,
        adminId,
      });

      return res
        .status(200)
        .json(new ApiResponse(200, transaction, "Commission marked as paid"));
    } catch (error) {
      next(error);
    }
  }

  static async listCommissionTransactions(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { agencyId, status, page = "1", limit = "20" } = req.query;
      const filter: Record<string, any> = {};
      if (typeof agencyId === "string" && agencyId.trim()) {
        filter.ownerAgency = agencyId.trim();
      }
      if (
        typeof status === "string" &&
        ["earned", "paid"].includes(status.trim())
      ) {
        filter.earningStatus = status.trim();
      }

      const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const [result, total] = await Promise.all([
        AgencyCommissionTransaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .populate("ownerAgency", "name mobile email role")
          .populate("sourceAgency", "name mobile email role")
          .lean(),
        AgencyCommissionTransaction.countDocuments(filter),
      ]);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            result,
            pagination: {
              totalItems: total,
              totalPages: Math.ceil(total / limitNum) || 1,
              currentPage: pageNum,
              itemsPerPage: limitNum,
            },
          },
          "Commission transactions fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}
