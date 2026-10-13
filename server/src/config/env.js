import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";
const isTest = nodeEnv === "test";

function parseTrustProxy(value) {
  if (value === undefined || value === "") return isProd ? 1 : false;
  if (value === "true") return true;
  if (value === "false") return false;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) ? asNumber : value;
}

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret && !isProd) {
  // Development convenience only: sessions reset whenever the server restarts.
  jwtSecret = crypto.randomBytes(48).toString("hex");
  if (!isTest) {
    console.warn("JWT_SECRET is not set; using a temporary secret for this run.");
  }
}

const cookieSameSite = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();

export const env = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  cookieSameSite: ["lax", "strict", "none"].includes(cookieSameSite) ? cookieSameSite : "lax",
  cookieSecure: isProd || cookieSameSite === "none",
  timezone: process.env.EVENT_TIMEZONE || "Asia/Kolkata",
};

export function assertRuntimeEnv() {
  const problems = [];
  if (!env.mongoUri) problems.push("MONGODB_URI is missing");
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be set to a random string of at least 32 characters");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: env.timezone });
  } catch {
    problems.push(`EVENT_TIMEZONE "${env.timezone}" is not a supported IANA time zone (e.g. Asia/Kolkata)`);
  }
  if (problems.length) {
    throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  }
}
