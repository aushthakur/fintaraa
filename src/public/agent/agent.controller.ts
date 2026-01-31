import { Request, Response, NextFunction } from "express";
import { generateAccessToken, generateRefreshToken } from "../../utils/token";
import Otp from "../../modals/otp.model";
import Agent from "../../modals/agent.model";
import { config } from "../../config/config";
import { sendSMS } from "../../utils/smsService";

export class AgentAuthController {
  static async sendOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    try {
      const { mobile } = req.body;
      if (!mobile) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      const agent = await Agent.findOne({ mobile });
      if (!agent) {
        return res
          .status(404)
          .json({ success: false, message: "Agent not found" });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

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

      // Send OTP via Airtel IQ SMS
      try {
        await sendSMS({
          to: mobile,
          otp: otpCode,
        });
        console.log(`Agent OTP sent to ${mobile}: ${otpCode} (via Airtel IQ)`);
      } catch (smsError: any) {
        console.error(
          `Failed to send Agent OTP SMS to ${mobile}:`,
          smsError.message,
        );
      }

      return res.status(200).json({
        success: true,
        message: "OTP has been sent successfully",
        otp: otpCode,
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

      const agent: any = await Agent.findOne({ mobile }).populate("role");
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
