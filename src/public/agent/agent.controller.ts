import { Request, Response, NextFunction } from "express";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";
import Otp from "../../modals/otp.model";
import Agent from "../../modals/agent.model";
import { config } from "../../config/config";
import { logger } from "../../config/logger";
import { maskMobileForLogs, sendSMS } from "../../utils/smsService";

const normalizeIndianMobile = (value: string): string => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
};

const buildMobileVariants = (value: string): string[] => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = normalizeIndianMobile(raw);
  const variants = new Set<string>();

  if (raw) variants.add(raw);
  if (digits) variants.add(digits);
  if (normalized) variants.add(normalized);

  if (normalized.length === 10) {
    variants.add(`91${normalized}`);
    variants.add(`+91${normalized}`);
  }

  return Array.from(variants);
};

export class AgentAuthController {
  static async sendOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { mobile } = req.body;
      const submittedMobile = String(mobile || "").trim();
      if (!submittedMobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      const normalizedMobile = normalizeIndianMobile(submittedMobile);
      const mobileVariants = buildMobileVariants(submittedMobile);
      const otpMobile =
        normalizedMobile.length === 10 ? normalizedMobile : submittedMobile;

      const agent = await Agent.findOne({
        mobile: { $in: mobileVariants },
      });
      if (!agent) {
        return res.status(404).json({
          success: false,
          message: "Agent not found with this mobile number",
        });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await Otp.findOneAndUpdate(
        { mobile: otpMobile },
        {
          mobile: otpMobile,
          expiresAt,
          otp: otpCode,
          verified: false,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Send OTP via Airtel IQ SMS in background to avoid blocking API response
      const maskedMobile = maskMobileForLogs(otpMobile);
      void sendSMS({
        to: otpMobile,
        otp: otpCode,
      })
        .then((dispatchResult) => {
          if (dispatchResult.success) {
            logger.info(`[OTP][Agent] SMS dispatched to=${maskedMobile}`);
            return;
          }
          logger.warn(
            `[OTP][Agent] SMS not dispatched to=${maskedMobile} reason=${dispatchResult.reason}`,
          );
        })
        .catch((smsError: unknown) => {
          const errMessage =
            smsError instanceof Error ? smsError.message : String(smsError);
          logger.error(
            `[OTP][Agent] SMS dispatch failed to=${maskedMobile} error=${errMessage}`,
          );
        });

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { mobile, otp } = req.body;
      const submittedMobile = String(mobile || "").trim();
      const mobileVariants = buildMobileVariants(submittedMobile);
      const normalizedMobile = normalizeIndianMobile(submittedMobile);

      if (!submittedMobile || !otp) {
        return res.status(400).json({
          success: false,
          message: "Phone number and OTP are required",
        });
      }

      const otpMobiles = Array.from(
        new Set<string>(
          [submittedMobile, normalizedMobile, ...mobileVariants].filter(
            Boolean,
          ),
        ),
      );

      const otpDoc = await Otp.findOne({ mobile: { $in: otpMobiles }, otp });
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

      const agent: any = await Agent.findOne({
        mobile: { $in: mobileVariants },
      }).populate("role");
      if (!agent) {
        return res
          .status(404)
          .json({ success: false, message: "Agent not found" });
      }

      const payload = {
        _id: agent._id,
        email: agent.email,
        role: agent?.role?.name ?? "agent",
      };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      agent.refreshToken = refreshToken;
      await agent.save();

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
        agent: {
          _id: agent._id,
          role: agent?.role?.name ?? "agent",
          email: agent.email,
          name: agent.name,
          mobile: agent.mobile,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
