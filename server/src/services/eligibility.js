import Attendance from "../models/Attendance.js";
import Settings from "../models/Settings.js";

/**
 * Voting rules:
 *  - only students and faculty vote, and only while voting is open;
 *  - students must be marked present for the active session;
 *  - faculty have no attendance requirement.
 */
export async function getVotingEligibility(user, settings) {
  settings ??= await Settings.getGlobal();

  if (user.role !== "student" && user.role !== "faculty") {
    return { eligible: false, reason: "Only students and faculty can rate projects." };
  }
  if (!settings.votingOpen) {
    return { eligible: false, reason: "Voting is currently closed." };
  }
  if (user.role === "faculty") return { eligible: true };

  const present = await Attendance.exists({
    student: user._id,
    session: settings.activeSession,
    status: "present",
  });
  if (!present) {
    return {
      eligible: false,
      reason: `You can vote once the administrator marks you present for the ${settings.activeSession} session.`,
    };
  }
  return { eligible: true };
}

/** A presenter may not rate a project they submitted or are listed on. */
export function isOwnProject(project, user) {
  const submitter = project.submittedBy?._id ?? project.submittedBy;
  if (submitter && submitter.toString() === user._id.toString()) return true;
  if (!user.rollNumber) return false;
  return project.teamMembers.some((member) => member.rollNumber && member.rollNumber === user.rollNumber);
}
