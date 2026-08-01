import mongoose, { Document, Schema, Types } from "mongoose";

export enum PartnerCredentialAuthType {
  NONE = "none",
  API_KEY = "api_key",
  BASIC = "basic",
  BEARER = "bearer",
  OAUTH2 = "oauth2",
  CUSTOM = "custom",
}

export interface IPartnerCredential extends Document {
  partner: Types.ObjectId;
  provider: string;
  baseUrl?: string;
  authType: PartnerCredentialAuthType;
  encryptedCredentials?: {
    version: number;
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  credentialKeys: string[];
  lastTestedAt?: Date;
  lastTestSucceeded?: boolean;
  lastTestStatusCode?: number;
  lastTestMessage?: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const partnerCredentialSchema = new Schema<IPartnerCredential>(
  {
    partner: {
      type: Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    baseUrl: { type: String, trim: true, default: "", maxlength: 1000 },
    authType: {
      type: String,
      enum: Object.values(PartnerCredentialAuthType),
      required: true,
      default: PartnerCredentialAuthType.NONE,
    },
    encryptedCredentials: {
      version: { type: Number, required: true, default: 1, select: false },
      iv: { type: String, required: true, select: false },
      authTag: { type: String, required: true, select: false },
      ciphertext: { type: String, required: true, select: false },
    },
    credentialKeys: { type: [String], default: [] },
    lastTestedAt: { type: Date },
    lastTestSucceeded: { type: Boolean },
    lastTestStatusCode: { type: Number },
    lastTestMessage: { type: String, trim: true, default: "", maxlength: 1000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.encryptedCredentials;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.encryptedCredentials;
        return ret;
      },
    },
  },
);

export const PartnerCredential = mongoose.model<IPartnerCredential>(
  "PartnerCredential",
  partnerCredentialSchema,
);
