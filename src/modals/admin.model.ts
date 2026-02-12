import bcrypt from "bcrypt";
import { LoanType } from "./loanquery.model";
import mongoose, { Schema, Document } from "mongoose";
import { InsuranceType } from "./insurancequery.model";

/**
 * Admin Schema for token-based auth
 * @typedef {Object} Admin
 * @property {string} role - 'admin' or 'agent'
 * @property {string} email - Unique admin email
 * @property {string} password - Hashed password
 * @property {string} username - Unique admin username
 */
export interface IAdmin extends Document {
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  status: Boolean;
  mobile?: string;
  username: string;
  password: string;
  location?: string;
  department?: string;
  activeLeads: number;
  leadCapacity: number;
  refreshToken: string;
  availability: boolean;
  leadAutoAssign: boolean;
  lastLeadAssignedAt?: Date;
  profilePictureUrl?: string;
  role: Schema.Types.ObjectId;
  productFocusLoan?: LoanType[];
  serviceablePincodes?: string[];
  productFocusInsurance?: InsuranceType[];
  comparePassword(password: string): Promise<boolean>;
}

const adminSchema = new Schema<IAdmin>(
  {
    refreshToken: { type: String },
    status: { type: Boolean, default: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    name: { type: String, trim: true },
    mobile: { type: String, match: /^[6-9]\d{9}$/ },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    profilePictureUrl: { type: String },
    availability: { type: Boolean, default: true, index: true },
    leadCapacity: { type: Number, default: 40, min: 1 },
    activeLeads: { type: Number, default: 0, min: 0 },
    leadAutoAssign: { type: Boolean, default: true },
    lastLeadAssignedAt: { type: Date },
    serviceablePincodes: [{ type: String, trim: true }],
    productFocusLoan: [
      {
        type: String,
        enum: Object.values(LoanType),
      },
    ],
    productFocusInsurance: [
      {
        type: String,
        enum: Object.values(InsuranceType),
      },
    ],
    role: {
      ref: "Role",
      index: true,
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  { timestamps: true },
);

// 🔒 Pre-save hook to hash password if modified
adminSchema.pre<IAdmin>("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err as Error);
  }
});

// 🔐 Method to compare password during login
adminSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

const Admin = mongoose.model<IAdmin>("Admin", adminSchema);

export default Admin;
