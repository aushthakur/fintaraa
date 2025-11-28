import jwt from "jsonwebtoken";
import Otp from "../../modals/otp.model";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import ApiResponse from "../../utils/ApiResponse";
import { extractImageUrl } from "../../utils/helper";
import { sendEmail } from "../../utils/emailService";
import { Request, Response, NextFunction } from "express";
import {
  User,
  UserStatus,
  IKycProfile,
  LoginMethodType,
  KycVerificationStatus,
  LoanProductType,
} from "../../modals/user.model";
import { CommonService } from "../../services/common.services";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";

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
  fallbackType = "supporting_document"
) => {
  return toArrayPayload(docs)
    .map((doc: any) => {
      if (!doc) return null;
      if (typeof doc === "string")
        return { docType: fallbackType, fileUrl: doc };
      return {
        docType: doc.docType || doc.type || fallbackType,
        number: doc.number || doc.docNumber,
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
  fallbackType = "supporting_document"
) => {
  return toArrayPayload(uploads)
    .map((file: any) => ({
      docType: file?.docType || fallbackType,
      fileUrl: file?.url,
      number: file?.number,
      issuer: file?.issuer || "user_uploaded",
      referenceId: file?.name,
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
          (type) => type === normalizedValue
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
    (value) => value === normalized
  );
  return (match as LoginMethodType) || null;
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

      if (!email || !mobile || !name) {
        return res
          .status(400)
          .json(new ApiError(400, "Missing required fields"));
      }

      const baseKycDocuments = [
        panCardUrl && {
          docType: "pan_card",
          number: panCard,
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
          panNumber: panCard,
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
        panCard,
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
        status:
          role === "user" ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
      };

      if (digiLockerVault) userData.digiLockerVault = digiLockerVault;

      const eixsts = await User.findOne({ mobile, email });
      if (eixsts) {
        return res
          .status(400)
          .json(new ApiError(400, "Phone Number & Email ID Already Exist!"));
      }
      const response = await userService.create(userData);
      return res
        .status(201)
        .json(
          new ApiResponse(
            201,
            response,
            `Account created successfully! Please verify your account!`
          )
        );
    } catch (error) {
      console.log("Error: ", error);
      next(error);
    }
  }

  static async updateSecurityPreferences(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id } = req.user;
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

      const bodyPreferredMfa = toArrayPayload(req.body.preferredMfaMethods);
      const loginMethodPayload = toArrayPayload(req.body.loginMethods);
      const trustedDevicePayload = parseJSONSafely(
        req.body.trustedDevice,
        req.body.trustedDevice
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
            (device: any) => device.deviceId !== trustedDevicePayload.deviceId
          ),
          {
            ...trustedDevicePayload,
            lastLoginAt:
              trustedDevicePayload.lastLoginAt || new Date().toISOString(),
          },
        ];
      }

      const existingMethods = (user.loginMethods || []).map((method: any) =>
        method?.toObject ? method.toObject() : method
      );
      const methodMap = new Map<string, any>();
      existingMethods.forEach((method: any) =>
        methodMap.set(method.type, { ...method })
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
              : methodMap.get(normalized)?.enabled ?? true,
          verified:
            typeof method?.verified === "boolean"
              ? method.verified
              : methodMap.get(normalized)?.verified ?? false,
          lastUsedAt:
            method?.lastUsedAt || methodMap.get(normalized)?.lastUsedAt,
        });
      });

      const updatePayload: any = { securityPreferences };
      if (methodMap.size) {
        updatePayload.loginMethods = Array.from(methodMap.values());
      }

      const updatedUser = await userService.updateById(_id, updatePayload, {
        new: true,
        populate: false,
      });

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedUser.securityPreferences,
            "Security preferences updated"
          )
        );
    } catch (error) {
      next(error);
    }
  }

  static async syncDigiLocker(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id } = req.user;
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

      const storageProvider = req.body.storageProvider || "internal";
      const defaultDocType = req.body.defaultDocType || "digital_document";

      const providedDocs = normalizeDocumentEntries(
        req.body.documents,
        defaultDocType
      );
      const uploadedDocs = mapUploadsToDocuments(
        req.body.digiLockerFiles || req.body.documentsUpload,
        defaultDocType
      );

      const currentVaultDocs =
        JSON.parse(JSON.stringify(user.digiLockerVault?.documents || [])) || [];
      const mergedDocs = mergeDocuments(currentVaultDocs, [
        ...providedDocs,
        ...uploadedDocs,
      ]);

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
        { new: true, populate: false }
      );

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            updatedUser.digiLockerVault,
            "DigiLocker vault synced successfully"
          )
        );
    } catch (error) {
      next(error);
    }
  }

  static async getDigiLockerDocuments(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id } = req.user;
      const user = await userService.getById(_id, false);
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            user?.digiLockerVault || {},
            "DigiLocker vault fetched successfully"
          )
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
    next: NextFunction
  ): Promise<any> {
    try {
      const { mobile } = req.body;

      if (!mobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      const user = await User.findOne({ mobile });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "No user found with this phone number",
        });
      }

      const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins expiry

      // Save or update OTP
      await Otp.findOneAndUpdate(
        { mobile },
        {
          expiresAt,
          mobile,
          otp: otpCode,
          verified: false,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // TODO: Integrate real SMS service like Twilio or Fast2SMS
      console.log(`OTP sent to ${mobile}: ${otpCode}`);
      await sendEmail({
        otp: otpCode,
        to: user?.email,
        userName: user?.name,
      });

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
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
    next: NextFunction
  ): Promise<any> {
    try {
      const { userType } = req.params;
      const result = await userService.getAll({ ...req.query, role: userType });
      return res
        .status(200)
        .json(new ApiResponse(200, result, "Users fetched successfully"));
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(
    req: Request | any,
    res: Response,
    next: NextFunction
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
          existingUser?.avatar as string
        );

      const data: any = { ...req.body, avatar: avatar || profilePicture };
      const result = await userService.updateById(id || _id, data);
      return res
        .status(200)
        .json(new ApiResponse(200, result, `User updated successfully`));
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

      const user: any = await User.findOne({ mobile });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
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
      });
    } catch (error) {
      next(error);
    }
  }

  static async completeKycProfile(
    req: Request | any,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { _id } = req.user;
      const user: any = await User.findById(_id);
      if (!user) return next(new ApiError(404, "User not found"));

      const personalDetails = parseJSONSafely(
        req.body.personalDetails,
        {}
      ) as Record<string, any>;
      const addressDetails = parseJSONSafely(
        req.body.addressDetails,
        {}
      ) as Record<string, any>;
      const employmentDetails = parseJSONSafely(req.body.employmentDetails, {});
      const financialDetails = parseJSONSafely(
        req.body.financialDetails,
        {}
      ) as Record<string, any>;
      const verification = parseJSONSafely(req.body.verification, {}) as Record<
        string,
        any
      >;

      const serializedKyc: IKycProfile =
        JSON.parse(JSON.stringify(user.kycProfile || {})) || {};

      const documentsPayload = normalizeDocumentEntries(
        req.body.documents,
        "kyc_document"
      );
      const uploadedDocs = [
        ...mapUploadsToDocuments(req.body.kycDocuments, "kyc_document"),
        ...mapUploadsToDocuments(req.body.addressProof, "address_proof"),
        ...mapUploadsToDocuments(req.body.incomeProof, "income_proof"),
      ];

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
          ...addressDetails,
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
        financialDetails?.preferredProducts
      );
      const preferredProductsFallback = normalizePreferredProducts(
        req.body.preferredProducts
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

      if (personalDetails?.panNumber)
        updatePayload.panCard = personalDetails.panNumber;
      if (personalDetails?.aadhaarNumber)
        updatePayload.aadhaarCard = personalDetails.aadhaarNumber;

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
        new: true,
      });

      return res
        .status(200)
        .json(
          new ApiResponse(200, updatedUser, "KYC profile updated successfully")
        );
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<any> {
    try {
      const { _id: userId } = (req as any).user;
      const result = await userService.getById(userId);
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
    next: NextFunction
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
    next: NextFunction
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
