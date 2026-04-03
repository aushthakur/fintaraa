import axios from "axios";
import ApiError from "../../utils/ApiError";
import { config } from "../../config/config";
import { User } from "../../modals/user.model";
import { Request, Response, NextFunction } from "express";

export class PanController {
  static async mobileToPan(req: Request, res: Response, next: NextFunction) {
    try {
      const name = String(req.body?.name || "").trim();
      const mobile_no = String(req.body?.mobile_no || "").replace(/\D/g, "");
      if (!name || !mobile_no) {
        return res
          .status(400)
          .json(new ApiError(400, "name and mobile_no are required"));
      }

      // Build Surepass target
      const envKey = (config.surepass.environment || "sandbox") as
        | "sandbox"
        | "production";
      const envCfg: any = (config.surepass as any)[envKey];
      const baseUrl: string = envCfg?.baseUrl || "";
      const token: string = envCfg?.token || "";
      const endpointPath: string =
        (config.surepass as any).endpoints?.mobileToPan ||
        "/api/v1/pan/mobile-to-pan";
      const url = `${baseUrl}${endpointPath}`;

      // Call Surepass API; forward their response
      const spResponse = await axios.post(
        url,
        { name, mobile_no },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: config.surepass.timeoutMs,
        }
      );

      const body = spResponse?.data || {};

      // Optional enrichment: fallback to our DB pan if Surepass didn't return it
      if (!body?.data?.pan_number) {
        const user = await User.findOne({ mobile: mobile_no }).select(
          "panCard"
        );
        if (user?.panCard) {
          body.data = body.data || {};
          body.data.pan_number = user.panCard;
        }
      }
      if (!body?.data?.pan_number) {
        return res
          .status(404)
          .json(
            new ApiError(
              404,
              body?.message || "PAN number not found for this mobile number",
            ),
          );
      }
      return res.status(body?.status_code || 200).json(body);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const upstreamStatus = error.response?.status;
        const upstreamBody: any = error.response?.data || {};
        const messageCode = String(
          upstreamBody?.data?.message_code ||
            upstreamBody?.message_code ||
            upstreamBody?.messageCode ||
            "",
        ).toLowerCase();
        const upstreamMessage = String(
          upstreamBody?.data?.message ||
            upstreamBody?.message ||
            error.message ||
            "",
        ).toLowerCase();

        if (
          upstreamStatus === 422 ||
          messageCode.includes("verification_failed") ||
          messageCode.includes("not_found") ||
          upstreamMessage.includes("verification_failed") ||
          upstreamMessage.includes("not linked") ||
          upstreamMessage.includes("no pan")
        ) {
          return res
            .status(404)
            .json(
              new ApiError(
                404,
                "No PAN linked to this mobile number. Please verify the name and mobile number, or continue without PAN if it is not available.",
              ),
            );
        }
      }
      next(error);
    }
  }
}
