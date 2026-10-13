import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { apiLimiter } from "./middleware/rateLimits.js";
import adminRoutes from "./routes/admin.js";
import attendanceRoutes from "./routes/attendance.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import publicRoutes from "./routes/public.js";
import userRoutes from "./routes/users.js";
import { forbidden } from "./utils/http.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createApp() {
  const app = express();

  app.set("trust proxy", env.trustProxy);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || env.clientOrigins.includes(origin)),
      credentials: true,
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // With SameSite=None cookies (frontend and API on different sites) the browser no longer
  // blocks cross-site requests, so reject state-changing requests from unknown origins.
  if (env.cookieSameSite === "none") {
    app.use((req, _res, next) => {
      const origin = req.get("origin");
      if (!SAFE_METHODS.has(req.method) && origin && !env.clientOrigins.includes(origin)) {
        return next(forbidden("Request origin not allowed."));
      }
      next();
    });
  }

  app.get("/", (_req, res) => {
    res.json({ message: "ProjectEval API is running", status: "success" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "healthy",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/admin/users", userRoutes);
  app.use("/api/admin/attendance", attendanceRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", publicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
