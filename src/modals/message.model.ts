import mongoose, { Document, Schema, Types } from "mongoose";

function sanitizeMessageText(text: string): string {
  text = text.replace(/https?:\/\/\S+/gi, "[link not allowed]");
  text = text.replace(/\S+@\S+\.\S+/gi, "[email not allowed]");
  text = text.replace(/\b\d{7,15}\b/g, "[number not allowed]");
  return text.trim();
}

export interface IMessage extends Document {
  text: string;
  createdAt: Date;
  updatedAt: Date;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  status: "sent" | "delivered" | "read";
  readAt?: Date | null;
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
      required: true,
      minlength: [1, "Message cannot be empty"],
      maxlength: [500, "Message too long (max 500 chars)"],
      validate: {
        validator: function (value: string) {
          const forbiddenPatterns = [
            /https?:\/\/\S+/i, // links
            /\S+@\S+\.\S+/i, // emails
            /\b\d{7,15}\b/, // phone numbers
          ];
          return !forbiddenPatterns.some((pattern) => pattern.test(value));
        },
        message: "Links, emails, and phone numbers are not allowed",
      },
      set: (value: string) => sanitizeMessageText(value),
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
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
export const Message = mongoose.model<IMessage>("Message", messageSchema);
