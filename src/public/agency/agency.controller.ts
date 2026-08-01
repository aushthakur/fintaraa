import crypto from "crypto";
import Otp from "../../modals/otp.model";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import { logger } from "../../config/logger";
import { maskMobileForLogs, sendSMS } from "../../utils/smsService";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { Request, Response, NextFunction } from "express";
import { UserType } from "../../modals/notification.model";
import { Agency, AgencyRole } from "../../modals/agency.model";
import { CommonService } from "../../services/common.services";
import { User, UserStatus, IKycProfile } from "../../modals/user.model";
import { agencyEarningsService } from "../../services/agencyEarnings.service";
import { agencyLeadsService } from "../../services/agencyLeads.service";
import { agencyPayoutService } from "../../services/agencyPayout.service";
import { applyEncryptedAgencyBankDetails } from "../../services/agencyBankDetails.service";
import { sendSingleNotification } from "../../services/notification.service";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";
import {
  consumeOtpRequest,
  releaseOtpRequest,
} from "../../services/otpRateLimit.service";
import {
  assertOtpVerificationAllowed,
  recordOtpVerificationFailure,
  resetOtpVerificationAttempts,
} from "../../services/otpVerificationLimit.service";

const agencyService = new CommonService(Agency);
const usesStaticOtp = (mobile: string) =>
  config.env !== "production" &&
  Boolean(config.otp.staticMobile && config.otp.staticCode) &&
  String(mobile || "")
    .replace(/\D/g, "")
    .endsWith(config.otp.staticMobile);

const parseJSONSafely = <T>(value: any, fallback: T): T => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const normalizeBoolean = (value: any, fallback: boolean) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
};

const normalizePushPlatform = (
  value: unknown,
): "ios" | "android" | "web" | "unknown" => {
  const platform = String(value || "").trim().toLowerCase();
  return platform === "ios" || platform === "android" || platform === "web"
    ? platform
    : "unknown";
};

const toArrayPayload = (value: any): any[] => {
  if (!value && value !== 0) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [value];
    }
  }
  return [value];
};

const resolveDocPasswordKey = () => {
  const raw = config.documents?.passwordEncryptionKey || "";
  if (!raw) return null;
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) return base64;
  const hex = Buffer.from(raw, "hex");
  if (hex.length === 32) return hex;
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  return null;
};

