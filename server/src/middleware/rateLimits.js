import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const base = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({ message: options.message });
  },
};

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: "Too many requests. Please slow down and try again shortly.",
});

export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: "Too many failed sign-in attempts. Please wait 15 minutes and try again.",
});

export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: "Too many registration attempts from this network. Please try again later.",
});

export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 30,
  message: "You are submitting too quickly. Please wait a moment.",
});

export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: "Too many uploads. Please try again later.",
});
