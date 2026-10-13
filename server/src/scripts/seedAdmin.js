// Creates the Super Admin account from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD in server/.env.
// Usage (from server/):  npm run seed:admin
// Safe to re-run: an existing admin is never duplicated and its password is not changed.
//   --reset-password          change the existing admin's password to ADMIN_PASSWORD
//   --allow-additional-admin  create another admin when one already exists with a different email
import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import mongoose from "mongoose";
import { env } from "../config/env.js";
import { readAdminSeedConfig, seedSuperAdmin } from "../services/adminSeed.js";

const MESSAGES = {
  created: (email) => `Super Admin account created for ${email}.`,
  exists: (email) =>
    `Super Admin ${email} already exists; nothing changed. Use --reset-password to change its password.`,
  password_reset: (email) => `Password reset for Super Admin ${email}. Existing sessions were signed out.`,
};

async function main() {
  // Validate everything before touching the database.
  const config = readAdminSeedConfig();
  if (!env.mongoUri) throw new Error("MONGODB_URI is missing in server/.env.");

  await mongoose.connect(env.mongoUri);
  const result = await seedSuperAdmin(config, {
    resetPassword: process.argv.includes("--reset-password"),
    allowAdditional: process.argv.includes("--allow-additional-admin"),
  });
  console.log(MESSAGES[result](config.email));
  console.log("Tip: you can now remove ADMIN_PASSWORD from server/.env.");
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
