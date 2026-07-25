import crypto from "crypto";
import jwt from "jsonwebtoken";
import Otp from "../../modals/otp.model";
import ApiError from "../../utils/ApiError";
import { logger } from "../../config/logger";
import { config } from "../../config/config";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { Request, Response, NextFunction } from "express";
import { maskMobileForLogs, sendSMS } from "../../utils/smsService";
import {
  User,
  UserStatus,
  IKycProfile,
  AccountSource,
  LoanProductType,
  LoginMethodType,
  KycVerificationStatus,
} from "../../modals/user.model";
import { UserType } from "../../modals/notification.model";
import { ContactSync } from "../../modals/contactSync.model";
import { CommonService } from "../../services/common.services";
import { ReferralEvent } from "../../modals/referralEvent.model";
import { rewardReferralIfEligible } from "../../services/referral.service";
import { sendSingleNotification } from "../../services/notification.service";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";
import { consumeOtpRequest } from "../../services/otpRateLimit.service";

const otpService = new CommonService(Otp);
const userService = new CommonService(User);

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

const canManageDigiLockerDocuments = (
  role: string | undefined,
  actorId: any,
  targetUserId: string,
) => {
  if (role === "admin" || role === "agent") return true;
  return String(actorId) === targetUserId;
};

const normalizePreferredProducts = (items: any) => {
  return toArrayPayload(items).reduce((acc: any[], raw: any) => {
    if (!raw) return acc;
    const source = typeof raw === "string" ? { productType: raw } : { ...raw };
    if (!source.productType && source.type) source.productType = source.type;
    if (!source.productType && source.loanType)
      source.productType = source.loanType;
    if (!source.productType && source.cardType)
      source.productType = source.cardType;
    const normalizedValue = source.productType
      ? source.productType.toString().toLowerCase()
      : undefined;
    const normalizedType = normalizedValue
      ? (Object.values(LoanProductType).find(
          (type) => type === normalizedValue,
        ) as LoanProductType | undefined)
      : undefined;
    if (!normalizedType) return acc;
    acc.push({
      productType: normalizedType,
      preferredLimit:
        source.preferredLimit ??
        source.desiredLimit ??
        source.creditLimit ??
        source.limit,
      tenurePreferenceMonths:
        source.tenurePreferenceMonths ?? source.tenure ?? source.duration,
    });
    return acc;
  }, []);
};

const normalizeLoginMethodType = (method?: string): LoginMethodType | null => {
  if (!method) return null;
  const normalized = method.toString().toLowerCase();
  const match = Object.values(LoginMethodType).find(
    (value) => value === normalized,
  );
  return (match as LoginMethodType) || null;
};

const normalizeAccountSource = (value?: unknown): AccountSource => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (["website", "web", "browser"].includes(normalized)) {
    return AccountSource.WEBSITE;
  }
  if (["app", "mobile_app", "mobile", "android", "ios"].includes(normalized)) {
    return AccountSource.APP;
  }
  if (["admin", "panel", "dashboard"].includes(normalized)) {
    return AccountSource.ADMIN;
  }
  if (["crm", "lead", "call_center", "call_record"].includes(normalized)) {
    return AccountSource.CRM;
  }
  return AccountSource.UNKNOWN;
};

const resolveAccountSource = (req: Request): AccountSource => {
  return normalizeAccountSource(
    req.body?.accountSource ||
      req.body?.createdFrom ||
      req.body?.sourcePlatform ||
      req.get("x-account-source") ||
      req.get("x-client-platform"),
  );
};

const normalizePushPlatform = (value?: unknown) => {
  const platform = String(value || "")
    .trim()
    .toLowerCase();
  if (["ios", "android", "web"].includes(platform)) return platform;
  return "unknown";
};

const generateReferralCode = async () => {
  const prefix = "FINTARA";
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i += 1) {
    const suffix = Math.floor(100 + Math.random() * 900).toString();
    const code = `${prefix}${suffix}`;
    const exists = await User.findOne({ referralCode: code }).select("_id");
    if (!exists) return code;
  }
  throw new ApiError(500, "Failed to generate referral code");
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

const normalizePanCard = (value?: string) =>
  String(value || "")
    .trim()
    .toUpperCase();

const normalizeBoolean = (value: any, fallback = true) =>
  typeof value === "boolean"
    ? value
    : typeof value === "string"
      ? ["true", "1", "yes", "on"].includes(value.trim().toLowerCase())
      : fallback;

const resolveNotificationPayload = (body: any, existing?: any) => {
  const current = existing?.notification || {};
  const bodyNotification = body?.notification || {};

  return {
    sms: normalizeBoolean(
      bodyNotification.sms ?? body.sms,
      current.sms ?? true,
    ),
    push: normalizeBoolean(
      bodyNotification.push ?? body.push,
      current.push ?? true,
    ),
    email: normalizeBoolean(
      bodyNotification.email ?? body.emailNotification,
      current.email ?? true,
    ),
    whatsapp: normalizeBoolean(
      bodyNotification.whatsapp ?? body.whatsapp,
      current.whatsapp ?? true,
    ),
  };
};

