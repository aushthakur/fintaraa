import mongoose, { Document, Schema } from "mongoose";

export interface IRole extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  permissions: any[];
  description?: string;
}

const RoleSchema: Schema = new Schema<IRole>(
  {
    name: {
      trim: true,
      type: String,
      unique: true,
      required: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    permissions: {
      type: [],
      default: [],
    },
  },
  { timestamps: true }
);

const Role = mongoose.model<IRole>("Role", RoleSchema);
export default Role;
