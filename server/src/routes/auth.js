import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticate, clearSession, issueSession } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rateLimits.js";
import { validateBody } from "../middleware/validate.js";
import Settings from "../models/Settings.js";
import User from "../models/Users.js";
import { audit } from "../services/audit.js";
import { deadlineSummary } from "../services/deadlines.js";
import { getVotingEligibility } from "../services/eligibility.js";
import { badRequest, forbidden, unauthorized } from "../utils/http.js";
import { changePasswordSchema, facultyRegisterSchema, loginSchema, studentRegisterSchema } from "../utils/schemas.js";

const router = Router();

// Compared against when the email is unknown so response timing does not reveal registered accounts.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

async function sessionPayload(user) {
  const settings = await Settings.getGlobal();
  return {
    user,
    settings,
    eligibility: await getVotingEligibility(user, settings),
    deadlines: deadlineSummary(settings),
  };
}

/**
 * Creates a self-registered account. The role is always fixed by the calling route (never taken from
 * the request); admins are only created by the seed script. A duplicate email — including a concurrent
 * duplicate registration — hits the unique email index (or, for students, the unique roll-number index)
 * and becomes a 409 in the error handler. `profile` carries explicitly chosen extra fields only.
 */
async function createSelfRegisteredUser(req, { name, email, password }, role, profile = {}) {
  const user = await User.create({ name, email, password, role, isActive: true, ...profile });
  const label = role === "faculty" ? "Faculty" : "Student";
  await audit(req, role === "faculty" ? "user.register_faculty" : "user.register", {
    actor: user._id,
    targetType: "User",
    targetId: user._id,
    summary: `${label} self-registration: ${user.email}`,
  });
  return user;
}

// Student self-registration: the student then signs in through the normal login.
// No attendance record is created, so voting stays locked until an admin marks them present.
router.post("/register", registerLimiter, validateBody(studentRegisterSchema), async (req, res) => {
  // The roll number powers the own-project rating check (team members are matched by roll number).
  const { rollNumber, department, year } = req.body;
  const user = await createSelfRegisteredUser(req, req.body, "student", { rollNumber, department, year });
  res.status(201).json({ message: "Your student account has been created. You can now sign in.", user });
});

// Faculty self-registration: the account is active immediately and signed in.
router.post("/register/faculty", registerLimiter, validateBody(facultyRegisterSchema), async (req, res) => {
  const user = await createSelfRegisteredUser(req, req.body, "faculty");
  issueSession(res, user);
  res.status(201).json(await sessionPayload(user));
});

router.post("/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select("+password +tokenVersion");
  const valid = await bcrypt.compare(req.body.password, user?.password ?? DUMMY_HASH);
  if (!user || !valid) throw unauthorized("Invalid email or password.");
  if (!user.isActive) throw forbidden("Your account has been deactivated. Contact the administrator.");

  user.lastLoginAt = new Date();
  await user.save();
  issueSession(res, user);
  res.json(await sessionPayload(user));
});

router.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ message: "Signed out." });
});

router.get("/me", authenticate, async (req, res) => {
  res.json(await sessionPayload(req.user));
});

router.patch("/password", authenticate, validateBody(changePasswordSchema), async (req, res) => {
  const user = await User.findById(req.user._id).select("+password +tokenVersion");
  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw badRequest("Current password is incorrect.", { currentPassword: "Current password is incorrect" });
  }
  user.password = req.body.newPassword;
  user.tokenVersion += 1; // signs out every other device
  await user.save();
  await audit(req, "user.password_change", { targetType: "User", targetId: user._id });
  issueSession(res, user);
  res.json({ message: "Password updated." });
});

export default router;
