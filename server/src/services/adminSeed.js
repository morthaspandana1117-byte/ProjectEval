import User from "../models/Users.js";
import { email as emailSchema, name as nameSchema, password as passwordSchema } from "../utils/schemas.js";

export class AdminSeedError extends Error {}

// Placeholder values from server/.env.example must never become real credentials.
const EXAMPLE_VALUES = {
  ADMIN_EMAIL: "admin@your-college.edu",
  ADMIN_PASSWORD: "change-me-to-a-strong-unique-password",
};

/**
 * Reads and validates the Super Admin credentials from the environment.
 * There is deliberately no default email or password.
 */
export function readAdminSeedConfig(source = process.env) {
  const missing = ["ADMIN_EMAIL", "ADMIN_PASSWORD"].filter((key) => !source[key]?.trim());
  if (missing.length) {
    throw new AdminSeedError(
      `Missing ${missing.join(" and ")} in server/.env. Add the Super Admin credentials there ` +
        "(see server/.env.example) and run the seed again."
    );
  }

  const placeholders = Object.keys(EXAMPLE_VALUES).filter(
    (key) => source[key].trim().toLowerCase() === EXAMPLE_VALUES[key]
  );
  if (placeholders.length) {
    throw new AdminSeedError(`${placeholders.join(" and ")} still use the example values. Set real credentials in server/.env.`);
  }

  const problems = [];
  const name = nameSchema.safeParse(source.ADMIN_NAME?.trim() || "Super Admin");
  const email = emailSchema.safeParse(source.ADMIN_EMAIL);
  const password = passwordSchema.safeParse(source.ADMIN_PASSWORD);
  if (!name.success) problems.push(`ADMIN_NAME: ${name.error.issues[0].message}`);
  if (!email.success) problems.push(`ADMIN_EMAIL: ${email.error.issues[0].message}`);
  if (!password.success) problems.push(`ADMIN_PASSWORD: ${password.error.issues[0].message}`);
  if (problems.length) throw new AdminSeedError(problems.join("; "));

  return { name: name.data, email: email.data, password: password.data };
}

/**
 * Idempotently creates the Super Admin (role "admin", the highest role in this app).
 * - Existing admin with the same email: left untouched unless resetPassword is true.
 * - Email used by a student/faculty account: refused (never promotes an existing user).
 * - A different admin already exists: refused unless allowAdditional is true,
 *   so changing ADMIN_EMAIL does not silently create a second administrator.
 * The password is hashed by the User model's pre-save hook; it is never logged or returned.
 *
 * @returns {Promise<"created" | "exists" | "password_reset">}
 */
export async function seedSuperAdmin({ name, email, password }, { resetPassword = false, allowAdditional = false } = {}) {
  const existing = await User.findOne({ email }).select("+password +tokenVersion");

  if (existing && existing.role !== "admin") {
    throw new AdminSeedError(`${email} already belongs to a ${existing.role} account. Choose a different ADMIN_EMAIL.`);
  }

  if (existing) {
    if (!resetPassword) return "exists";
    existing.password = password;
    existing.isActive = true;
    existing.tokenVersion += 1; // sign out any existing sessions
    await existing.save();
    return "password_reset";
  }

  if (!allowAdditional && (await User.exists({ role: "admin" }))) {
    throw new AdminSeedError(
      "An administrator account already exists with a different email. Use that ADMIN_EMAIL, " +
        "or re-run with --allow-additional-admin if a second administrator is intended."
    );
  }

  await User.create({ name, email, password, role: "admin" });
  return "created";
}
