import mongoose from "mongoose";
import { SESSION_PATTERN } from "../utils/dates.js";

export const ATTENDANCE_STATUSES = ["present", "absent"];

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Evaluation session date, YYYY-MM-DD.
    session: { type: String, required: true, match: SESSION_PATTERN },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, session: 1 }, { unique: true });
attendanceSchema.index({ session: 1, status: 1 });

export const Attendance = mongoose.models.Attendance || mongoose.model("Attendance", attendanceSchema);
export default Attendance;
