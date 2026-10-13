import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import mongoose from "mongoose";
import { createApp } from "./app.js";
import { assertRuntimeEnv, env } from "./config/env.js";
import { migrateLegacyFacultyGuides } from "./services/migrations.js";

async function startServer() {
  try {
    assertRuntimeEnv();

    await mongoose.connect(env.mongoUri);
    console.log("MongoDB connected successfully");

    const convertedGuides = await migrateLegacyFacultyGuides();
    if (convertedGuides) console.log(`Converted ${convertedGuides} legacy faculty guide reference(s) to names.`);

    const app = createApp();
    const server = app.listen(env.port, () => {
      console.log(`ProjectEval API running on port ${env.port}`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
