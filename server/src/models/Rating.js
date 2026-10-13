import mongoose from "mongoose";
import { VOTER_ROLES } from "./Users.js";

export const FEEDBACK_MIN = 20;
export const FEEDBACK_MAX = 2000;

const ratingSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    voter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Snapshot of the voter's group; leaderboards are computed per group.
    voterRole: { type: String, enum: VOTER_ROLES, required: true },
    score: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: [Number.isInteger, "Score must be a whole number"],
    },
    feedback: { type: String, required: true, trim: true, minlength: FEEDBACK_MIN, maxlength: FEEDBACK_MAX },
  },
  { timestamps: true }
);

// One rating per voter per project; updates replace the existing rating.
ratingSchema.index({ project: 1, voter: 1 }, { unique: true });
ratingSchema.index({ voterRole: 1, project: 1 });
ratingSchema.index({ voter: 1 });

export const Rating = mongoose.models.Rating || mongoose.model("Rating", ratingSchema);
export default Rating;
