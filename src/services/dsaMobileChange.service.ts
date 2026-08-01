import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Types } from "mongoose";
import { config } from "../config/config";
import { logger } from "../config/logger";
import { Agency } from "../modals/agency.model";
import { DsaMobileChangeOtp } from "../modals/dsaMobileChangeOtp.model";
import {
  consumeOtpRequest,
  releaseOtpRequest,
} from "./otpRateLimit.service";
import {
  assertOtpVerificationAllowed,
  recordOtpVerificationFailure,
  resetOtpVerificationAttempts,
} from "./otpVerificationLimit.service";
import ApiError from "../utils/ApiError";
import { maskMobileForLogs, sendSMS } from "../utils/smsService";

const OTP_TTL_MS = 5 * 60 * 1000;

export const normalizeDsaMobile = (value: unknown) => {
  const mobile = String(value || "").replace(/\D/g, "");
  if (mobile.length < 10 || mobile.length > 15) {
    throw new ApiError(400, "Enter a valid mobile number");
  }
  return mobile;
};

const usesStaticOtp = (mobile: string) =>
  config.env !== "production" &&
  Boolean(config.otp.staticMobile && config.otp.staticCode) &&
  mobile.endsWith(config.otp.staticMobile);

const requireAgencyId = (value: unknown) => {
  if (!Types.ObjectId.isValid(String(value || ""))) {
    throw new ApiError(401, "DSA authentication is required");
  }
  return new Types.ObjectId(String(value));
};

export class DsaMobileChangeService {
  async sendOtp(input: { agencyId: unknown; mobile: unknown; ip?: unknown }) {
    const agencyId = requireAgencyId(input.agencyId);
    const mobile = await consumeOtpRequest(input.mobile, "agency");
    try {
      const agency = await Agency.findById(agencyId)
        .select("_id mobile role")
        .lean();
      if (!agency || !["agency", "agency_member"].includes(agency.role)) {
        throw new ApiError(404, "DSA account not found");
      }
      if (normalizeDsaMobile(agency.mobile) === mobile) {
        throw new ApiError(400, "New mobile number must be different");
      }
      if (await Agency.exists({ mobile, _id: { $ne: agencyId } })) {
        throw new ApiError(409, "Mobile number already belongs to another account");
      }

      const otp = usesStaticOtp(mobile)
        ? config.otp.staticCode
        : crypto.randomInt(100000, 1000000).toString();
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + OTP_TTL_MS);
      await DsaMobileChangeOtp.findOneAndUpdate(
        { agency: agencyId, mobile },
        {
          $set: { otpHash, expiresAt },
          $unset: { consumedAt: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await resetOtpVerificationAttempts(mobile, "agency", input.ip, {
        includeIp: false,
      });

      if (usesStaticOtp(mobile)) {
        logger.info(
          `[OTP][DSA mobile change] Static test OTP prepared to=${maskMobileForLogs(mobile)}; SMS dispatch skipped`,
        );
      } else {
        await sendSMS({ to: mobile, otp });
      }
      return { mobile, expiresInSeconds: OTP_TTL_MS / 1000 };
    } catch (error) {
      await Promise.all([
        DsaMobileChangeOtp.deleteOne({ agency: agencyId, mobile }).catch(() => undefined),
        releaseOtpRequest(mobile, "agency").catch(() => undefined),
      ]);
      throw error;
    }
  }

  async verifyOtp(input: {
    agencyId: unknown;
    mobile: unknown;
    otp: unknown;
    ip?: unknown;
  }) {
    const agencyId = requireAgencyId(input.agencyId);
    const mobile = normalizeDsaMobile(input.mobile);
    const otp = String(input.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) throw new ApiError(400, "Enter a valid OTP");

    await assertOtpVerificationAllowed(mobile, "agency", input.ip);
    const challenge: any = await DsaMobileChangeOtp.findOne({
      agency: agencyId,
      mobile,
      consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).select("+otpHash");
    const matches = Boolean(challenge) && (await bcrypt.compare(otp, challenge.otpHash));
    if (!matches) {
      const locked = await recordOtpVerificationFailure(
        mobile,
        "agency",
        input.ip,
      );
      throw new ApiError(
        locked ? 429 : 400,
        locked
          ? "Too many invalid OTP attempts. Request a new OTP or try again later."
          : "Invalid or expired OTP",
      );
    }

    const claimed = await DsaMobileChangeOtp.findOneAndUpdate(
      {
        _id: challenge._id,
        agency: agencyId,
        mobile,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { consumedAt: new Date() } },
      { new: true },
    );
    if (!claimed) throw new ApiError(409, "OTP has already been used");

    try {
      const updated: any = await Agency.findOneAndUpdate(
        { _id: agencyId, mobile: { $ne: mobile } },
        {
          $set: {
            mobile,
            isMobileVerified: true,
            "kycProfile.personalDetails.mobile": mobile,
          },
        },
        { new: true, runValidators: true },
      );
      if (!updated) throw new ApiError(404, "DSA account not found");
      await resetOtpVerificationAttempts(mobile, "agency", input.ip);
      return updated;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ApiError(409, "Mobile number already belongs to another account");
      }
      throw error;
    }
  }
}

export const dsaMobileChangeService = new DsaMobileChangeService();
