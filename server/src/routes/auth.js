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
import { changePasswordSchema, loginSchema, registerSchema } from "../utils/schemas.js";

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

// Self-registration always creates a student. Faculty and admin accounts are created by an admin / seed script.
router.post("/register", registerLimiter, validateBody(registerSchema), async (req, res) => {
  const user = await User.create({ ...req.body, role: "student" });
  await audit(req, "user.register", { actor: user._id, targetType: "User", targetId: user._id, summary: user.email });
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
