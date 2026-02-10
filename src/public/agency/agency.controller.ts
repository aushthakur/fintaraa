import crypto from "crypto";
import Otp from "../../modals/otp.model";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import { sendSMS } from "../../utils/smsService";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { Request, Response, NextFunction } from "express";
import { UserType } from "../../modals/notification.model";
import { Agency, AgencyRole } from "../../modals/agency.model";
import { CommonService } from "../../services/common.services";
import { UserStatus, IKycProfile } from "../../modals/user.model";
import { sendSingleNotification } from "../../services/notification.service";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";

const agencyService = new CommonService(Agency);

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

export class AgencyController {
  static async sendOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, name, email, parentAgencyId } = req.body;
      if (!mobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      let agency: any = await Agency.findOne({ mobile });
      if (!agency) {
        const placeholderEmail = email || `${mobile}@agency.fintara`;
        const role: AgencyRole = parentAgencyId ? "agency_member" : "agency";
        agency = await Agency.create({
          mobile,
          role,
          parentAgency: parentAgencyId || undefined,
          agreedToTerms: true,
          privacyPolicyAccepted: true,
          name: name || `Agency ${mobile.slice(-4)}`,
          email: placeholderEmail,
          status: UserStatus.PENDING_VERIFICATION,
          password: crypto.randomBytes(10).toString("hex"),
        });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await Otp.findOneAndUpdate(
        { mobile },
        { mobile, expiresAt, otp: otpCode, verified: false },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Send OTP via Airtel IQ SMS
      try {
        await sendSMS({
          to: mobile,
          otp: otpCode,
        });
        console.log(`Agency OTP sent to ${mobile}: ${otpCode} (via Airtel IQ)`);
      } catch (smsError: any) {
        console.error(
          `Failed to send Agency OTP SMS to ${mobile}:`,
          smsError.message,
        );
      }

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, otp } = req.body;
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

      const agency: any = await Agency.findOne({ mobile });
      if (!agency) {
        return res
          .status(404)
          .json({ success: false, message: "Agency not found" });
      }

      if ([UserStatus.SUSPENDED, UserStatus.INACTIVE].includes(agency.status)) {
        return res
          .status(403)
          .json({ success: false, message: `Account ${agency.status}` });
      }

      agency.isMobileVerified = true;
      agency.status = UserStatus.ACTIVE;

      const payload = {
        _id: agency._id,
        email: agency.email,
        role: agency.role || "agency",
      };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      agency.refreshToken = refreshToken;
      await agency.save();

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
        agency: {
          _id: agency._id,
          role: agency.role || "agency",
          email: agency.email,
          name: agency.name,
          mobile: agency.mobile,
          parentAgency: agency.parentAgency,
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
      const agency = await agencyService.getById(_id);
      if (!agency)
        return res.status(404).json(new ApiError(404, "Agency not found"));

      return res
        .status(200)
        .json(
          new ApiResponse(200, agency, "Agency details fetched successfully"),
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
          new ApiResponse(200, members, "Team members fetched successfully"),
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
        .json(new ApiResponse(200, member, "Team member fetched successfully"));
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
      const documents = parseJSONSafely(req.body.documents, []);

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
        status: UserStatus.PENDING_VERIFICATION,
        password: crypto.randomBytes(10).toString("hex"),
        notification: { sms: true, push: true, email: true, whatsapp: true },
        avatar: avatar || profilePicture,
        kycProfile: {
          reusableAcrossApplications: normalizeBoolean(
            req.body.reusableAcrossApplications,
            true,
          ),
          personalDetails,
          addressDetails,
          employmentDetails,
          financialDetails,
          documents: Array.isArray(documents) ? documents : [],
        },
        ...(bankDetails && Object.keys(bankDetails).length
          ? { bankDetails }
          : {}),
      });

      return res
        .status(201)
        .json(new ApiResponse(201, member, "Team member created successfully"));
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
      const bankDetails = parseJSONSafely(req.body.bankDetails, {});
      const documents = parseJSONSafely(req.body.documents, []);

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
        documents: Array.isArray(documents) ? documents : existingKyc.documents,
      };

      if (personalDetails?.fullName) member.name = personalDetails.fullName;
      if (personalDetails?.email) member.email = personalDetails.email;
      if (personalDetails?.mobile) member.mobile = personalDetails.mobile;
      if (req.body.status) {
        member.status = req.body.status;
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
        member.bankDetails = {
          ...(member.bankDetails?.toObject
            ? member.bankDetails.toObject()
            : member.bankDetails || {}),
          ...bankDetails,
        };
      }

      await member.save();

      return res
        .status(200)
        .json(new ApiResponse(200, member, "Team member updated successfully"));
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
        { new: true, populate: false },
      );

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

  static async updateAgency(
    req: Request | any,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { _id } = req.user;
      const { id } = req.params;
      const existing = await agencyService.getById(id || _id);
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

      const data: any = { ...req.body, avatar: avatar || profilePicture };
      const result = await agencyService.updateById(id || _id, data);

      return res
        .status(200)
        .json(new ApiResponse(200, result, "Agency updated successfully"));
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
      const bankDetails = parseJSONSafely(req.body.bankDetails, {});
      const documents = parseJSONSafely(req.body.documents, []);

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
        documents: Array.isArray(documents) ? documents : existingKyc.documents,
      };

      agency.kycProfile = kycProfile;
      if (personalDetails?.fullName) {
        agency.name = personalDetails.fullName;
      }
      if (personalDetails?.email) {
        agency.email = personalDetails.email;
      }
      if (personalDetails?.mobile) {
        agency.mobile = personalDetails.mobile;
      }
      if (bankDetails && Object.keys(bankDetails).length > 0) {
        agency.bankDetails = {
          ...(agency.bankDetails?.toObject
            ? agency.bankDetails.toObject()
            : agency.bankDetails || {}),
          ...bankDetails,
        };
      }
      await agency.save();

      return res
        .status(200)
        .json(new ApiResponse(200, agency, "KYC profile updated successfully"));
    } catch (error) {
      next(error);
    }
  }
}
