import bcrypt from "bcrypt";
import mongoose, { Schema, Document } from "mongoose";

/**
 * Admin Schema for token-based auth
 * @typedef {Object} Admin
 * @property {string} email - Unique admin email
 * @property {string} password - Hashed password
 * @property {string} username - Unique admin username
 * @property {string} role - 'admin' or 'agent'
 */
export interface IAdmin extends Document {
  email: string;
  createdAt: Date;
  updatedAt: Date;
  status: Boolean;
  username: string;
  password: string;
  refreshToken: string;
  role: Schema.Types.ObjectId
  comparePassword(password: string): Promise<boolean>;
}

const adminSchema = new Schema<IAdmin>(
  {
    refreshToken: { type: String },
    status: { type: Boolean, default: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    role: {
      ref: "Role",
      index: true,
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  { timestamps: true }
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
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

const Admin = mongoose.model<IAdmin>("Admin", adminSchema);

export default Admin;