const assertPanCardAvailable = async (
  panCard: string,
  currentUserId?: string,
) => {
  const normalizedPan = normalizePanCard(panCard);
  if (!normalizedPan) return "";

  const query: Record<string, any> = { panCard: normalizedPan };
  if (currentUserId) {
    query._id = { $ne: currentUserId };
  }

  const linkedUser = await User.findOne(query).select("_id mobile name");
  if (linkedUser) {
    throw new ApiError(
      400,
      "PAN card already linked with another phone number",
    );
  }

  return normalizedPan;
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

export class UserController {
  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        email,
        mobile,
        panCard,
        aadhaarCard,
        referralCode: referralInput,
        role = "user",
        agreedToTerms = true,
        privacyPolicyAccepted = true,
        password,
      } = req.body;

      const panCardUrl = req?.body?.panCardUrl?.[0]?.url;
      const aadhaarCardUrl = req?.body?.aadhaarCardUrl?.[0]?.url;
      const cancelledChequeOrPassbook =
        req?.body?.cancelledChequeOrPassbook?.[0]?.url;
      const avatar = req?.body?.avatar?.[0]?.url;
      const normalizedPanCard = normalizePanCard(panCard);
      const accountSource = resolveAccountSource(req);

      if (!email || !mobile || !name) {
        return res
          .status(400)
          .json(new ApiError(400, "Missing required fields"));
      }

      const baseKycDocuments = [
        panCardUrl && {
          docType: "pan_card",
          number: normalizedPanCard || panCard,
          fileUrl: panCardUrl,
          issuer: "user_uploaded",
        },
        aadhaarCardUrl && {
          docType: "aadhaar_card",
          number: aadhaarCard,
          fileUrl: aadhaarCardUrl,
          issuer: "user_uploaded",
        },
        cancelledChequeOrPassbook && {
          docType: "bank_document",
          fileUrl: cancelledChequeOrPassbook,
          issuer: "user_uploaded",
        },
      ].filter(Boolean);

      const kycProfile: Partial<IKycProfile> = {
        reusableAcrossApplications: true,
        personalDetails: {
          fullName: name,
          panNumber: normalizedPanCard || panCard,
          aadhaarNumber: aadhaarCard,
        },
        documents: baseKycDocuments,
        verification: {
          status:
            baseKycDocuments.length > 0
              ? KycVerificationStatus.IN_PROGRESS
              : KycVerificationStatus.NOT_STARTED,
        },
      };

      const digiLockerVault =
        baseKycDocuments.length > 0
          ? {
              storageProvider: "internal",
              syncedAt: new Date(),
              documents: baseKycDocuments,
            }
          : undefined;

      const userData: any = {
        role,
        name,
        email,
        mobile,
        panCard: normalizedPanCard || panCard,
        panCardUrl,
        aadhaarCard,
        agreedToTerms,
        avatar,
        aadhaarCardUrl,
        password,
        privacyPolicyAccepted,
        isEmailVerified: false,
        isMobileVerified: false,
        cancelledChequeOrPassbook,
        kycProfile,
        accountSource,
        notification: resolveNotificationPayload(req.body),
        status:
          role === "user" ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
      };
      // Ensure password exists for hashing; generate a fallback if not provided (e.g., OTP-only signup)
      userData.password =
        password ||
        crypto.randomBytes(12).toString("hex") + "@" + Date.now().toString(16);

      if (digiLockerVault) userData.digiLockerVault = digiLockerVault;

      // Upsert-on-mobile: if a user with this mobile already exists, update provided fields and return
      const existingByMobile = await User.findOne({ mobile });
      if (normalizedPanCard) {
        await assertPanCardAvailable(
          normalizedPanCard,
          existingByMobile?._id?.toString(),
        );
      }
      if (existingByMobile) {
        // Ensure provided email (if any) is unique across other users
        if (email && email !== existingByMobile.email) {
          const emailTaken = await User.findOne({
            email,
            _id: { $ne: existingByMobile._id },
          }).select("_id");
          if (emailTaken) {
            return res
              .status(400)
              .json(new ApiError(400, "Email already in use"));
          }
        }
        const updatePayload: any = {};
        if (name) updatePayload.name = name;
        if (email) updatePayload.email = email.toLowerCase();
        if (normalizedPanCard) updatePayload.panCard = normalizedPanCard;
        if (aadhaarCard) updatePayload.aadhaarCard = aadhaarCard;
        if (typeof agreedToTerms === "boolean")
          updatePayload.agreedToTerms = agreedToTerms;
        if (typeof privacyPolicyAccepted === "boolean")
          updatePayload.privacyPolicyAccepted = privacyPolicyAccepted;
        if (avatar) updatePayload.avatar = avatar;
        if (panCardUrl) updatePayload.panCardUrl = panCardUrl;
        if (aadhaarCardUrl) updatePayload.aadhaarCardUrl = aadhaarCardUrl;
        if (cancelledChequeOrPassbook)
          updatePayload.cancelledChequeOrPassbook = cancelledChequeOrPassbook;
        if (
          accountSource !== AccountSource.UNKNOWN &&
          (!existingByMobile.accountSource ||
            existingByMobile.accountSource === AccountSource.UNKNOWN)
        ) {
          updatePayload.accountSource = accountSource;
        }
        if (kycProfile) {
          updatePayload.kycProfile = {
            ...((existingByMobile.kycProfile as any) || {}),
            ...kycProfile,
          };
        }
        if (digiLockerVault) {
          updatePayload.digiLockerVault = {
            ...((existingByMobile.digiLockerVault as any) || {}),
            ...digiLockerVault,
          };
        }
        updatePayload.notification = resolveNotificationPayload(
          req.body,
          existingByMobile,
        );
        let referrer: any = null;
        if (referralInput) {
          referrer = await User.findOne({ referralCode: referralInput });
          if (!referrer) {
            return res
              .status(400)
              .json(new ApiError(400, "Invalid referral code"));
          }
          updatePayload.referredBy = referrer._id;
        }
        const updated = await userService.updateById(
          existingByMobile._id.toString(),
          updatePayload,
          { populate: false },
        );
        if (referrer) {
          await ReferralEvent.create({
            referrer: referrer._id,
            referredUser: updated._id,
            referralCode: referrer.referralCode,
            status: "pending",
            points: 100,
          });
        }
        await safeNotify({
          type: "account-created",
          toUserId: updated._id.toString(),
          toRole: UserType.USER,
          fromUser: { _id: updated._id.toString(), role: UserType.USER },
          context: { userName: updated?.name || "User" },
        });
        return res
          .status(200)
          .json(new ApiResponse(200, updated, "Account updated successfully"));
      }

      const referralCode = await generateReferralCode();
      userData.referralCode = referralCode;

      let referrer: any = null;
      if (referralInput) {
        referrer = await User.findOne({ referralCode: referralInput });
        if (!referrer) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid referral code"));
        }
        userData.referredBy = referrer._id;
      }

      const response = await userService.create(userData);

      if (referrer) {
        await ReferralEvent.create({
          referrer: referrer._id,
          referredUser: response._id,
          referralCode: referrer.referralCode,
          status: "pending",
          points: 100,
        });
      }
      await safeNotify({
        type: "account-created",
        toUserId: response._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: response._id.toString(), role: UserType.USER },
        context: { userName: response?.name || "User" },
      });
      return res
        .status(201)
        .json(
          new ApiResponse(
            201,
            response,
            `Account created successfully! Please verify your account!`,
          ),
        );
    } catch (error) {
      console.log("Error: ", error);
      next(error);
    }
  }

  static async updateSecurityPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

      const bodyPreferredMfa = toArrayPayload(req.body.preferredMfaMethods);
      const loginMethodPayload = toArrayPayload(req.body.loginMethods);
      const trustedDevicePayload = parseJSONSafely(
        req.body.trustedDevice,
        req.body.trustedDevice,
      );

      const securityPreferences = {
        ...JSON.parse(JSON.stringify(user.securityPreferences || {})),
      };

      if (typeof req.body.mfaEnabled === "boolean")
        securityPreferences.mfaEnabled = req.body.mfaEnabled;
      if (typeof req.body.biometricEnabled === "boolean")
        securityPreferences.biometricEnabled = req.body.biometricEnabled;
      if (typeof req.body.deviceLevelAuth === "boolean")
        securityPreferences.deviceLevelAuth = req.body.deviceLevelAuth;
      if (bodyPreferredMfa.length)
        securityPreferences.preferredMfaMethods = bodyPreferredMfa;
      securityPreferences.trustedDevices =
        securityPreferences.trustedDevices || [];

      if (trustedDevicePayload?.deviceId) {
        securityPreferences.trustedDevices = [
          ...securityPreferences.trustedDevices.filter(
            (device: any) => device.deviceId !== trustedDevicePayload.deviceId,
          ),
          {
            ...trustedDevicePayload,
            lastLoginAt:
              trustedDevicePayload.lastLoginAt || new Date().toISOString(),
          },
        ];
      }

      const existingMethods = (user.loginMethods || []).map((method: any) =>
        method?.toObject ? method.toObject() : method,
      );
      const methodMap = new Map<string, any>();
      existingMethods.forEach((method: any) =>
        methodMap.set(method.type, { ...method }),
      );

      loginMethodPayload.forEach((method: any) => {
        const normalized =
          normalizeLoginMethodType(method?.type || method) || null;
        if (!normalized) return;
        methodMap.set(normalized, {
          ...methodMap.get(normalized),
          ...method,
          type: normalized,
          enabled:
            typeof method?.enabled === "boolean"
              ? method.enabled
              : (methodMap.get(normalized)?.enabled ?? true),
          verified:
            typeof method?.verified === "boolean"
              ? method.verified
              : (methodMap.get(normalized)?.verified ?? false),
          lastUsedAt:
            method?.lastUsedAt || methodMap.get(normalized)?.lastUsedAt,
        });
      });

      const updatePayload: any = { securityPreferences };
      if (methodMap.size) {
        updatePayload.loginMethods = Array.from(methodMap.values());
      }

      const updatedUser = await userService.updateById(_id, updatePayload, {
        populate: false,
      });

      await safeNotify({
        type: "preferences-updated",
        toUserId: updatedUser._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: updatedUser._id.toString(), role: UserType.USER },
      });
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedUser.securityPreferences,
            "Security preferences updated",
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
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

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
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
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
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};
      const updatedKyc: IKycProfile = {
        ...existingKyc,
        documents: mergeDocuments(existingKyc.documents || [], mergedDocs),
      };

      const updatedUser = await userService.updateById(
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

      const sanitizedDocs = (updatedUser.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );

      await safeNotify({
        type: "digilocker-synced",
        toUserId: updatedUser._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: updatedUser._id.toString(), role: UserType.USER },
      });
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedUser as any).digiLockerVault?.toObject
              ? (updatedUser as any).digiLockerVault.toObject()
              : updatedUser.digiLockerVault) || {}),
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
      const user = await userService.getById(_id, false);
      const sanitizedDocs = (user?.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((user as any)?.digiLockerVault?.toObject
              ? (user as any).digiLockerVault.toObject()
              : user?.digiLockerVault) || {}),
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
          .json(new ApiResponse(400, [], "Document type is required"));
      }

      const user: any = await userService.getById(_id, false);
      if (!user) return next(new ApiError(404, "User not found"));

      const fileUrl = String(
        req.body?.fileUrl || req.query?.fileUrl || "",
      ).trim();

      const currentVaultDocs =
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];

      let nextVaultDocs;
      if (fileUrl) {
        // remove only the specific file entry matching both docType and fileUrl
        nextVaultDocs = currentVaultDocs.filter(
          (doc: any) =>
            !(
              doc?.docType === docType && String(doc?.fileUrl || "") === fileUrl
            ),
        );
      } else {
        // remove all documents of this docType
        nextVaultDocs = currentVaultDocs.filter(
          (doc: any) => doc?.docType !== docType,
        );
      }

      const currentKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};
      const nextKycDocs = (currentKyc.documents || []).filter((doc: any) => {
        if (fileUrl) {
          return !(
            doc?.docType === docType && String(doc?.fileUrl || "") === fileUrl
          );
        }
        return doc?.docType !== docType;
      });

      const updatedUser = await userService.updateById(
        _id,
        {
          digiLockerVault: {
            ...(user.digiLockerVault || {}),
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

      const sanitizedDocs = (updatedUser.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedUser as any).digiLockerVault?.toObject
              ? (updatedUser as any).digiLockerVault.toObject()
              : updatedUser.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "Document removed successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async deleteDigiLockerDocumentById(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id: actorId, role } = req.user || {};
      const targetUserId = String(req.params?.id || "").trim();
      const docType = String(req.params?.docType || "").trim();
      const fileUrl = String(req.body?.fileUrl || "").trim();

      if (!targetUserId) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "User id is required"));
      }
      if (!canManageDigiLockerDocuments(role, actorId, targetUserId)) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only manage your own documents"));
      }
      if (!docType) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "Document type is required"));
      }

      const user: any = await userService.getById(targetUserId, false);
      if (!user) return next(new ApiError(404, "User not found"));

      const currentVaultDocs =
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
      const nextVaultDocs = currentVaultDocs.filter(
        (doc: any) =>
          doc?.docType !== docType ||
          (fileUrl && String(doc?.fileUrl || "").trim() !== fileUrl),
      );
      const currentKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};
      const nextKycDocs = (currentKyc.documents || []).filter(
        (doc: any) =>
          doc?.docType !== docType ||
          (fileUrl && String(doc?.fileUrl || "").trim() !== fileUrl),
      );

      const updatedUser = await userService.updateById(
        targetUserId,
        {
          digiLockerVault: {
            ...(user.digiLockerVault || {}),
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

      const sanitizedDocs = (updatedUser.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedUser as any).digiLockerVault?.toObject
              ? (updatedUser as any).digiLockerVault.toObject()
              : updatedUser.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "Document removed successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async upsertDigiLockerDocument(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id: actorId, role } = req.user || {};
      const targetUserId = String(req.params?.id || "").trim();
      const docType = String(
        req.params?.docType || req.body?.docType || "",
      ).trim();

      if (!targetUserId) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "User id is required"));
      }
      if (!canManageDigiLockerDocuments(role, actorId, targetUserId)) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only manage your own documents"));
      }
      if (!docType) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "Document type is required"));
      }

      const user: any = await User.findById(targetUserId);
      if (!user) return next(new ApiError(404, "User not found"));

      const currentVaultDocs =
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
      const currentKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};

      const incomingDocs = [
        ...normalizeDocumentEntries(req.body.documents, docType),
        ...mapUploadsToDocuments(req.body.document, docType),
      ].map((doc: any) => ({
        ...doc,
        docType,
      }));

      if (incomingDocs.length === 0) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "No documents provided"));
      }

      const mergedDocs = mergeDocuments(currentVaultDocs, incomingDocs);
      const updatedKyc: IKycProfile = {
        ...currentKyc,
        documents: mergeDocuments(currentKyc.documents || [], incomingDocs),
      };

      const updatedUser = await userService.updateById(
        targetUserId,
        {
          digiLockerVault: {
            storageProvider:
              user.digiLockerVault?.storageProvider || "internal",
            syncedAt: new Date(),
            documents: mergedDocs,
          },
          kycProfile: updatedKyc,
        },
        { populate: false },
      );

      const sanitizedDocs = (updatedUser.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password, ...rest } = doc?.toObject ? doc.toObject() : doc;
          return rest;
        },
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedUser as any).digiLockerVault?.toObject
              ? (updatedUser as any).digiLockerVault.toObject()
              : updatedUser.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "Document uploaded successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async updateDigiLockerDocumentPassword(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id: actorId, role } = req.user || {};
      const targetUserId = String(req.params?.id || "").trim();
      const docType = String(req.params?.docType || "").trim();
      const password = String(req.body?.password || "").trim();

      if (!targetUserId) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "User id is required"));
      }
      if (!canManageDigiLockerDocuments(role, actorId, targetUserId)) {
        return res
          .status(403)
          .json(new ApiError(403, "You can only manage your own documents"));
      }
      if (!docType) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, "Document type is required"));
      }

      const user: any = await User.findById(targetUserId);
      if (!user) return next(new ApiError(404, "User not found"));

      const encryptedPassword = password
        ? encryptDocumentPassword(password)
        : undefined;
      const currentVaultDocs =
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
      const currentKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};

      const updateDocPassword = (doc: any) => {
        if (doc?.docType !== docType) return doc;
        return {
          ...doc,
          ...(encryptedPassword ? { password: encryptedPassword } : {}),
        };
      };

      const nextVaultDocs = currentVaultDocs.map(updateDocPassword);
      const nextKycDocs = (currentKyc.documents || []).map(updateDocPassword);

      const updatedUser = await userService.updateById(
        targetUserId,
        {
          digiLockerVault: {
            ...(user.digiLockerVault || {}),
            syncedAt: new Date(),
            documents: nextVaultDocs,
          },
          kycProfile: {
            ...currentKyc,
            documents: nextKycDocs,
          },
        },
        { populate: false },
      );

      const sanitizedDocs = (updatedUser.digiLockerVault?.documents || []).map(
        (doc: any) => {
          const { password: _password, ...rest } = doc?.toObject
            ? doc.toObject()
            : doc;
          return rest;
        },
      );

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...(((updatedUser as any).digiLockerVault?.toObject
              ? (updatedUser as any).digiLockerVault.toObject()
              : updatedUser.digiLockerVault) || {}),
            documents: sanitizedDocs,
          },
          "Document password updated successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async loginUser(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email }).select("+password");
      const userData: any = await User.findOne({ email });

      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const payload = {
        role: "user",
        _id: userData._id,
        email: userData.email,
      };
      const token = jwt.sign(payload, config.jwt.secret, { expiresIn: "7d" });
      await safeNotify({
        type: "login-success",
        toUserId: userData._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: userData._id.toString(), role: UserType.USER },
        context: { loginTime: new Date().toLocaleString() },
      });
      res.status(200).json({
        user,
        token,
        success: true,
        message: "Login successful",
      });
    } catch (error) {
      console.log("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }

  static async generateOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { mobile: rawMobile } = req.body;

      if (!rawMobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      const mobile = await consumeOtpRequest(rawMobile, "user");
      let user = await User.findOne({ mobile });
      const existed = Boolean(user);
      if (!user) {
        // Don't auto-create user with placeholder email during OTP generation
        // User will be created only when they verify OTP and provide actual email
        // For now, just store the OTP and proceed
        user = null;
      }

      const isHardcodedOtpUser = String(mobile)
        .replace(/\D/g, "")
        .endsWith("9354697528");
      const otpCode = isHardcodedOtpUser
        ? "123456"
        : crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins expiry

      // Save or update OTP
      await Otp.findOneAndUpdate(
        { mobile },
        {
          mobile,
          expiresAt,
          otp: otpCode,
          verified: false,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Send OTP via Airtel IQ SMS in background to avoid blocking API response
      const maskedMobile = maskMobileForLogs(mobile);
      void sendSMS({
        to: mobile,
        otp: otpCode,
      })
        .then((dispatchResult) => {
          if (dispatchResult.success) {
            logger.info(`[OTP][User] SMS dispatched to=${maskedMobile}`);
            return;
          }
          logger.warn(
            `[OTP][User] SMS not dispatched to=${maskedMobile} reason=${dispatchResult.reason}`,
          );
        })
        .catch((smsError: unknown) => {
          const errMessage =
            smsError instanceof Error ? smsError.message : String(smsError);
          logger.error(
            `[OTP][User] SMS dispatch failed to=${maskedMobile} error=${errMessage}`,
          );
          // Don't fail the request, OTP is still valid for testing
        });

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
        existed,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const { _id: user } = (req as any).user;
      const result = await userService.deleteById(req.params.id || user);
      if (!result)
        return res.status(404).json(new ApiError(404, "Failed to delete city"));
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Deleted successfully"));
    } catch (err) {
      next(err);
    }
  }

  static async getAllUsers(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { userType } = req.params;
      const query: any = {
        ...req.query,
        role: userType,
      };
      const accountSourceGroup = String(query.accountSourceGroup || "")
        .trim()
        .toLowerCase();
      delete query.accountSourceGroup;

      const sourceStages: any[] = [];
      if (accountSourceGroup === AccountSource.WEBSITE) {
        query.accountSource = AccountSource.WEBSITE;
      } else if (accountSourceGroup === AccountSource.APP) {
        query.accountSource = AccountSource.APP;
      } else if (accountSourceGroup === "internal") {
        query.accountSource__in = `${AccountSource.ADMIN},${AccountSource.CRM}`;
      } else if (accountSourceGroup === AccountSource.UNKNOWN) {
        sourceStages.push({
          $match: {
            $or: [
              { accountSource: AccountSource.UNKNOWN },
              { accountSource: { $exists: false } },
              { accountSource: null },
              { accountSource: "" },
            ],
          },
        });
      }

      const result: any = await userService.getAll(query, sourceStages);

      if (Array.isArray(result?.result) && result.result.length > 0) {
        const users = result.result;
        const userIds = users
          .map((user: any) => String(user?._id || "").trim())
          .filter(Boolean);

        const referralEvents = await ReferralEvent.find({
          referredUser: { $in: userIds },
        })
          .select("referredUser referralCode referrer")
          .lean();

        const referralEventMap = new Map<string, any>();
        referralEvents.forEach((event: any) => {
          const key = String(event?.referredUser || "").trim();
          if (key && !referralEventMap.has(key)) {
            referralEventMap.set(key, event);
          }
        });

        const referrerIds = Array.from(
          new Set(
            users
              .map((user: any) => String(user?.referredBy || "").trim())
              .concat(
                referralEvents.map((event: any) =>
                  String(event?.referrer || "").trim(),
                ),
              )
              .filter(Boolean),
          ),
        );

        const referrers = referrerIds.length
          ? await User.find({ _id: { $in: referrerIds } })
            .select("name referralCode customerId mobile")
            .lean()
          : [];

        const referrerMap = new Map<string, any>();
        referrers.forEach((referrer: any) => {
          referrerMap.set(String(referrer?._id), referrer);
        });

        result.result = users.map((user: any) => {
          const event = referralEventMap.get(String(user?._id || ""));
          const referrerId = String(
            user?.referredBy || event?.referrer || "",
          ).trim();
          const referrer = referrerMap.get(referrerId);

          return {
            ...user,
            referredBy: referrerId || user?.referredBy || null,
            referredByName: referrer?.name || "-",
            usedReferralCode:
              event?.referralCode || referrer?.referralCode || "-",
          };
        });
      }

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Users fetched successfully"));
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
      const user = await userService.getById(_id);
      if (!user) {
        return res.status(404).json(new ApiError(404, "user not found"));
      }
      return res.status(200).json(
        new ApiResponse(
          200,
          user.notification || {
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
      const user = await userService.getById(_id);
      if (!user) {
        return res.status(404).json(new ApiError(404, "user not found"));
      }

      const nextPrefs = {
        sms:
          typeof req.body.sms === "boolean"
            ? req.body.sms
            : (user.notification?.sms ?? true),
        push:
          typeof req.body.push === "boolean"
            ? req.body.push
            : (user.notification?.push ?? true),
        email:
          typeof req.body.email === "boolean"
            ? req.body.email
            : (user.notification?.email ?? true),
        whatsapp:
          typeof req.body.whatsapp === "boolean"
            ? req.body.whatsapp
            : (user.notification?.whatsapp ?? true),
      };

      const result = await userService.updateById(_id, {
        notification: nextPrefs,
      });

      await safeNotify({
        type: "preferences-updated",
        toUserId: result._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: result._id.toString(), role: UserType.USER },
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
      const userId = req.user?._id || req.user?.id;
      const token = String(req.body?.token || req.body?.fcmToken || "").trim();
      if (!userId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!token) {
        return res.status(400).json(new ApiError(400, "FCM token is required"));
      }

      const platform = normalizePushPlatform(req.body?.platform);
      const deviceId = String(req.body?.deviceId || "").trim();
      const appVersion = String(req.body?.appVersion || "").trim();
      const now = new Date();

      await User.updateMany(
        {
          _id: { $ne: userId },
          $or: [{ fcmToken: token }, { "fcmTokens.token": token }],
        },
        {
          $unset: { fcmToken: "" },
          $pull: { fcmTokens: { token } },
        },
      );

      const user: any = await User.findById(userId);
      if (!user) return res.status(404).json(new ApiError(404, "User not found"));

      const existingTokens = Array.isArray(user.fcmTokens)
        ? user.fcmTokens
        : [];
      const tokenIndex = existingTokens.findIndex(
        (item: any) => item?.token === token,
      );

      if (tokenIndex >= 0) {
        existingTokens[tokenIndex] = {
          ...existingTokens[tokenIndex].toObject?.(),
          ...existingTokens[tokenIndex],
          token,
          active: true,
          platform,
          deviceId: deviceId || existingTokens[tokenIndex]?.deviceId,
          appVersion: appVersion || existingTokens[tokenIndex]?.appVersion,
          lastRegisteredAt: now,
          lastUsedAt: now,
        };
      } else {
        existingTokens.push({
          token,
          active: true,
          platform,
          deviceId,
          appVersion,
          lastRegisteredAt: now,
          lastUsedAt: now,
        });
      }

      user.fcmToken = token;
      user.fcmTokens = existingTokens
        .filter((item: any) => item?.token)
        .sort((a: any, b: any) => {
          const aTime = new Date(a?.lastRegisteredAt || 0).getTime();
          const bTime = new Date(b?.lastRegisteredAt || 0).getTime();
          return bTime - aTime;
        })
        .slice(0, 10);
      user.notification = {
        sms: user.notification?.sms ?? true,
        email: user.notification?.email ?? true,
        whatsapp: user.notification?.whatsapp ?? true,
        push: user.notification?.push ?? true,
      };

      await user.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            registered: true,
            platform,
            activeTokens: user.fcmTokens.filter((item: any) => item.active)
              .length,
          },
          "Push token registered successfully",
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
      const userId = req.user?._id || req.user?.id;
      const token = String(req.body?.token || req.body?.fcmToken || "").trim();
      if (!userId) {
        return res.status(401).json(new ApiError(401, "Unauthorized"));
      }
      if (!token) {
        return res.status(400).json(new ApiError(400, "FCM token is required"));
      }

      const user: any = await User.findById(userId);
      if (!user) return res.status(404).json(new ApiError(404, "User not found"));

      user.fcmTokens = (Array.isArray(user.fcmTokens) ? user.fcmTokens : []).map(
        (item: any) =>
          item?.token === token
            ? { ...item.toObject?.(), ...item, active: false }
            : item,
      );
      if (user.fcmToken === token) {
        const replacement = user.fcmTokens.find(
          (item: any) => item?.active && item?.token && item.token !== token,
        );
        user.fcmToken = replacement?.token || undefined;
      }

      await user.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          { unregistered: true },
          "Push token unregistered successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  static async getContactPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const user = await userService.getById(_id);
      if (!user) {
        return res.status(404).json(new ApiError(404, "user not found"));
      }
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { enabled: user.contactsSyncEnabled !== false },
            "Contact sync preferences fetched successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async updateContactPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const user = await userService.getById(_id);
      if (!user) {
        return res.status(404).json(new ApiError(404, "user not found"));
      }
      const enabled =
        typeof req.body.enabled === "boolean"
          ? req.body.enabled
          : user.contactsSyncEnabled === true;

      const result = await userService.updateById(_id, {
        contactsSyncEnabled: enabled,
      });

      if (!enabled) {
        // Instead of deleting, mark all contacts as unsynced
        await ContactSync.updateMany(
          { user: result._id },
          { $set: { synced: false } },
        );
      }

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { enabled: result.contactsSyncEnabled === true },
            "Contact sync preferences updated successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async syncContacts(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const user = await userService.getById(_id);
      if (!user) {
        return res.status(404).json(new ApiError(404, "user not found"));
      }
      if (user.contactsSyncEnabled === false) {
        return res
          .status(403)
          .json(new ApiError(403, "Contact sync is disabled"));
      }

      const contacts = Array.isArray(req.body?.contacts)
        ? req.body.contacts
        : [];
      const normalized = contacts
        .map((contact: any) => {
          const recordId =
            contact?.id || contact?.recordID || contact?.recordId;
          if (!recordId) return null;
          const phones = Array.isArray(contact?.phones)
            ? contact.phones.map((item: any) => String(item || "").trim())
            : [];
          return {
            recordId: String(recordId),
            name: String(contact?.name || contact?.displayName || "").trim(),
            phones: phones.filter(Boolean),
          };
        })
        .filter(Boolean) as {
        recordId: string;
        name: string;
        phones: string[];
      }[];

      const now = new Date();
      if (normalized.length === 0) {
        await ContactSync.deleteMany({ user: user._id });
        return res
          .status(200)
          .json(
            new ApiResponse(200, { count: 0 }, "Contacts synced successfully"),
          );
      }

      const ops = normalized.map((contact) => ({
        updateOne: {
          filter: { user: user._id, recordId: contact.recordId },
          update: {
            $set: {
              name: contact.name,
              phones: contact.phones,
              syncedAt: now,
              synced: true,
            },
            $setOnInsert: {
              user: user._id,
              recordId: contact.recordId,
            },
          },
          upsert: true,
        },
      }));

      await ContactSync.bulkWrite(ops, { ordered: false });
      const recordIds = normalized.map((item) => item.recordId);
      await ContactSync.deleteMany({
        user: user._id,
        recordId: { $nin: recordIds },
      });

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { count: normalized.length },
            "Contacts synced successfully",
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const { id } = req.params;
      const profilePicture = req.body.profilePicture?.[0]?.url;
      const existingUser = await userService.getById(id || _id);
      if (!existingUser)
        return res.status(404).json(new ApiError(404, "user not found"));

      let avatar;
      if (req.body.avatar?.[0]?.url)
        avatar = await extractImageUrl(
          req.body.avatar,
          existingUser?.avatar as string,
        );
      if (!avatar && profilePicture) {
        avatar = await extractImageUrl(
          req.body.profilePicture,
          existingUser?.avatar as string,
        );
      }

      const data: any = { ...req.body, avatar: avatar || profilePicture };
      const incomingPan = normalizePanCard(
        req.body?.panCard ||
          req.body?.personalDetails?.panNumber ||
          req.body?.personalDetails?.panCard ||
          req.body?.panNumber,
      );
      if (incomingPan) {
        data.panCard = await assertPanCardAvailable(
          incomingPan,
          (id || _id).toString(),
        );
      }
      data.notification = resolveNotificationPayload(req.body, existingUser);
      const result = await userService.updateById(id || _id, data);
      await safeNotify({
        type: "profile-updated",
        toUserId: result._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: result._id.toString(), role: UserType.USER },
        context: { source: "profile" },
      });
      return res
        .status(200)
        .json(new ApiResponse(200, result, `User updated successfully`));
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, otp, email, name } = req.body;
      const accountSource = resolveAccountSource(req);

      if (!mobile || !otp) {
        return res.status(400).json({
          success: false,
          message: "Phone number and OTP are required",
        });
      }

      const otpDoc = await Otp.findOne({ mobile, otp });

      if (!otpDoc || otpDoc.expiresAt < new Date()) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired OTP" });
      }

      if (otpDoc.verified) {
        return res
          .status(400)
          .json({ success: false, message: "OTP already used" });
      }

      otpDoc.verified = true;
      await otpDoc.save();

      let user: any = await User.findOne({ mobile });
      const accountExisted = Boolean(user);

      // If user doesn't exist, create a minimal account so the verified phone
      // can continue through the onboarding flow without requesting OTP again.
      if (!user) {
        const providedEmail = String(email || "")
          .trim()
          .toLowerCase();
        const fallbackEmail = `${mobile}@mobile.fintaraa.local`;
        const nextEmail = providedEmail || fallbackEmail;

        // Check if email is already taken when a real email is provided
        const emailTaken = providedEmail
          ? await User.findOne({ email: providedEmail })
          : null;
        if (emailTaken) {
          return res.status(400).json({
            success: false,
            message: "Email already in use",
          });
        }

        // Create new user
        const referralCode = await generateReferralCode();
        user = await User.create({
          mobile,
          email: nextEmail,
          name: name || `User ${mobile.slice(-4)}`,
          role: "user",
          agreedToTerms: true,
          privacyPolicyAccepted: true,
          status: UserStatus.ACTIVE,
          isMobileVerified: true,
          isEmailVerified: false,
          referralCode,
          accountSource,
          password:
            crypto.randomBytes(12).toString("hex") +
            "@" +
            Date.now().toString(16),
        });
      } else if (
        accountSource !== AccountSource.UNKNOWN &&
        (!user.accountSource || user.accountSource === AccountSource.UNKNOWN)
      ) {
        user.accountSource = accountSource;
      }

      if ([UserStatus.SUSPENDED, UserStatus.INACTIVE].includes(user.status)) {
        return res
          .status(403)
          .json({ success: false, message: `Account ${user.status}` });
      }

      user.isMobileVerified = true;
      user.status = UserStatus.ACTIVE;

      const payload = { _id: user._id, email: user.email, role: user.role };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);
      user.refreshToken = refreshToken;
      await user.save();

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.env === "production",
        maxAge: config.jwt.maxAge * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        message: "OTP verified successfully. Login complete.",
        token: accessToken,
        user,
        accountExisted,
        needsProfileCompletion:
          !user?.name ||
          String(user?.name || "")
            .toLowerCase()
            .startsWith("user ") ||
          !user?.panCard,
      });
    } catch (error) {
      next(error);
    }
  }

  static async completeKycProfile(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

      const personalDetails = parseJSONSafely(
        req.body.personalDetails,
        {},
      ) as Record<string, any>;
      const normalizedPanNumber = personalDetails?.panNumber
        ? await assertPanCardAvailable(
            personalDetails.panNumber,
            _id.toString(),
          )
        : "";
      if (normalizedPanNumber) {
        personalDetails.panNumber = normalizedPanNumber;
      }
      const addressDetails = parseJSONSafely(
        req.body.addressDetails,
        null,
      ) as Record<string, any> | null;
      const employmentDetails = parseJSONSafely(req.body.employmentDetails, {});
      const financialDetails = parseJSONSafely(
        req.body.financialDetails,
        {},
      ) as Record<string, any>;
      const bankDetails = parseJSONSafely(req.body.bankDetails, {}) as Record<
        string,
        any
      >;
      const verification = parseJSONSafely(req.body.verification, {}) as Record<
        string,
        any
      >;

      const serializedKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};

      const documentsPayload = normalizeDocumentEntries(
        req.body.documents,
        "kyc_document",
      );
      const uploadedDocs = [
        ...mapUploadsToDocuments(req.body.kycDocuments, "kyc_document"),
        ...mapUploadsToDocuments(req.body.addressProof, "address_proof"),
        ...mapUploadsToDocuments(req.body.incomeProof, "income_proof"),
      ];

      const normalizeAddress = (addr: any) => {
        if (!addr) return undefined;
        if (typeof addr === "string") {
          const street = addr.trim();
          if (!street) return undefined;
          return {
            street,
            country: "India",
            label: "home",
            isDefault: true,
          };
        }
        if (typeof addr !== "object") return undefined;
        const hasValue = [
          "street",
          "address",
          "city",
          "state",
          "country",
          "postalCode",
          "pinCode",
          "pincode",
        ].some((key) => Boolean(addr[key]));
        if (!hasValue) return undefined;
        return {
          street: addr.street || addr.address,
          city: addr.city,
          state: addr.state,
          country: addr.country || "India",
          postalCode: addr.postalCode || addr.pinCode || addr.pincode,
          label: addr.label || "home",
          isDefault: addr.isDefault ?? true,
        };
      };

      const currentAddress = addressDetails
        ? normalizeAddress(
            addressDetails.currentAddress ||
              addressDetails.address ||
              addressDetails,
          )
        : undefined;
      const permanentAddress = addressDetails
        ? normalizeAddress(addressDetails.permanentAddress) || currentAddress
        : undefined;

      const kycUpdate: IKycProfile = {
        reusableAcrossApplications:
          req.body.reusableAcrossApplications ??
          serializedKyc.reusableAcrossApplications ??
          true,
        personalDetails: {
          ...(serializedKyc.personalDetails || {}),
          ...personalDetails,
        },
        addressDetails: {
          ...(serializedKyc.addressDetails || {}),
          ...(addressDetails || {}),
          ...(currentAddress
            ? {
                currentAddress: {
                  ...(serializedKyc.addressDetails?.currentAddress || {}),
                  ...currentAddress,
                },
              }
            : {}),
          ...(permanentAddress
            ? {
                permanentAddress: {
                  ...(serializedKyc.addressDetails?.permanentAddress || {}),
                  ...permanentAddress,
                },
              }
            : {}),
        },
        employmentDetails: {
          ...(serializedKyc.employmentDetails || {}),
          ...employmentDetails,
        },
        financialDetails: {
          ...(serializedKyc.financialDetails || {}),
          ...financialDetails,
        },
        documents: mergeDocuments(serializedKyc.documents || [], [
          ...documentsPayload,
          ...uploadedDocs,
        ]),
        verification: {
          ...(serializedKyc.verification || {
            status: KycVerificationStatus.IN_PROGRESS,
          }),
          ...verification,
        },
      };

      const preferredProductsPrimary = normalizePreferredProducts(
        financialDetails?.preferredProducts,
      );
      const preferredProductsFallback = normalizePreferredProducts(
        req.body.preferredProducts,
      );
      const preferredProducts =
        preferredProductsPrimary.length > 0
          ? preferredProductsPrimary
          : preferredProductsFallback;

      if (preferredProducts.length) {
        kycUpdate.financialDetails = {
          ...(kycUpdate.financialDetails || {}),
          preferredProducts,
        };
      }

      const updatePayload: any = {
        kycProfile: kycUpdate,
      };

      if (personalDetails?.fullName) {
        updatePayload.name = personalDetails.fullName;
      } else if (req.body?.name) {
        updatePayload.name = req.body.name;
      }

      if (personalDetails?.email) {
        const normalizedEmail = String(personalDetails.email)
          .trim()
          .toLowerCase();
        if (normalizedEmail && normalizedEmail !== user.email) {
          const emailTaken = await User.findOne({
            email: normalizedEmail,
            _id: { $ne: user._id },
          }).select("_id");
          if (emailTaken) {
            return res
              .status(400)
              .json(new ApiError(400, "Email already in use"));
          }
          updatePayload.email = normalizedEmail;
          updatePayload.isEmailVerified = false;
        }
      }

      if (currentAddress) {
        const existingAddresses = (user.addresses || []).map((addr: any) =>
          addr?.toObject ? addr.toObject() : addr,
        );
        const updatedAddresses = [...existingAddresses];
        if (updatedAddresses.length === 0) {
          updatedAddresses.push(currentAddress);
        } else {
          updatedAddresses[0] = {
            ...updatedAddresses[0],
            ...currentAddress,
            isDefault: true,
          };
        }
        updatePayload.addresses = updatedAddresses;
      }

      if (personalDetails?.panNumber)
        updatePayload.panCard = personalDetails.panNumber;
      if (personalDetails?.aadhaarNumber)
        updatePayload.aadhaarCard = personalDetails.aadhaarNumber;

      if (bankDetails && Object.keys(bankDetails).length > 0) {
        if (!bankDetails.branchCity && (bankDetails.city || bankDetails.branchName)) {
          bankDetails.branchCity = bankDetails.city || bankDetails.branchName;
        }
        updatePayload.bankDetails = {
          ...(user.bankDetails?.toObject
            ? user.bankDetails.toObject()
            : user.bankDetails || {}),
          ...bankDetails,
        };
      }

      if (kycUpdate.documents?.length) {
        const currentVaultDocs =
          (user.digiLockerVault?.documents || []).map((doc: any) => doc) || [];
        updatePayload.digiLockerVault = {
          storageProvider: user.digiLockerVault?.storageProvider || "internal",
          syncedAt: new Date(),
          documents: mergeDocuments(currentVaultDocs, kycUpdate.documents),
        };
      }

      const loanProfileUpdates: any = {};
      if (preferredProducts.length) {
        loanProfileUpdates.preferredProducts = preferredProducts;
      }
      if (financialDetails?.creditScore) {
        loanProfileUpdates.eligibilityScore = financialDetails.creditScore;
        loanProfileUpdates.lastEligibilityCheck = new Date();
      }

      if (Object.keys(loanProfileUpdates).length > 0) {
        loanProfileUpdates.reusableProfileReferenceId =
          user.loanCreditProfile?.reusableProfileReferenceId ||
          `LP-${user._id}`;
        updatePayload.loanCreditProfile = {
          ...(user.loanCreditProfile || {}),
          ...loanProfileUpdates,
        };
      }

      if (verification?.status === KycVerificationStatus.VERIFIED) {
        updatePayload.status = UserStatus.ACTIVE;
      } else if (verification?.status === KycVerificationStatus.REJECTED) {
        updatePayload.status = UserStatus.SUSPENDED;
      }

      const updatedUser = await userService.updateById(_id, updatePayload, {
        populate: false,
      });

      if (verification?.status === KycVerificationStatus.VERIFIED) {
        await rewardReferralIfEligible(_id);
        await safeNotify({
          type: "kyc-verified",
          toUserId: updatedUser._id.toString(),
          toRole: UserType.USER,
          fromUser: { _id: updatedUser._id.toString(), role: UserType.USER },
        });
      }
      await safeNotify({
        type: "kyc-profile-updated",
        toUserId: updatedUser._id.toString(),
        toRole: UserType.USER,
        fromUser: { _id: updatedUser._id.toString(), role: UserType.USER },
      });

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedUser, "KYC profile updated successfully"),
        );
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentUser(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { _id: userId, role } = (req as any).user || {};
      if (!userId || role !== "user") {
        throw new ApiError(401, "User session required");
      }
      let result: any = await userService.getById(userId);
      if (!result?.referralCode) {
        const referralCode = await generateReferralCode();
        result = await userService.updateById(userId, { referralCode });
      }
      return res
        .status(200)
        .json(new ApiResponse(200, result, `User fetched successfully`));
    } catch (error) {
      next(error); // Pass errors to the error handling middleware
    }
  }

  static async getAllOTPLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const response = await otpService.getAll(req.query);
      return res
        .status(200)
        .json(new ApiResponse(200, response, "User fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const userId = req.params.id;
      const response = await userService.getById(userId);
      return res
        .status(200)
        .json(new ApiResponse(200, response, "User fetched successfully"));
    } catch (error) {
      next(error);
    }
  }
}
