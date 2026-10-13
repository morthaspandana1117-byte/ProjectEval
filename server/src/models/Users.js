import bcrypt from "bcryptjs";
import mongoose from "mongoose";

export const ROLES = ["admin", "student", "faculty"];
export const VOTER_ROLES = ["student", "faculty"];
const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: "student" },
    rollNumber: { type: String, trim: true, uppercase: true, maxlength: 30 },
    employeeId: { type: String, trim: true, uppercase: true, maxlength: 30 },
    department: { type: String, trim: true, maxlength: 100 },
    year: { type: Number, min: 1, max: 6 },
    isActive: { type: Boolean, default: true },
    // Incremented to invalidate every issued session (password change, deactivation, role change).
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.index(
  { rollNumber: 1 },
  { unique: true, partialFilterExpression: { rollNumber: { $type: "string" } } }
);
userSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: "string" } } }
);
userSchema.index({ role: 1, isActive: 1, name: 1 });

userSchema.pre("save", async function hashPassword() {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  }
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
