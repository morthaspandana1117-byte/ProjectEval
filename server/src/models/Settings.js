import mongoose from "mongoose";
import { env } from "../config/env.js";
import { SESSION_PATTERN, todayInEventZone } from "../utils/dates.js";

export const DEADLINE_FIELDS = ["submissionDeadline", "editDeadline", "uploadDeadline"];

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    eventName: { type: String, trim: true, maxlength: 120, default: "Project Expo" },
    votingOpen: { type: Boolean, default: false },
    // Manual switch for new submissions; works together with submissionDeadline.
    submissionsOpen: { type: Boolean, default: true },
    leaderboardVisible: { type: Boolean, default: true },
    // Students must be marked present for this session date before they can vote.
    activeSession: { type: String, match: SESSION_PATTERN },
    // Presenter deadlines (UTC instants). null = no time restriction.
    submissionDeadline: { type: Date, default: null },
    editDeadline: { type: Date, default: null },
    uploadDeadline: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * Returns the settings document. The raw stored record is kept in `$locals.raw` because
 * Mongoose silently drops uncastable dates, and deadline checks must fail closed on them.
 */
settingsSchema.statics.getGlobal = async function getGlobal() {
  const raw = await this.findOneAndUpdate(
    { key: "global" },
    { $setOnInsert: { key: "global", activeSession: todayInEventZone() } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, lean: true }
  );
  const settings = this.hydrate(raw);
  settings.$locals.raw = raw;
  return settings;
};

settingsSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret._id;
    delete ret.key;
    ret.eventTimezone = env.timezone;
    return ret;
  },
});

export const Settings = mongoose.models.Settings || mongoose.model("Settings", settingsSchema);
export default Settings;
