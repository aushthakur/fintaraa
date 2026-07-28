import ApiError from "../utils/ApiError";
import { OtpRequest } from "../modals/otpRequest.model";

const OTP_WINDOW_MS = 60 * 60 * 1000;
const OTP_MAX_REQUESTS = 3;

const normalizeMobile = (mobile: unknown) =>
  String(mobile || "").replace(/\D/g, "");

export const consumeOtpRequest = async (
  mobileValue: unknown,
  scope: "user" | "agency",
) => {
  const mobile = normalizeMobile(mobileValue);
  if (mobile.length < 10 || mobile.length > 15) {
    throw new ApiError(400, "Enter a valid mobile number.");
  }

  const windowStart = new Date(Date.now() - OTP_WINDOW_MS);
  const requestCount = await OtpRequest.countDocuments({
    mobile,
    scope,
    createdAt: { $gte: windowStart },
  });

  if (requestCount >= OTP_MAX_REQUESTS) {
    throw new ApiError(
      429,
      "OTP request limit reached. Please try again after one hour.",
    );
  }

  await OtpRequest.create({
    mobile,
    scope,
    expiresAt: new Date(Date.now() + OTP_WINDOW_MS),
  });

  return mobile;
};

export const releaseOtpRequest = async (
  mobileValue: unknown,
  scope: "user" | "agency",
) => {
  const mobile = normalizeMobile(mobileValue);
  if (!mobile) return;
  await OtpRequest.findOneAndDelete({ mobile, scope }).sort({ createdAt: -1 });
};
