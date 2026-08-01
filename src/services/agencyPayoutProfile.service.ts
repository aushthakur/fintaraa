import crypto from "crypto";
import { Types } from "mongoose";
import { config } from "../config/config";
import {
  AgencyPayoutProfile,
  AgencyPayoutProfileMethod,
} from "../modals/agencyPayoutProfile.model";
import ApiError from "../utils/ApiError";
import { AgencyPayoutRequest } from "../modals/agencyPayoutRequest.model";

const encryptionKey = () => {
  const configured = String(config.dsa?.payoutEncryptionKey || "").trim();
  if (!configured) {
    throw new ApiError(
      500,
      "DSA payout encryption is not configured (DSA_PAYOUT_ENCRYPTION_KEY)",
    );
  }
  return crypto.createHash("sha256").update(configured).digest();
};

const encrypt = (payload: Record<string, string>) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
};

const decrypt = (value: string): Record<string, string> => {
  const [version, ivValue, tagValue, encryptedValue] = String(value || "").split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new ApiError(500, "Encrypted payout destination is invalid");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    throw new ApiError(500, "Encrypted payout destination could not be opened");
  }
};

const maskAccount = (value: string) => {
  const normalized = value.replace(/\s+/g, "");
  return normalized.length <= 4
    ? `••••${normalized}`
    : `••••${normalized.slice(-4)}`;
};

const maskUpi = (value: string) => {
  const [handle, provider] = value.split("@");
  if (!provider) return "••••";
  return `${handle.slice(0, 2) || "•"}••••@${provider}`;
};

const publicProfile = (profile: any) => {
  if (!profile) return null;
  const plain = profile.toObject ? profile.toObject() : { ...profile };
  delete plain.encryptedPayload;
  return plain;
};

export class AgencyPayoutProfileService {
  async get(agencyId: string) {
    return publicProfile(
      await AgencyPayoutProfile.findOne({ agency: agencyId }).lean(),
    );
  }

  async upsert(input: {
    agencyId: string;
    method: AgencyPayoutProfileMethod;
    upiId?: string;
    accountNumber?: string;
    ifsc?: string;
    accountHolder?: string;
    bankName?: string;
    updatedBy?: string;
    allowActiveReservation?: boolean;
  }) {
    if (!Types.ObjectId.isValid(input.agencyId)) {
      throw new ApiError(400, "Invalid DSA account");
    }
    if (!input.allowActiveReservation) {
      const activePayout = await AgencyPayoutRequest.exists({
        ownerAgency: input.agencyId,
        status: { $in: ["pending", "approved", "processing"] },
      });
      if (activePayout) {
        throw new ApiError(
          409,
          "Payout details are locked while a payout request is active",
        );
      }
    }
    const method = input.method;
    if (!(["upi", "bank_transfer"] as string[]).includes(method)) {
      throw new ApiError(400, "Payout method must be upi or bank_transfer");
    }

    let sensitive: Record<string, string>;
    let maskedDestination: string;
    if (method === "upi") {
      const upiId = String(input.upiId || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,256}@[a-z0-9.-]{2,64}$/i.test(upiId)) {
        throw new ApiError(400, "Valid UPI ID is required");
      }
      sensitive = { upiId };
      maskedDestination = maskUpi(upiId);
    } else {
      const accountNumber = String(input.accountNumber || "").replace(/\s+/g, "");
      const ifsc = String(input.ifsc || "").trim().toUpperCase();
      const accountHolder = String(input.accountHolder || "").trim();
      if (!/^\d{6,20}$/.test(accountNumber)) {
        throw new ApiError(400, "Account number must contain 6 to 20 digits");
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        throw new ApiError(400, "Valid IFSC is required");
      }
      if (!accountHolder) throw new ApiError(400, "Account holder is required");
      sensitive = { accountNumber, ifsc, accountHolder };
      maskedDestination = maskAccount(accountNumber);
    }

    const profile = await AgencyPayoutProfile.findOneAndUpdate(
      { agency: input.agencyId },
      {
        $set: {
          method,
          encryptedPayload: encrypt(sensitive),
          maskedDestination,
          accountHolder:
            method === "bank_transfer"
              ? String(input.accountHolder || "").trim()
              : undefined,
          bankName:
            method === "bank_transfer"
              ? String(input.bankName || "").trim()
              : undefined,
          ifsc:
            method === "bank_transfer"
              ? String(input.ifsc || "").trim().toUpperCase()
              : undefined,
          encryptionVersion: 1,
          updatedBy: input.updatedBy || input.agencyId,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return publicProfile(profile);
  }

  async reveal(profileId: string) {
    if (!Types.ObjectId.isValid(profileId)) {
      throw new ApiError(400, "Invalid payout profile");
    }
    const profile: any = await AgencyPayoutProfile.findById(profileId).select(
      "+encryptedPayload",
    );
    if (!profile) throw new ApiError(404, "Payout profile not found");
    return {
      method: profile.method,
      destination: decrypt(profile.encryptedPayload),
    };
  }

  revealSnapshot(input: {
    method: AgencyPayoutProfileMethod;
    encryptedPayload: string;
  }) {
    if (!( ["upi", "bank_transfer"] as string[]).includes(input.method)) {
      throw new ApiError(500, "Payout destination method is invalid");
    }
    return {
      method: input.method,
      destination: decrypt(input.encryptedPayload),
    };
  }
}

export const agencyPayoutProfileService = new AgencyPayoutProfileService();
