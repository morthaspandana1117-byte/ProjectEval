import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { objectIdParam, validateBody, validateQuery } from "../middleware/validate.js";
import Attendance from "../models/Attendance.js";
import Project from "../models/Project.js";
import Rating from "../models/Rating.js";
import User from "../models/Users.js";
import { audit } from "../services/audit.js";
import { badRequest, conflict, escapeRegex, forbidden, notFound, paginationMeta, parsePagination } from "../utils/http.js";
import { adminCreateUserSchema, adminUpdateUserSchema, resetPasswordSchema, userListQuery } from "../utils/schemas.js";

const router = Router();
router.use(authenticate, authorize("admin"));
router.param("id", objectIdParam);

async function loadManagedUser(id) {
  const user = await User.findById(id).select("+tokenVersion");
  if (!user) throw notFound("User not found.");
  // Admin accounts are managed only through the seed script, never through the API.
  if (user.role === "admin") throw forbidden("Administrator accounts cannot be modified here.");
  return user;
}

router.get("/", validateQuery(userListQuery), async (req, res) => {
  const { role, status, search } = req.q;
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.isActive = status === "active";
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { rollNumber: pattern }, { employeeId: pattern }];
  }

  const paging = parsePagination(req.q, { defaultLimit: 25 });
  const [users, total] = await Promise.all([
    User.find(filter).sort({ role: 1, name: 1 }).skip(paging.skip).limit(paging.limit).lean(),
    User.countDocuments(filter),
  ]);

  const voteCounts = await Rating.aggregate([
    { $match: { voter: { $in: users.map((u) => u._id) } } },
    { $group: { _id: "$voter", count: { $sum: 1 } } },
  ]);
  const votesByUser = new Map(voteCounts.map((row) => [row._id.toString(), row.count]));

  res.json({
    users: users.map(({ password: _p, tokenVersion: _t, __v, ...user }) => ({
      ...user,
      votesCast: votesByUser.get(user._id.toString()) ?? 0,
    })),
    pagination: paginationMeta(paging, total),
  });
});

router.post("/", validateBody(adminCreateUserSchema), async (req, res) => {
  const data = { ...req.body };
  if (data.role === "faculty") delete data.rollNumber;
  const user = await User.create(data);
  await audit(req, "user.create", {
    targetType: "User",
    targetId: user._id,
    summary: `Created ${user.role} ${user.email}`,
  });
  res.status(201).json({ user });
});

router.get("/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound("User not found.");
  const [ratings, projects, attendance] = await Promise.all([
    Rating.find({ voter: user._id }).populate("project", "projectNumber title").sort({ updatedAt: -1 }).lean(),
    Project.find({ submittedBy: user._id }).select("projectNumber title status").lean(),
    Attendance.find({ student: user._id }).sort({ session: -1 }).lean(),
  ]);
  res.json({ user, ratings, projects, attendance });
});

router.patch("/:id", validateBody(adminUpdateUserSchema), async (req, res) => {
  const user = await loadManagedUser(req.params.id);
  const previousRole = user.role;
  const wasActive = user.isActive;

  for (const [key, value] of Object.entries(req.body)) {
    if (value === null) user.set(key, undefined);
    else user.set(key, value);
  }

  // A student's Department and Year can be changed but not cleared. Omitted fields stay as they are,
  // so older accounts without them can still be updated (e.g. deactivated) without supplying them.
  if (user.role === "student") {
    const errors = {};
    if ("department" in req.body && !user.department) errors.department = "Department is required";
    if ("year" in req.body && user.year == null) errors.year = "Select a year of study from Year 1 to Year 6";
    if (Object.keys(errors).length) throw badRequest("Please correct the highlighted fields.", errors);
  }

  const roleChanged = user.role !== previousRole;
  if (roleChanged || (wasActive && !user.isActive)) user.tokenVersion += 1;
  await user.save();

  if (roleChanged) {
    // Leaderboards are per group, so move this voter's ratings with them.
    await Rating.updateMany({ voter: user._id }, { $set: { voterRole: user.role } });
  }

  await audit(req, "user.update", {
    targetType: "User",
    targetId: user._id,
    summary: `Updated ${user.email}`,
    details: { fields: Object.keys(req.body), ...(roleChanged && { from: previousRole, to: user.role }) },
  });
  res.json({ user });
});

router.post("/:id/reset-password", validateBody(resetPasswordSchema), async (req, res) => {
  const user = await loadManagedUser(req.params.id);
  user.password = req.body.password;
  user.tokenVersion += 1;
  await user.save();
  await audit(req, "user.reset_password", { targetType: "User", targetId: user._id, summary: user.email });
  res.json({ message: "Password reset. The user has been signed out of all devices." });
});

router.delete("/:id", async (req, res) => {
  const user = await loadManagedUser(req.params.id);
  if (await Project.exists({ submittedBy: user._id })) {
    throw conflict("This user has submitted projects. Deactivate the account instead, or delete the projects first.");
  }
  await Promise.all([
    Rating.deleteMany({ voter: user._id }),
    Attendance.deleteMany({ student: user._id }),
    user.deleteOne(),
  ]);
  await audit(req, "user.delete", { targetType: "User", targetId: user._id, summary: `Deleted ${user.email}` });
  res.json({ message: "User deleted." });
});

export default router;
