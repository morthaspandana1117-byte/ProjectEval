import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import Rating from "../models/Rating.js";
import Settings from "../models/Settings.js";
import User from "../models/Users.js";
import { buildLeaderboard } from "../services/reports.js";
import { forbidden } from "../utils/http.js";
import { leaderboardQuery } from "../utils/schemas.js";

// Routes available to every signed-in user.
const router = Router();
router.use(authenticate);

router.get("/leaderboard", validateQuery(leaderboardQuery), async (req, res) => {
  const settings = await Settings.getGlobal();
  if (!settings.leaderboardVisible && req.user.role !== "admin") {
    throw forbidden("Results have not been published yet.");
  }
  res.json({ group: req.q.group, entries: await buildLeaderboard(req.q.group) });
});

// Minimal directory used when presenters choose a faculty guide.
router.get("/faculty", async (_req, res) => {
  const faculty = await User.find({ role: "faculty", isActive: true }).select("name department").sort({ name: 1 }).lean();
  res.json({ faculty });
});

router.get("/ratings/mine", authorize("student", "faculty"), async (req, res) => {
  const ratings = await Rating.find({ voter: req.user._id })
    .select("project score feedback updatedAt")
    .populate("project", "projectNumber title status")
    .sort({ updatedAt: -1 })
    .lean();
  res.json({ ratings: ratings.filter((r) => r.project) });
});

export default router;
