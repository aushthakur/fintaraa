import mongoose, { Document, Schema, Types } from "mongoose";

function sanitizeMessageText(text: string): string {
  text = text.replace(/https?:\/\/\S+/gi, "[link not allowed]");
  text = text.replace(/\S+@\S+\.\S+/gi, "[email not allowed]");
  text = text.replace(/\b\d{7,15}\b/g, "[number not allowed]");
  return text.trim();
}

export interface IMessageAttachment {
  url: string;
  type: "image" | "video" | "audio" | "document" | "other";
  name: string;
  size: number;
  mimetype: string;
}

export interface IMessage extends Document {
  text: string;
  createdAt: Date;
  updatedAt: Date;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  status: "sent" | "delivered" | "read";
  readAt?: Date | null;
  leadId?: Types.ObjectId; // Optional: for lead-based chat
  loanQueryId?: Types.ObjectId; // Optional: for loan query chat
  insuranceQueryId?: Types.ObjectId; // Optional: for insurance query chat
  senderModel?: "User" | "Admin" | "Agent" | "Lander"; // Model type of sender
  receiverModel?: "User" | "Admin" | "Agent" | "Lander"; // Model type of receiver
  attachments?: IMessageAttachment[]; // Media/file attachments
}

const messageSchema = new Schema<IMessage>(
  {
    sender: {
      ref: "User",
      required: true,
      type: Schema.Types.ObjectId,
    },
    receiver: {
      ref: "User",
      required: true,
      type: Schema.Types.ObjectId,
    },
    text: {
      type: String,
      default: "",
      validate: {
        validator: function (this: IMessage, value: string) {
          // If no text and no attachments, fail validation
          if ((!value || value.trim().length === 0) && (!this.attachments || this.attachments.length === 0)) {
            return false;
          }
          // If text exists, check length and patterns
          if (value && value.trim().length > 0) {
            if (value.length > 500) return false;
            const forbiddenPatterns = [
              /https?:\/\/\S+/i, // links
            ];
            return !forbiddenPatterns.some((pattern) => pattern.test(value));
          }
          return true;
        },
        message: function(this: IMessage) {
          if ((!this.text || this.text.trim().length === 0) && (!this.attachments || this.attachments.length === 0)) {
            return "Message must contain either text or attachments";
          }
          if (this.text && this.text.length > 500) {
            return "Message too long (max 500 chars)";
          }
          return "Links are not allowed";
        },
      },
      set: (value: string) => value ? sanitizeMessageText(value) : "",
    },
    status: {
      type: String,
      default: "sent",
      enum: ["sent", "delivered", "read"],
    },
    readAt: {
      type: Date,
      default: null,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      index: true,
    },
    loanQueryId: {
      type: Schema.Types.ObjectId,
      ref: "LoanQuery",
      index: true,
    },
    insuranceQueryId: {
      type: Schema.Types.ObjectId,
      ref: "InsuranceQuery",
      index: true,
    },
    senderModel: {
      type: String,
      enum: ["User", "Admin", "Agent", "Lander"],
    },
    receiverModel: {
      type: String,
      enum: ["User", "Admin", "Agent", "Lander"],
    },
    attachments: {
      type: [
        {
          url: { type: String, required: true },
          type: {
            type: String,
            enum: ["image", "video", "audio", "document", "other"],
            required: true,
          },
          name: { type: String, required: true },
          size: { type: Number, required: true },
          mimetype: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ leadId: 1, createdAt: -1 });
messageSchema.index({ loanQueryId: 1, createdAt: -1 });
messageSchema.index({ insuranceQueryId: 1, createdAt: -1 });
export const Message = mongoose.model<IMessage>("Message", messageSchema);