const encryptDocumentPassword = (value?: string) => {
  if (!value) return undefined;
  const key = resolveDocPasswordKey();
  if (!key) {
    throw new ApiError(
      500,
      "Document password encryption key missing or invalid. Set DOC_PASSWORD_KEY (32 bytes).",
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString(
    "base64",
  )}:${encrypted.toString("base64")}`;
};

const normalizeDocumentEntries = (
  docs: any,
  fallbackType = "supporting_document",
) => {
  return toArrayPayload(docs)
    .map((doc: any) => {
      if (!doc) return null;
      if (typeof doc === "string")
        return { docType: fallbackType, fileUrl: doc };
      return {
        docType: doc.docType || doc.type || fallbackType,
        number: doc.number || doc.docNumber,
        password: encryptDocumentPassword(doc.password || doc.docPassword),
        issuer: doc.issuer || doc.issuedBy || "user_provided",
        fileUrl: doc.fileUrl || doc.url,
        issuedOn: doc.issuedOn || doc.issueDate,
        referenceId: doc.referenceId || doc.name,
        verified: doc.verified ?? false,
      };
    })
    .filter((doc: any) => doc?.docType && (doc.fileUrl || doc.number));
};

const mapUploadsToDocuments = (
  uploads: any,
  fallbackType = "supporting_document",
  meta?: {
    docNumbers?: any[];
    docPasswords?: any[];
    docTypes?: any[];
    docNames?: any[];
  },
) => {
  const docNumbers = meta?.docNumbers || [];
  const docPasswords = meta?.docPasswords || [];
  const docTypes = meta?.docTypes || [];
  const docNames = meta?.docNames || [];
  return toArrayPayload(uploads)
    .map((file: any, index: number) => ({
      docType: file?.docType || docTypes[index] || fallbackType,
      fileUrl: file?.url,
      number: file?.number || docNumbers[index],
      password: encryptDocumentPassword(file?.password || docPasswords[index]),
      issuer: file?.issuer || "user_uploaded",
      referenceId: file?.name || docNames[index],
      verified: false,
    }))
    .filter((doc: any) => doc.fileUrl);
};

const mergeDocuments = (existing: any[] = [], incoming: any[] = []) => {
  const map = new Map<string, any>();
  [...existing, ...incoming].forEach((doc) => {
    if (!doc) return;
    const key = `${doc.docType}-${
      doc.number || doc.fileUrl || doc.referenceId
    }`;
    map.set(key, { ...(map.get(key) || {}), ...doc });
  });
  return Array.from(map.values());
};

const safeNotify = async (payload: {
  type: string;
  toUserId: string;
  toRole: UserType;
  context?: Record<string, string | number>;
  fromUser?: { _id: string; role: UserType };
}) => {
  try {
    await sendSingleNotification({
      type: payload.type,
      toUserId: payload.toUserId,
      toRole: payload.toRole,
      fromUser: payload.fromUser,
      context: payload.context || {},
    });
  } catch (error: any) {
    console.log(
      `[Notification] Failed to send ${payload.type}: ${error?.message || error}`,
    );
  }
};

const hasMeaningfulValue = (value: any): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  return true;
};

const resolveAgencyStatusInput = (value: any): UserStatus | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") {
    return value ? UserStatus.ACTIVE : UserStatus.INACTIVE;
  }

  const normalized = String(value).trim().toLowerCase();
  if (
    ["active", "activate", "activated", "enable", "enabled", "1", "true"].includes(
      normalized,
    )
  ) {
    return UserStatus.ACTIVE;
  }
  if (
    ["inactive", "deactivate", "disabled", "disable", "0", "false"].includes(
      normalized,
    )
  ) {
    return UserStatus.INACTIVE;
  }
  if (["deactivated", "blocked"].includes(normalized)) {
    return UserStatus.DEACTIVATED;
  }
  if (["suspended", "suspend"].includes(normalized)) {
    return UserStatus.SUSPENDED;
  }
  if (["pending", "pending_verification", "pending-verification"].includes(normalized)) {
    return UserStatus.PENDING_VERIFICATION;
  }
  return undefined;
};

const evaluateAgencyProfileCompletion = (agency: any) => {
  const kyc = agency?.kycProfile || {};
  const personal = kyc?.personalDetails || {};
  const employment = kyc?.employmentDetails || agency?.employmentDetails || {};
  const bank = agency?.bankDetails || kyc?.bankDetails || {};
  const addressDetails = kyc?.addressDetails || agency?.addressDetails || {};
  const currentAddress =
    addressDetails?.currentAddress || addressDetails?.address || addressDetails || {};
  const firstAddress = Array.isArray(agency?.addresses) ? agency.addresses?.[0] : null;

  const mergedAddress = {
    address:
      personal?.address ||
      currentAddress?.address ||
      currentAddress?.street ||
      firstAddress?.street ||
      firstAddress?.address,
    city: personal?.city || currentAddress?.city || firstAddress?.city,
    state: personal?.state || currentAddress?.state || firstAddress?.state,
    pinCode:
      personal?.pinCode ||
      personal?.pincode ||
      currentAddress?.pinCode ||
      currentAddress?.pincode ||
      currentAddress?.postalCode ||
      firstAddress?.pinCode ||
      firstAddress?.pincode ||
      firstAddress?.postalCode,
  };

  const docTypes = new Set<string>();
  const kycDocuments = Array.isArray(kyc?.documents) ? kyc.documents : [];
  const vaultDocuments = Array.isArray(agency?.digiLockerVault?.documents)
    ? agency.digiLockerVault.documents
    : [];
  [...kycDocuments, ...vaultDocuments].forEach((doc: any) => {
    if (!doc?.docType) return;
    docTypes.add(String(doc.docType).toLowerCase().trim());
  });

  const checks = [
    { key: "full_name", ok: hasMeaningfulValue(personal?.fullName || agency?.name) },
    { key: "pan_number", ok: hasMeaningfulValue(personal?.panNumber) },
    { key: "aadhaar_number", ok: hasMeaningfulValue(personal?.aadhaarNumber) },
    { key: "mobile", ok: hasMeaningfulValue(personal?.mobile || agency?.mobile) },
    { key: "email", ok: hasMeaningfulValue(personal?.email || agency?.email) },
    { key: "address", ok: hasMeaningfulValue(mergedAddress.address) },
    { key: "city", ok: hasMeaningfulValue(mergedAddress.city) },
    { key: "state", ok: hasMeaningfulValue(mergedAddress.state) },
    { key: "pin_code", ok: hasMeaningfulValue(mergedAddress.pinCode) },
    { key: "business_name", ok: hasMeaningfulValue(employment?.employerName) },
    { key: "business_address", ok: hasMeaningfulValue(employment?.companyAddress) },
    { key: "total_experience", ok: hasMeaningfulValue(employment?.totalExperience) },
    { key: "bank_holder", ok: hasMeaningfulValue(bank?.accountHolderName) },
    { key: "bank_name", ok: hasMeaningfulValue(bank?.bankName) },
    { key: "bank_account_type", ok: hasMeaningfulValue(bank?.accountType) },
    { key: "bank_account_number", ok: hasMeaningfulValue(bank?.accountNumber) },
    { key: "bank_ifsc", ok: hasMeaningfulValue(bank?.ifscCode) },
    {
      key: "cancelled_cheque",
      ok:
        hasMeaningfulValue(bank?.cancelledChequeUrl) ||
        docTypes.has("cancelled_cheque"),
    },
    { key: "pan_document", ok: docTypes.has("pan_card") },
    { key: "aadhaar_document", ok: docTypes.has("aadhaar_card") },
  ];

  const completedFields = checks.filter((item) => item.ok).length;
  const totalFields = checks.length;
  const completionPercent = totalFields
    ? Math.round((completedFields / totalFields) * 100)
    : 0;

  return {
    completedFields,
    totalFields,
    completionPercent,
    missingFields: checks.filter((item) => !item.ok).map((item) => item.key),
    isComplete: completedFields === totalFields,
  };
};

const withAgencyProfileMeta = (agency: any) => {
  const plain = agency?.toObject ? agency.toObject() : { ...(agency || {}) };
  const profileCompletion = evaluateAgencyProfileCompletion(plain);
  return {
    ...plain,
    agentProfileCompleted: profileCompletion.isComplete,
    requiresKycCompletion: !profileCompletion.isComplete,
    profileCompletion,
  };
};

const maskAccountNumber = (value: any) => {
  const normalized = String(value || "").replace(/\s+/g, "");
  if (!normalized) return undefined;
  return `••••${normalized.slice(-4)}`;
};

const stripDocumentSecrets = (documents: any) =>
  (Array.isArray(documents) ? documents : []).map((document: any) => {
    const plain = document?.toObject ? document.toObject() : { ...(document || {}) };
    delete plain.password;
    delete plain.raw;
    delete plain.parsedData;
    return plain;
  });

const sanitizeAgencyForSelf = (agency: any) => {
  const plain = agency?.toObject ? agency.toObject() : { ...(agency || {}) };
  const kyc = plain.kycProfile || {};
  const vault = plain.digiLockerVault || {};
  const bank = plain.bankDetails || {};
  const verificationRecords = plain.verificationRecords || {};
  const profileCompletion = evaluateAgencyProfileCompletion(plain);
  const cleanVerification = (record: any) => {
    if (!record) return undefined;
    const { raw, ...safe } = record;
    return safe;
  };
  return {
    _id: plain._id,
    agencyId: plain.agencyId,
    referralCode: plain.referralCode,
    name: plain.name,
    businessName: plain.businessName,
    gstin: plain.gstin,
    email: plain.email,
    mobile: plain.mobile,
    role: plain.role,
    parentAgency: plain.parentAgency,
    status: plain.status,
    onboardingStatus:
      plain.status === UserStatus.ACTIVE &&
      plain.approvalReview?.status !== "rejected"
        ? "approved"
        : plain.approvalReview?.status || "pending",
    rejectionReason: plain.approvalReview?.rejectionReason,
    reviewNotes: plain.approvalReview?.notes,
    avatar: plain.avatar,
    profilePictureUrl: plain.profilePictureUrl,
    agreedToTerms: plain.agreedToTerms,
    privacyPolicyAccepted: plain.privacyPolicyAccepted,
    isEmailVerified: plain.isEmailVerified,
    isMobileVerified: plain.isMobileVerified,
    gender: plain.gender,
    notification: plain.notification,
    rmName: plain.rmName,
    rmMobile: plain.rmMobile,
    addresses: plain.addresses,
    bankDetails: Object.keys(bank).length
      ? {
          bankName: bank.bankName,
          branchName: bank.branchName,
          branchCity: bank.branchCity,
          accountType: bank.accountType,
          accountNumber: maskAccountNumber(bank.accountNumber),
          accountHolderName: bank.accountHolderName,
          ifscCode: bank.ifscCode,
          cancelledChequeUrl: bank.cancelledChequeUrl,
          verified: Boolean(bank.verified),
          verificationStatus: bank.verificationStatus,
          verificationMessage: bank.verificationMessage,
          verifiedAt: bank.verifiedAt,
        }
      : undefined,
    verificationRecords: {
      pan: cleanVerification(verificationRecords.pan),
      aadhaar: cleanVerification(verificationRecords.aadhaar),
      gst: cleanVerification(verificationRecords.gst),
    },
    kycProfile: {
      ...kyc,
      documents: stripDocumentSecrets(kyc.documents),
    },
    digiLockerVault: {
      ...vault,
      documents: stripDocumentSecrets(vault.documents),
    },
    agentProfileCompleted: profileCompletion.isComplete,
    requiresKycCompletion: !profileCompletion.isComplete,
    profileCompletion,
    onboardingSubmittedAt: plain.onboardingSubmittedAt,
    lastLoginAt: plain.lastLoginAt,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

export class AgencyController {
  static async sendOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        mobile: rawMobile,
        name,
        email,
        parentAgencyId,
        businessName,
        gstin: rawGstin,
        acceptedTerms,
        intent: rawIntent,
      } = req.body;
      if (!rawMobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }
      const mobile = await consumeOtpRequest(rawMobile, "agency");
      const isDsaAuth = String(req.originalUrl || "").includes("/dsa/");
      const intent = String(rawIntent || (isDsaAuth ? "login" : "register"))
        .trim()
        .toLowerCase();
      if (isDsaAuth && !["login", "register"].includes(intent)) {
        await releaseOtpRequest(mobile, "agency");
        return res.status(400).json({ success: false, message: "Intent must be login or register" });
      }

      let agency: any = await Agency.findOne({ mobile });
      const isNew = !agency;
      if (isDsaAuth && intent === "login" && !agency) {
        await releaseOtpRequest(mobile, "agency");
        return res.status(404).json({ success: false, message: "DSA account not found. Please register first." });
      }
      const isDsaRegistrationResend = Boolean(
        isDsaAuth &&
          intent === "register" &&
          agency &&
          !agency.isMobileVerified &&
          agency.status === UserStatus.PENDING_VERIFICATION,
      );
      if (isDsaAuth && intent === "register" && agency && !isDsaRegistrationResend) {
        await releaseOtpRequest(mobile, "agency");
        return res.status(409).json({
          success: false,
          message: "A DSA account already exists for this mobile. Please log in.",
        });
      }
      const gstin = String(rawGstin || "").trim().toUpperCase();
      if (isDsaAuth && intent === "register" && !agency) {
        const normalizedEmail = String(email || "").trim().toLowerCase();
        if (!String(name || "").trim() || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
          await releaseOtpRequest(mobile, "agency");
          return res.status(400).json({ success: false, message: "Name and valid email are required for registration" });
        }
        if (![true, "true", "1", "yes"].includes(acceptedTerms)) {
          await releaseOtpRequest(mobile, "agency");
          return res.status(400).json({ success: false, message: "Terms and privacy consent are required" });
        }
        if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
          await releaseOtpRequest(mobile, "agency");
          return res.status(400).json({ success: false, message: "Invalid GSTIN" });
        }
        const duplicateEmail = await Agency.exists({ email: normalizedEmail });
        if (duplicateEmail) {
          await releaseOtpRequest(mobile, "agency");
          return res.status(409).json({ success: false, message: "Email already in use" });
        }
      }
      if (!agency) {
        const placeholderEmail = String(email || `${mobile}@agency.fintara`).trim().toLowerCase();
        const role: AgencyRole = parentAgencyId ? "agency_member" : "agency";
        try {
          agency = await Agency.create({
            mobile,
            role,
            parentAgency: parentAgencyId || undefined,
            agreedToTerms: true,
            privacyPolicyAccepted: true,
            name: name || `Agency ${mobile.slice(-4)}`,
            email: placeholderEmail,
            businessName: String(businessName || "").trim() || undefined,
            gstin: gstin || undefined,
            ...(gstin ? { verificationRecords: { gst: { number: gstin } } } : {}),
            status: UserStatus.PENDING_VERIFICATION,
            password: crypto.randomBytes(10).toString("hex"),
          });
        } catch (error: any) {
          if (error?.code === 11000) {
            await releaseOtpRequest(mobile, "agency");
            const duplicateField = error?.keyPattern?.email ? "Email" : "Mobile";
            return res.status(409).json({ success: false, message: `${duplicateField} already in use` });
          }
          throw error;
        }
      } else {
        const updates: Record<string, any> = {};

        if (
          !isDsaRegistrationResend &&
          name &&
          (!isDsaAuth || intent === "register") &&
          (!agency.name || agency.status === UserStatus.PENDING_VERIFICATION)
        ) {
          updates.name = name;
        }

        if (
          !isDsaRegistrationResend &&
          email &&
          (!isDsaAuth || intent === "register")
        ) {
          const normalizedEmail = String(email).trim().toLowerCase();
          if (normalizedEmail && normalizedEmail !== agency.email) {
            const duplicateEmail = await Agency.findOne({
              _id: { $ne: agency._id },
              email: normalizedEmail,
            }).select("_id");
            if (duplicateEmail) {
              return res
                .status(409)
                .json({ success: false, message: "Email already in use" });
            }
            updates.email = normalizedEmail;
          }
        }

        if (!isDsaAuth && parentAgencyId !== undefined) {
          updates.parentAgency = parentAgencyId || undefined;
          updates.role = parentAgencyId ? "agency_member" : "agency";
        }
        if (
          !isDsaRegistrationResend &&
          (!isDsaAuth || intent === "register") &&
          businessName !== undefined
        ) {
          updates.businessName = String(businessName || "").trim() || undefined;
        }
        if (
          !isDsaRegistrationResend &&
          (!isDsaAuth || intent === "register") &&
          gstin
        ) {
          updates.gstin = gstin;
          updates["verificationRecords.gst.number"] = gstin;
        }

        if (Object.keys(updates).length > 0) {
          agency = await Agency.findByIdAndUpdate(agency._id, updates, {
            new: true,
          });
        }
      }

      const isStaticOtpUser = usesStaticOtp(mobile);
      const otpCode = isStaticOtpUser
        ? config.otp.staticCode
        : crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await Otp.findOneAndUpdate(
        { mobile },
        { mobile, expiresAt, otp: otpCode, verified: false },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await resetOtpVerificationAttempts(mobile, "agency", req.ip, {
        includeIp: false,
      });

      const maskedMobile = maskMobileForLogs(mobile);
      if (isStaticOtpUser) {
        logger.info(
          `[OTP][Agency] Static test OTP prepared to=${maskedMobile}; SMS dispatch skipped`,
        );
      } else {
        try {
          const dispatchResult = await sendSMS({
            to: mobile,
            otp: otpCode,
          });
          if (!dispatchResult.success) {
            throw new Error(dispatchResult.reason);
          }
          logger.info(`[OTP][Agency] SMS dispatched to=${maskedMobile}`);
        } catch (smsError: unknown) {
          const errMessage =
            smsError instanceof Error ? smsError.message : String(smsError);
          logger.error(
            `[OTP][Agency] SMS dispatch failed to=${maskedMobile} error=${errMessage}`,
          );
          await Promise.all([
            Otp.deleteOne({ mobile, otp: otpCode, verified: false }),
            releaseOtpRequest(mobile, "agency"),
          ]);
          return res.status(503).json({
            success: false,
            message: "OTP could not be sent. Please try again.",
          });
        }
      }

      return res.status(200).json({
        statusCode: 200,
        success: true,
        message: "OTP has been sent successfully",
        expiresInSeconds: 5 * 60,
        data: {
          expiresInSeconds: 5 * 60,
          isNew,
          onboardingStatus:
            agency.approvalReview?.status ||
            (agency.status === UserStatus.ACTIVE ? "approved" : "pending"),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile: rawMobile, otp } = req.body;
      if (!rawMobile || !otp) {
        return res.status(400).json({
          success: false,
          message: "Phone number and OTP are required",
        });
      }
      const mobile = String(rawMobile).replace(/\D/g, "");
      if (mobile.length < 10 || mobile.length > 15) {
        return res.status(400).json({ success: false, message: "Enter a valid mobile number" });
      }
      await assertOtpVerificationAllowed(mobile, "agency", req.ip);
      const now = new Date();
      const otpDoc: any = await Otp.findOne({ mobile }).sort({ updatedAt: -1 });
      const suppliedOtp = String(otp).trim();
      const storedOtp = String(otpDoc?.otp || "");
      const suppliedBuffer = Buffer.from(suppliedOtp);
      const storedBuffer = Buffer.from(storedOtp);
      const otpMatches =
        Boolean(otpDoc) &&
        !otpDoc.verified &&
        otpDoc.expiresAt > now &&
        suppliedBuffer.length === storedBuffer.length &&
        crypto.timingSafeEqual(suppliedBuffer, storedBuffer);

      if (!otpMatches) {
        const locked = await recordOtpVerificationFailure(mobile, "agency", req.ip);
        return res.status(locked ? 429 : 400).json({
          success: false,
          message: locked
            ? "Too many invalid OTP attempts. Request a new OTP or try again later."
            : "Invalid or expired OTP",
        });
      }

      const claimedOtp = await Otp.findOneAndUpdate(
        { _id: otpDoc._id, verified: false, expiresAt: { $gt: now } },
        { $set: { verified: true } },
        { new: true },
      );
      if (!claimedOtp) {
        const locked = await recordOtpVerificationFailure(mobile, "agency", req.ip);
        return res.status(locked ? 429 : 400).json({
          success: false,
          message: locked
            ? "Too many invalid OTP attempts. Request a new OTP or try again later."
            : "Invalid or expired OTP",
        });
      }
      await resetOtpVerificationAttempts(mobile, "agency", req.ip);

      const agency: any = await Agency.findOne({ mobile });
      if (!agency) {
        return res
          .status(404)
          .json({ success: false, message: "Agency not found" });
      }

      if (
        [UserStatus.SUSPENDED, UserStatus.INACTIVE, UserStatus.DEACTIVATED].includes(
          agency.status,
        )
      ) {
        return res
          .status(403)
          .json({ success: false, message: `Account ${agency.status}` });
      }

      agency.isMobileVerified = true;
      agency.lastLoginAt = new Date();
      await agency.save();

      const payload = {
        _id: agency._id,
        email: agency.email,
        role: agency.role || "agency",
      };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      agency.refreshToken = refreshToken;
      await agency.save();

      const completion = evaluateAgencyProfileCompletion(agency);
      if (agency.agentProfileCompleted !== completion.isComplete) {
        agency.agentProfileCompleted = completion.isComplete;
        await agency.save();
      }

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        statusCode: 200,
        success: true,
        message: "OTP verified successfully. Login complete.",
        token: accessToken,
        agency: {
          _id: agency._id,
          role: agency.role || "agency",
          email: agency.email,
          name: agency.name,
          mobile: agency.mobile,
          parentAgency: agency.parentAgency,
          agencyId: agency.agencyId,
          referralCode: agency.referralCode,
          status: agency.status,
          onboardingStatus:
            agency.status === UserStatus.ACTIVE &&
            agency.approvalReview?.status !== "rejected"
              ? "approved"
              : agency.approvalReview?.status || "pending",
          rejectionReason: agency.approvalReview?.rejectionReason,
          agentProfileCompleted: completion.isComplete,
          requiresKycCompletion: !completion.isComplete,
          profileCompletion: completion,
        },
        data: {
          token: accessToken,
          agency: {
            _id: agency._id,
            role: agency.role || "agency",
            agencyId: agency.agencyId,
            referralCode: agency.referralCode,
            email: agency.email,
            name: agency.name,
            mobile: agency.mobile,
            parentAgency: agency.parentAgency,
            status: agency.status,
            onboardingStatus:
              agency.status === UserStatus.ACTIVE &&
              agency.approvalReview?.status !== "rejected"
                ? "approved"
                : agency.approvalReview?.status || "pending",
            rejectionReason: agency.approvalReview?.rejectionReason,
            agentProfileCompleted: completion.isComplete,
            requiresKycCompletion: !completion.isComplete,
            profileCompletion: completion,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentAgency(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency = await Agency.findById(_id);
      if (!agency)
        return res.status(404).json(new ApiError(404, "Agency not found"));

      const payload = sanitizeAgencyForSelf(agency);
      if (agency?.agentProfileCompleted !== payload.agentProfileCompleted) {
        await Agency.findByIdAndUpdate(_id, {
          agentProfileCompleted: payload.agentProfileCompleted,
        });
      }

      return res
        .status(200)
        .json(
          new ApiResponse(200, payload, "Agency details fetched successfully"),
        );
    } catch (error) {
      next(error);
    }
  }

  static async getNotificationPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency = await agencyService.getById(_id);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }
      return res.status(200).json(
        new ApiResponse(
          200,
          agency.notification || {
            sms: true,
            push: true,
            email: true,
            whatsapp: true,
          },
          "Notification preferences fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async updateNotificationPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency = await agencyService.getById(_id);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }

      const nextPrefs = {
        sms:
          typeof req.body.sms === "boolean"
            ? req.body.sms
            : (agency.notification?.sms ?? true),
        push:
          typeof req.body.push === "boolean"
            ? req.body.push
            : (agency.notification?.push ?? true),
        email:
          typeof req.body.email === "boolean"
            ? req.body.email
            : (agency.notification?.email ?? true),
        whatsapp:
          typeof req.body.whatsapp === "boolean"
            ? req.body.whatsapp
            : (agency.notification?.whatsapp ?? true),
      };

      const result = await agencyService.updateById(_id, {
        notification: nextPrefs,
      });

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            result.notification,
            "Notification preferences updated successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async registerPushToken(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id || req.user?.id;
      const token = String(req.body?.token || req.body?.fcmToken || "").trim();
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!token) {
        return res.status(400).json(new ApiError(400, "FCM token is required"));
      }

      const platform = normalizePushPlatform(req.body?.platform);
      const deviceId = String(req.body?.deviceId || "").trim();
      const appVersion = String(req.body?.appVersion || "").trim();
      const now = new Date();

      await Promise.all([
        Agency.updateMany(
          {
            _id: { $ne: agencyId },
            $or: [{ fcmToken: token }, { "fcmTokens.token": token }],
          },
          {
            $unset: { fcmToken: "" },
            $pull: { fcmTokens: { token } },
          },
        ),
        User.updateMany(
          {
            $or: [{ fcmToken: token }, { "fcmTokens.token": token }],
          },
          {
            $unset: { fcmToken: "" },
            $pull: { fcmTokens: { token } },
          },
        ),
      ]);

      const agency: any = await Agency.findById(agencyId);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }

      const existingTokens = Array.isArray(agency.fcmTokens)
        ? agency.fcmTokens
        : [];
      const tokenIndex = existingTokens.findIndex(
        (item: any) => item?.token === token,
      );
      const tokenRecord = {
        token,
        active: true,
        platform,
        deviceId,
        appVersion,
        lastRegisteredAt: now,
        lastUsedAt: now,
      };

      if (tokenIndex >= 0) {
        existingTokens[tokenIndex] = {
          ...existingTokens[tokenIndex].toObject?.(),
          ...existingTokens[tokenIndex],
          ...tokenRecord,
          deviceId: deviceId || existingTokens[tokenIndex]?.deviceId,
          appVersion: appVersion || existingTokens[tokenIndex]?.appVersion,
        };
      } else {
        existingTokens.push(tokenRecord);
      }

      agency.fcmToken = token;
      agency.fcmTokens = existingTokens
        .filter((item: any) => item?.token)
        .sort(
          (first: any, second: any) =>
            new Date(second?.lastRegisteredAt || 0).getTime() -
            new Date(first?.lastRegisteredAt || 0).getTime(),
        )
        .slice(0, 10);
      agency.notification = {
        sms: agency.notification?.sms ?? true,
        email: agency.notification?.email ?? true,
        whatsapp: agency.notification?.whatsapp ?? true,
        push: agency.notification?.push ?? true,
      };
      await agency.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            registered: true,
            platform,
            activeTokens: agency.fcmTokens.filter(
              (item: any) => item?.active !== false,
            ).length,
          },
          "B2B push token registered successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async unregisterPushToken(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id || req.user?.id;
      const token = String(req.body?.token || req.body?.fcmToken || "").trim();
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!token) {
        return res.status(400).json(new ApiError(400, "FCM token is required"));
      }

      const agency: any = await Agency.findById(agencyId);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }

      agency.fcmTokens = (
        Array.isArray(agency.fcmTokens) ? agency.fcmTokens : []
      ).map((item: any) =>
        item?.token === token
          ? { ...item.toObject?.(), ...item, active: false }
          : item,
      );
      if (agency.fcmToken === token) {
        agency.fcmToken =
          agency.fcmTokens.find(
            (item: any) =>
              item?.active !== false && item?.token && item.token !== token,
          )?.token || undefined;
      }
      await agency.save();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { unregistered: true },
            "B2B push token unregistered successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async getTeamMembers(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency = await agencyService.getById(_id);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }
      if (agency.parentAgency) {
        return res
          .status(403)
          .json(new ApiError(403, "Only agencies can view team members"));
      }
      const members = await Agency.find({ parentAgency: _id })
        .select("-password -refreshToken")
        .sort({ createdAt: -1 });
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            members.map((member: any) => sanitizeAgencyForSelf(member)),
            "Team members fetched successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async getTeamMember(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const { id } = req.params;
      const agency = await agencyService.getById(_id);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }
      if (agency.parentAgency) {
        return res
          .status(403)
          .json(new ApiError(403, "Only agencies can view team members"));
      }
      const member = await Agency.findOne({
        _id: id,
        parentAgency: _id,
      }).select("-password -refreshToken");
      if (!member) {
        return res.status(404).json(new ApiError(404, "Team member not found"));
      }
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            sanitizeAgencyForSelf(member),
            "Team member fetched successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async createTeamMember(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const parent = await agencyService.getById(_id);
      if (!parent) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }
      if (parent.parentAgency) {
        return res
          .status(403)
          .json(new ApiError(403, "Only agencies can add team members"));
      }

      const personalDetails = parseJSONSafely(
        req.body.personalDetails,
        {},
      ) as Record<string, any>;
      const addressDetails = parseJSONSafely(
        req.body.addressDetails,
        {},
      ) as Record<string, any>;
      const employmentDetails = parseJSONSafely(req.body.employmentDetails, {});
      const financialDetails = parseJSONSafely(req.body.financialDetails, {});
      const bankDetails = parseJSONSafely(req.body.bankDetails, {});
      const hasDocumentSubmission =
        req.body.documents !== undefined ||
        req.body.kycDocuments !== undefined ||
        req.body.addressProof !== undefined ||
        req.body.incomeProof !== undefined;
      const documents = parseJSONSafely(req.body.documents, []);

      delete personalDetails.mobile;
      delete (personalDetails as any).isMobileVerified;
      const sanitizeAddress = (value: any) => {
        const source = value && typeof value === "object" ? value : {};
        return {
          city: source.city,
          state: source.state,
          street: source.street || source.address,
          country: source.country,
          postalCode: source.postalCode || source.pinCode || source.pincode,
          label: source.label,
          isDefault: Boolean(source.isDefault),
        };
      };
      const submittedDocuments = [
        ...normalizeDocumentEntries(documents),
        ...mapUploadsToDocuments(req.body.kycDocuments, "kyc_document"),
        ...mapUploadsToDocuments(req.body.addressProof, "address_proof"),
        ...mapUploadsToDocuments(req.body.incomeProof, "income_proof"),
      ].map((document: any) => ({ ...document, verified: false }));
      const submittedAddressDetails: Record<string, any> = {};
      if (addressDetails.currentAddress) {
        submittedAddressDetails.currentAddress = sanitizeAddress(
          addressDetails.currentAddress,
        );
      }
      if (addressDetails.permanentAddress) {
        submittedAddressDetails.permanentAddress = sanitizeAddress(
          addressDetails.permanentAddress,
        );
      }
      if (addressDetails.proofOfAddress) {
        submittedAddressDetails.proofOfAddress = {
          ...normalizeDocumentEntries(
            addressDetails.proofOfAddress,
            "address_proof",
          )[0],
          verified: false,
        };
      }

      const name = personalDetails.fullName || req.body.name;
      const email = personalDetails.email || req.body.email;
      const mobile = personalDetails.mobile || req.body.mobile;
      if (!name || !email || !mobile) {
        return res
          .status(400)
          .json(new ApiError(400, "Name, email, and mobile are required"));
      }

      const profilePicture = req.body.profilePicture?.[0]?.url;
      let avatar;
      if (req.body.avatar?.[0]?.url) {
        avatar = await extractImageUrl(req.body.avatar, "");
      }
      if (!avatar && profilePicture) {
        avatar = await extractImageUrl(req.body.profilePicture, "");
      }

      const member = await Agency.create({
        name,
        email,
        mobile,
        role: "agency_member",
        parentAgency: _id,
        agreedToTerms: true,
        privacyPolicyAccepted: true,
        status:
          resolveAgencyStatusInput(
            req.body.status ??
              req.body.memberStatus ??
              (typeof req.body.isActive === "boolean"
                ? req.body.isActive
                : undefined),
          ) || UserStatus.ACTIVE,
        password: crypto.randomBytes(10).toString("hex"),
        notification: { sms: true, push: true, email: true, whatsapp: true },
        avatar: avatar || profilePicture,
        kycProfile: {
          reusableAcrossApplications: normalizeBoolean(
            req.body.reusableAcrossApplications,
            true,
          ),
          personalDetails: { ...personalDetails, mobile },
          addressDetails: submittedAddressDetails,
          employmentDetails,
          financialDetails,
          documents: hasDocumentSubmission ? submittedDocuments : [],
        },
      });
      if (bankDetails && Object.keys(bankDetails).length) {
        await applyEncryptedAgencyBankDetails(member, bankDetails);
        await member.save();
      }

      return res
        .status(201)
        .json(
          new ApiResponse(
            201,
            sanitizeAgencyForSelf(member),
            "Team member created successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async updateTeamMember(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const { id } = req.params;
      const agency = await agencyService.getById(_id);
      if (!agency) {
        return res.status(404).json(new ApiError(404, "Agency not found"));
      }
      if (agency.parentAgency) {
        return res
          .status(403)
          .json(new ApiError(403, "Only agencies can update team members"));
      }

      const member: any = await Agency.findOne({
        _id: id,
        parentAgency: _id,
      });
      if (!member) {
        return res.status(404).json(new ApiError(404, "Team member not found"));
      }

      const personalDetails = parseJSONSafely(
        req.body.personalDetails,
        {},
      ) as Record<string, any>;
      const addressDetails = parseJSONSafely(
        req.body.addressDetails,
        {},
      ) as Record<string, any>;
      const employmentDetails = parseJSONSafely(req.body.employmentDetails, {});
      const financialDetails = parseJSONSafely(req.body.financialDetails, {});
      const bankDetails = parseJSONSafely<Record<string, any>>(
        req.body.bankDetails,
        {},
      );
      const documents = parseJSONSafely(req.body.documents, []);

      const hasDocumentSubmission =
        req.body.documents !== undefined ||
        req.body.kycDocuments !== undefined ||
        req.body.addressProof !== undefined ||
        req.body.incomeProof !== undefined;
      delete personalDetails.mobile;
      delete (personalDetails as any).isMobileVerified;
      const sanitizeAddress = (value: any) => {
        const source = value && typeof value === "object" ? value : {};
        return {
          city: source.city,
          state: source.state,
          street: source.street || source.address,
          country: source.country,
          postalCode: source.postalCode || source.pinCode || source.pincode,
          label: source.label,
          isDefault: Boolean(source.isDefault),
        };
      };
      const submittedDocuments = [
        ...normalizeDocumentEntries(documents),
        ...mapUploadsToDocuments(req.body.kycDocuments, "kyc_document"),
        ...mapUploadsToDocuments(req.body.addressProof, "address_proof"),
        ...mapUploadsToDocuments(req.body.incomeProof, "income_proof"),
      ].map((document: any) => ({ ...document, verified: false }));
      const submittedAddressDetails: Record<string, any> = {};
      if (addressDetails.currentAddress) {
        submittedAddressDetails.currentAddress = sanitizeAddress(
          addressDetails.currentAddress,
        );
      }
      if (addressDetails.permanentAddress) {
        submittedAddressDetails.permanentAddress = sanitizeAddress(
          addressDetails.permanentAddress,
        );
      }
      if (addressDetails.proofOfAddress) {
        submittedAddressDetails.proofOfAddress = {
          ...normalizeDocumentEntries(
            addressDetails.proofOfAddress,
            "address_proof",
          )[0],
          verified: false,
        };
      }

      const existingKyc = member.kycProfile?.toObject
        ? member.kycProfile.toObject()
        : member.kycProfile || {};

      member.kycProfile = {
        ...existingKyc,
        reusableAcrossApplications: normalizeBoolean(
          req.body.reusableAcrossApplications,
          existingKyc.reusableAcrossApplications ?? true,
        ),
        personalDetails: {
          ...(existingKyc.personalDetails || {}),
          ...personalDetails,
          mobile: personalDetails.mobile || member.mobile,
        },
        addressDetails: {
          ...(existingKyc.addressDetails || {}),
          ...addressDetails,
        },
        employmentDetails: {
          ...(existingKyc.employmentDetails || {}),
          ...employmentDetails,
        },
        financialDetails: {
          ...(existingKyc.financialDetails || {}),
          ...financialDetails,
        },
        documents:
          req.body.documents !== undefined
            ? mergeDocuments(
                existingKyc.documents || [],
                normalizeDocumentEntries(documents).map((document: any) => ({
                  ...document,
                  verified: false,
                })),
              )
            : existingKyc.documents,
        verification: existingKyc.verification,
      };

      if (personalDetails?.fullName) member.name = personalDetails.fullName;
      if (personalDetails?.email) member.email = personalDetails.email;
      if (personalDetails?.mobile) member.mobile = personalDetails.mobile;
      const resolvedStatus = resolveAgencyStatusInput(
        req.body.status ??
          req.body.memberStatus ??
          req.body.active ??
          req.body.isActive,
      );
      if (resolvedStatus) {
        member.status = resolvedStatus;
      }

      const profilePicture = req.body.profilePicture?.[0]?.url;
      let avatar;
      if (req.body.avatar?.[0]?.url) {
        avatar = await extractImageUrl(
          req.body.avatar,
          member.avatar as string,
        );
      }
      if (!avatar && profilePicture) {
        avatar = await extractImageUrl(
          req.body.profilePicture,
          member.avatar as string,
        );
      }
      if (avatar || profilePicture) {
        member.avatar = avatar || profilePicture;
      }

      if (bankDetails && Object.keys(bankDetails).length > 0) {
        await applyEncryptedAgencyBankDetails(member, bankDetails);
      }

      await member.save();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            sanitizeAgencyForSelf(member),
            "Team member updated successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async syncDigiLocker(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency: any = await Agency.findById(_id);
      if (!agency) return next(new ApiError(404, "Agency not found"));

      const storageProvider = req.body.storageProvider || "internal";
      const defaultDocType = req.body.defaultDocType || "digital_document";
      const docNumbers = toArrayPayload(
        req.body.docNumber || req.body.documentNumber || req.body.number,
      );
      const docPasswords = toArrayPayload(
        req.body.docPassword || req.body.password,
      );
      const docTypes = toArrayPayload(req.body.docType);
      const docNames = toArrayPayload(req.body.name);

      const providedDocs = normalizeDocumentEntries(
        req.body.documents,
        defaultDocType,
      );
      const uploadedDocs = mapUploadsToDocuments(
        req.body.digiLockerFiles || req.body.documentsUpload,
        defaultDocType,
        {
          docNumbers,
          docPasswords,
          docTypes,
          docNames,
        },
      );

      const currentVaultDocs =
        JSON.parse(JSON.stringify(agency.digiLockerVault?.documents || [])) ||
        [];
      const incomingDocs = [...providedDocs, ...uploadedDocs];
      const mergedByType = new Map<string, any>();
      currentVaultDocs.forEach((doc: any) => {
        if (!doc?.docType) return;
        mergedByType.set(doc.docType, doc);
      });
      incomingDocs.forEach((doc: any) => {
        if (!doc?.docType) return;
        const existing = mergedByType.get(doc.docType) || {};
        const merged = { ...existing, ...doc };
        if (!doc.fileUrl && existing.fileUrl) merged.fileUrl = existing.fileUrl;
        if (!doc.referenceId && existing.referenceId)
          merged.referenceId = existing.referenceId;
        if (!doc.issuedOn && existing.issuedOn)
          merged.issuedOn = existing.issuedOn;
        if (!doc.number && existing.number) merged.number = existing.number;
        if (!doc.password && existing.password)
          merged.password = existing.password;
        mergedByType.set(doc.docType, merged);
      });

      const mergedDocs: any[] = [];
      for (const [docType, doc] of mergedByType.entries()) {
        const incoming = incomingDocs.find(
          (item) => item?.docType && item.docType === docType,
        );
        const existing = currentVaultDocs.find(
          (item: any) => item?.docType === docType,
        );
        if (incoming?.fileUrl && existing?.fileUrl) {
          const nextUrl = await extractImageUrl(
            [{ url: incoming.fileUrl }],
            existing.fileUrl,
          );
          mergedDocs.push({ ...doc, fileUrl: nextUrl });
        } else {
          mergedDocs.push(doc);
        }
      }

      const existingKyc: IKycProfile =
        JSON.parse(JSON.stringify(agency.kycProfile || {})) || {};
      const updatedKyc: IKycProfile = {
        ...existingKyc,
        documents: mergeDocuments(existingKyc.documents || [], mergedDocs),
      };

      const updatedAgency = await agencyService.updateById(
        _id,
        {
          digiLockerVault: {
            storageProvider,
            syncedAt: new Date(),
            documents: mergedDocs,
          },
          kycProfile: updatedKyc,
        },
        { populate: false },
      );
      const completion = evaluateAgencyProfileCompletion(updatedAgency);
      if (updatedAgency?.agentProfileCompleted !== completion.isComplete) {
        await Agency.findByIdAndUpdate(_id, {
          agentProfileCompleted: completion.isComplete,
        });
      }

      const sanitizedDocs = (
        updatedAgency.digiLockerVault?.documents || []
      ).map((doc: any) => {
        const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
        return rest;
      });

      await safeNotify({
        type: "digilocker-synced",
        toUserId: updatedAgency._id.toString(),
        toRole: UserType.AGENCY,
        fromUser: { _id: updatedAgency._id.toString(), role: UserType.AGENCY },
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedAgency as any).digiLockerVault?.toObject
              ? (updatedAgency as any).digiLockerVault.toObject()
              : updatedAgency.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "DigiLocker vault synced successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getDigiLockerDocuments(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency = await agencyService.getById(_id, false);
      const sanitizedDocs = (agency?.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((agency as any)?.digiLockerVault?.toObject
              ? (agency as any).digiLockerVault.toObject()
              : agency?.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "DigiLocker vault fetched successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async deleteDigiLockerDocument(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const docType = String(req.params?.docType || "").trim();
      if (!docType) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "Document type is required"));
      }

      const agency: any = await Agency.findById(_id);
      if (!agency) return next(new ApiError(404, "Agency not found"));

      const currentVaultDocs =
        JSON.parse(JSON.stringify(agency.digiLockerVault?.documents || [])) ||
        [];
      const currentKyc: IKycProfile =
        JSON.parse(JSON.stringify(agency.kycProfile || {})) || {};
      const nextVaultDocs = currentVaultDocs.filter(
        (doc: any) => String(doc?.docType || "") !== docType,
      );
      const nextKycDocs = (currentKyc.documents || []).filter(
        (doc: any) => String(doc?.docType || "") !== docType,
      );

      const updatedAgency: any = await agencyService.updateById(
        _id,
        {
          digiLockerVault: {
            ...(agency.digiLockerVault?.toObject
              ? agency.digiLockerVault.toObject()
              : agency.digiLockerVault || {}),
            documents: nextVaultDocs,
            syncedAt: new Date(),
          },
          kycProfile: {
            ...currentKyc,
            documents: nextKycDocs,
          },
        },
        { populate: false },
      );

      const completion = evaluateAgencyProfileCompletion(updatedAgency);
      if (updatedAgency?.agentProfileCompleted !== completion.isComplete) {
        await Agency.findByIdAndUpdate(_id, {
          agentProfileCompleted: completion.isComplete,
        });
      }

      const sanitizedDocs = (
        updatedAgency?.digiLockerVault?.documents || []
      ).map((doc: any) => {
        const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
        return rest;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedAgency as any)?.digiLockerVault?.toObject
              ? (updatedAgency as any).digiLockerVault.toObject()
              : updatedAgency?.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "Document removed successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getEarningsSummary(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const from = typeof req.query?.from === "string" ? req.query.from : undefined;
      const to = typeof req.query?.to === "string" ? req.query.to : undefined;
      const result = await agencyEarningsService.getAgencySummary(
        agencyId,
        from,
        to,
      );
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency earnings summary fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getEarningEvents(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const tabRaw = String(req.query?.tab || "projected").toLowerCase();
      const tab =
        tabRaw === "paid" ? "paid" : tabRaw === "earned" ? "earned" : "projected";
      const from = typeof req.query?.from === "string" ? req.query.from : undefined;
      const to = typeof req.query?.to === "string" ? req.query.to : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 20;
      const result = await agencyEarningsService.listAgencyEvents({
        agencyId,
        tab,
        from,
        to,
        page,
        limit,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency earning events fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getLeadSummary(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const result = await agencyLeadsService.getLeadSummary(agencyId);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency lead summary fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getLeadEvents(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const stageRaw = String(req.query?.stage || "all").toLowerCase();
      const stage =
        stageRaw === "pre_login" ||
        stageRaw === "login" ||
        stageRaw === "sanction" ||
        stageRaw === "disbursed"
          ? stageRaw
          : "all";
      const loanType =
        typeof req.query?.loanType === "string" ? req.query.loanType : undefined;
      const productVariant =
        typeof req.query?.productVariant === "string"
          ? req.query.productVariant
          : undefined;
      const search =
        typeof req.query?.search === "string" ? req.query.search : undefined;
      const status =
        typeof req.query?.status === "string" ? req.query.status : undefined;
      const minAmountRaw = Number(req.query?.minAmount);
      const maxAmountRaw = Number(req.query?.maxAmount);
      const minAmount = Number.isFinite(minAmountRaw)
        ? Math.max(0, minAmountRaw)
        : undefined;
      const maxAmount = Number.isFinite(maxAmountRaw)
        ? Math.max(0, maxAmountRaw)
        : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 20;

      const result = await agencyLeadsService.listLeads({
        agencyId,
        stage: stage as any,
        productType:
          typeof req.query?.productType === "string"
            ? req.query.productType
            : undefined,
        loanType,
        productVariant,
        status,
        search,
        minAmount,
        maxAmount,
        page,
        limit,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency leads fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async getPayoutSummary(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      const result = await agencyPayoutService.getSummary(agencyId);
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency payout summary fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async listPayoutRequests(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }

      const status =
        typeof req.query?.status === "string" ? req.query.status : undefined;
      const page = Number(req.query?.page) || 1;
      const limit = Number(req.query?.limit) || 20;

      const result = await agencyPayoutService.listRequests({
        agencyId,
        status,
        page,
        limit,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency payout requests fetched"));
    } catch (error) {
      next(error);
    }
  }

  static async createPayoutRequest(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const agencyId = req.user?._id;
      if (!agencyId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }

      const payout = await agencyPayoutService.createRequest({
        agencyId,
        amount: Number(req.body?.amount),
        method: req.body?.method,
        upiId: req.body?.upiId,
        bankDetails: req.body?.bankDetails,
        notes: req.body?.notes,
      });

      return res
        .status(201)
        .json(new ApiResponse(201, payout, "Payout request created"));
    } catch (error) {
      next(error);
    }
  }

  static async updateAgency(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const existing = await Agency.findById(_id);
      if (!existing)
        return res.status(404).json(new ApiError(404, "Agency not found"));

      const profilePicture = req.body.profilePicture?.[0]?.url;
      let avatar;
      if (req.body.avatar?.[0]?.url) {
        avatar = await extractImageUrl(
          req.body.avatar,
          existing?.avatar as string,
        );
      }
      if (!avatar && profilePicture) {
        avatar = await extractImageUrl(
          req.body.profilePicture,
          existing?.avatar as string,
        );
      }

      const data: Record<string, any> = {};
      for (const key of [
        "name",
        "businessName",
        "gender",
        "rmName",
        "rmMobile",
      ]) {
        if (req.body?.[key] !== undefined) data[key] = req.body[key];
      }
      if (req.body?.email !== undefined) {
        const email = String(req.body.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          throw new ApiError(400, "Valid email is required");
        }
        const duplicate = await Agency.exists({ email, _id: { $ne: _id } });
        if (duplicate) throw new ApiError(409, "Email already in use");
        data.email = email;
        if (email !== existing.email) data.isEmailVerified = false;
      }
      if (req.body?.notification && typeof req.body.notification === "object") {
        data.notification = {
          sms: normalizeBoolean(req.body.notification.sms, existing.notification?.sms ?? true),
          push: normalizeBoolean(req.body.notification.push, existing.notification?.push ?? true),
          email: normalizeBoolean(req.body.notification.email, existing.notification?.email ?? true),
          whatsapp: normalizeBoolean(req.body.notification.whatsapp, existing.notification?.whatsapp ?? true),
        };
      }
      if (req.body?.agreedToTerms === true || req.body?.agreedToTerms === "true") {
        data.agreedToTerms = true;
      }
      if (
        req.body?.privacyPolicyAccepted === true ||
        req.body?.privacyPolicyAccepted === "true"
      ) {
        data.privacyPolicyAccepted = true;
      }
      if (avatar || profilePicture) data.avatar = avatar || profilePicture;
      const reviewedProfileChanged = ["name", "businessName", "email"].some(
        (key) =>
          Object.prototype.hasOwnProperty.call(data, key) &&
          String(data[key] || "").trim().toLowerCase() !==
            String((existing as any)[key] || "").trim().toLowerCase(),
      );
      if (
        existing.role === "agency" &&
        !existing.parentAgency &&
        existing.status === UserStatus.ACTIVE &&
        reviewedProfileChanged
      ) {
        data.status = UserStatus.PENDING_VERIFICATION;
        data.approvalReview = {
          ...((existing.approvalReview as any)?.toObject?.() || existing.approvalReview || {}),
          status: "pending",
          resubmittedAt: new Date(),
          notes: "Reviewed profile details changed by DSA; admin re-approval required",
        };
      }
      const result = await Agency.findByIdAndUpdate(
        _id,
        { $set: data },
        { new: true, runValidators: true },
      );
      const enriched = sanitizeAgencyForSelf(result);
      if (result?.agentProfileCompleted !== enriched.agentProfileCompleted) {
        await Agency.findByIdAndUpdate(_id, {
          agentProfileCompleted: enriched.agentProfileCompleted,
        });
      }

      return res
        .status(200)
        .json(new ApiResponse(200, enriched, "Agency updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateKycProfile(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const agency: any = await Agency.findById(_id);
      if (!agency)
        return res.status(404).json(new ApiError(404, "Agency not found"));

      const personalDetails = parseJSONSafely(
        req.body.personalDetails,
        {},
      ) as Record<string, any>;
      const addressDetails = parseJSONSafely(
        req.body.addressDetails,
        {},
      ) as Record<string, any>;
      const employmentDetails = parseJSONSafely(req.body.employmentDetails, {});
      const financialDetails = parseJSONSafely(req.body.financialDetails, {});
      const bankDetails = parseJSONSafely<Record<string, any>>(
        req.body.bankDetails,
        {},
      );
      const documents = parseJSONSafely(req.body.documents, []);
      const reviewedKycSubmitted = [
        "personalDetails",
        "addressDetails",
        "bankDetails",
        "documents",
        "kycDocuments",
        "addressProof",
        "incomeProof",
      ].some((key) => req.body?.[key] !== undefined);

      const hasDocumentSubmission =
        req.body.documents !== undefined ||
        req.body.kycDocuments !== undefined ||
        req.body.addressProof !== undefined ||
        req.body.incomeProof !== undefined;
      delete personalDetails.mobile;
      delete (personalDetails as any).isMobileVerified;
      const sanitizeAddress = (value: any) => {
        const source = value && typeof value === "object" ? value : {};
        return {
          city: source.city,
          state: source.state,
          street: source.street || source.address,
          country: source.country,
          postalCode: source.postalCode || source.pinCode || source.pincode,
          label: source.label,
          isDefault: Boolean(source.isDefault),
        };
      };
      const submittedDocuments = [
        ...normalizeDocumentEntries(documents),
        ...mapUploadsToDocuments(req.body.kycDocuments, "kyc_document"),
        ...mapUploadsToDocuments(req.body.addressProof, "address_proof"),
        ...mapUploadsToDocuments(req.body.incomeProof, "income_proof"),
      ].map((document: any) => ({ ...document, verified: false }));
      const submittedAddressDetails: Record<string, any> = {};
      if (addressDetails.currentAddress) {
        submittedAddressDetails.currentAddress = sanitizeAddress(
          addressDetails.currentAddress,
        );
      }
      if (addressDetails.permanentAddress) {
        submittedAddressDetails.permanentAddress = sanitizeAddress(
          addressDetails.permanentAddress,
        );
      }
      if (addressDetails.proofOfAddress) {
        submittedAddressDetails.proofOfAddress = {
          ...normalizeDocumentEntries(
            addressDetails.proofOfAddress,
            "address_proof",
          )[0],
          verified: false,
        };
      }

      const existingKyc = agency.kycProfile?.toObject
        ? agency.kycProfile.toObject()
        : agency.kycProfile || {};

      const kycProfile = {
        ...existingKyc,
        reusableAcrossApplications: normalizeBoolean(
          req.body.reusableAcrossApplications,
          existingKyc.reusableAcrossApplications ?? true,
        ),
        personalDetails: {
          ...(existingKyc.personalDetails || {}),
          ...personalDetails,
          mobile: agency.mobile,
        },
        addressDetails: {
          ...(existingKyc.addressDetails || {}),
          ...submittedAddressDetails,
        },
        employmentDetails: {
          ...(existingKyc.employmentDetails || {}),
          ...employmentDetails,
        },
        financialDetails: {
          ...(existingKyc.financialDetails || {}),
          ...financialDetails,
        },
        documents: hasDocumentSubmission
          ? mergeDocuments(existingKyc.documents || [], submittedDocuments)
          : existingKyc.documents,
        verification: existingKyc.verification,
      };

      agency.kycProfile = kycProfile;
      if (personalDetails?.fullName) {
        agency.name = personalDetails.fullName;
      }
      if (personalDetails?.email) {
        const email = String(personalDetails.email).trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          throw new ApiError(400, "Valid email is required");
        }
        const duplicate = await Agency.exists({ email, _id: { $ne: agency._id } });
        if (duplicate) throw new ApiError(409, "Email already in use");
        if (email !== agency.email) agency.isEmailVerified = false;
        agency.email = email;
      }
      if (bankDetails && Object.keys(bankDetails).length > 0) {
        await applyEncryptedAgencyBankDetails(agency, bankDetails);
      }
      agency.agentProfileCompleted = evaluateAgencyProfileCompletion(
        agency,
      ).isComplete;
      if (
        agency.role === "agency" &&
        !agency.parentAgency &&
        agency.status === UserStatus.ACTIVE &&
        reviewedKycSubmitted
      ) {
        agency.status = UserStatus.PENDING_VERIFICATION;
        agency.approvalReview = {
          ...(agency.approvalReview?.toObject?.() || agency.approvalReview || {}),
          status: "pending",
          resubmittedAt: new Date(),
          notes: "Reviewed KYC details changed by DSA; admin re-approval required",
        };
      }
      await agency.save();

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            sanitizeAgencyForSelf(agency),
            "KYC profile updated successfully",
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
}
