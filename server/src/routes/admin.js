import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { objectIdParam, validateBody, validateQuery } from "../middleware/validate.js";
import Attendance from "../models/Attendance.js";
import AuditLog from "../models/AuditLog.js";
import Project from "../models/Project.js";
import Rating from "../models/Rating.js";
import Settings, { DEADLINE_FIELDS } from "../models/Settings.js";
import User from "../models/Users.js";
import { audit } from "../services/audit.js";
import { deadlineSummary } from "../services/deadlines.js";
import { addSheet, createWorkbook, groupRowsByYear, sendWorkbook } from "../services/excel.js";
import { ratingStatsByProject, statsFor } from "../services/reports.js";
import { escapeRegex, notFound, paginationMeta, parsePagination } from "../utils/http.js";
import { participationQuery, reviewSchema, settingsSchema, votingExportQuery } from "../utils/schemas.js";

const router = Router();
router.use(authenticate, authorize("admin"));
router.param("id", objectIdParam);

const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

router.get("/stats", async (_req, res) => {
  const settings = await Settings.getGlobal();
  const session = settings.activeSession;

  const [students, faculty, presentIds, absent, projectRows, ratingRows, studentVoters, facultyVoters, recentActivity] =
    await Promise.all([
      User.countDocuments({ role: "student", isActive: true }),
      User.countDocuments({ role: "faculty", isActive: true }),
      Attendance.distinct("student", { session, status: "present" }),
      Attendance.countDocuments({ session, status: "absent" }),
      Project.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Rating.aggregate([{ $group: { _id: "$voterRole", count: { $sum: 1 }, avg: { $avg: "$score" } } }]),
      Rating.distinct("voter", { voterRole: "student" }),
      Rating.distinct("voter", { voterRole: "faculty" }),
      AuditLog.find().sort({ createdAt: -1 }).limit(8).populate("actor", "name role").lean(),
    ]);

  const projects = { pending: 0, approved: 0, rejected: 0 };
  projectRows.forEach((row) => (projects[row._id] = row.count));
  const ratings = { student: 0, faculty: 0 };
  ratingRows.forEach((row) => (ratings[row._id] = row.count));

  const voterSet = new Set(studentVoters.map(String));
  const presentVoted = presentIds.filter((id) => voterSet.has(id.toString())).length;

  res.json({
    settings,
    deadlines: deadlineSummary(settings),
    users: { students, faculty },
    attendance: {
      session,
      present: presentIds.length,
      absent,
      unmarked: Math.max(0, students - presentIds.length - absent),
      rate: percent(presentIds.length, students),
    },
    projects: { ...projects, total: projects.pending + projects.approved + projects.rejected },
    ratings: { ...ratings, total: ratings.student + ratings.faculty },
    participation: {
      studentVoters: studentVoters.length,
      studentRate: percent(studentVoters.length, students),
      presentVoted,
      presentRate: percent(presentVoted, presentIds.length),
      facultyVoters: facultyVoters.length,
      facultyRate: percent(facultyVoters.length, faculty),
    },
    recentActivity,
  });
});

router.patch("/projects/:id/status", validateBody(reviewSchema), async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) throw notFound("Project not found.");
  project.status = req.body.status;
  project.reviewNote = req.body.reviewNote;
  project.reviewedBy = req.user._id;
  project.reviewedAt = new Date();
  await project.save();
  await audit(req, `project.${req.body.status}`, {
    targetType: "Project",
    targetId: project._id,
    summary: `${project.projectNumber} marked ${req.body.status}`,
  });
  res.json({ project });
});

// Voter identities are only ever exposed through admin-only routes.
router.get("/projects/:id/ratings", async (req, res) => {
  const project = await Project.findById(req.params.id).select("projectNumber title status").lean();
  if (!project) throw notFound("Project not found.");
  const ratings = await Rating.find({ project: project._id })
    .populate("voter", "name email rollNumber employeeId department")
    .sort({ voterRole: 1, updatedAt: -1 })
    .lean();
  res.json({ project, ratings, stats: statsFor(await ratingStatsByProject([project._id]), project._id) });
});

async function votingSummary() {
  const projects = await Project.find({ status: "approved" })
    .select("projectNumber title facultyGuide")
    .sort({ projectNumber: 1 })
    .lean();
  const stats = await ratingStatsByProject(projects.map((p) => p._id));
  return projects.map((project) => {
    const s = statsFor(stats, project._id);
    return {
      _id: project._id,
      projectNumber: project.projectNumber,
      title: project.title,
      facultyGuide: project.facultyGuide ?? null,
      student: s.student,
      faculty: s.faculty,
      overall: s.overall,
      totalVotes: s.overall.voteCount,
    };
  });
}

router.get("/reports/voting", async (_req, res) => {
  res.json({ projects: await votingSummary() });
});

router.get("/reports/participation", validateQuery(participationQuery), async (req, res) => {
  const { role, filter, search } = req.q;
  const settings = await Settings.getGlobal();
  const userFilter = { role, isActive: true };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    userFilter.$or = [{ name: pattern }, { email: pattern }, { rollNumber: pattern }, { employeeId: pattern }];
  }

  const users = await User.find(userFilter)
    .select("name email rollNumber employeeId department year")
    .sort({ name: 1 })
    .lean();
  const ids = users.map((u) => u._id);
  const [voteRows, presentIds] = await Promise.all([
    Rating.aggregate([
      { $match: { voter: { $in: ids } } },
      { $group: { _id: "$voter", count: { $sum: 1 }, lastVotedAt: { $max: "$updatedAt" } } },
    ]),
    role === "student"
      ? Attendance.distinct("student", { session: settings.activeSession, status: "present", student: { $in: ids } })
      : [],
  ]);
  const votes = new Map(voteRows.map((r) => [r._id.toString(), r]));
  const present = new Set(presentIds.map(String));

  let rows = users.map((user) => {
    const v = votes.get(user._id.toString());
    return {
      ...user,
      votesCast: v?.count ?? 0,
      lastVotedAt: v?.lastVotedAt ?? null,
      ...(role === "student" && { present: present.has(user._id.toString()) }),
    };
  });
  if (filter === "voted") rows = rows.filter((r) => r.votesCast > 0);
  if (filter === "not-voted") rows = rows.filter((r) => r.votesCast === 0);

  res.json({ role, activeSession: settings.activeSession, users: rows });
});

router.get("/reports/voting/export", validateQuery(votingExportQuery), async (req, res) => {
  const summary = await votingSummary();
  const ratings = await Rating.find()
    .populate("project", "projectNumber title")
    .populate("voter", "name email rollNumber employeeId year")
    .sort({ project: 1, voterRole: 1 })
    .lean();

  const workbook = createWorkbook();
  addSheet(
    workbook,
    "Project Summary",
    [
      { header: "Project No.", key: "projectNumber", width: 14 },
      { header: "Title", key: "title", width: 40 },
      { header: "Faculty Guide", key: "facultyGuide", width: 22 },
      { header: "Student Avg", key: "studentAvg", width: 12 },
      { header: "Student Votes", key: "studentVotes", width: 14 },
      { header: "Faculty Avg", key: "facultyAvg", width: 12 },
      { header: "Faculty Votes", key: "facultyVotes", width: 14 },
      { header: "Overall Avg", key: "overallAvg", width: 12 },
      { header: "Total Votes", key: "totalVotes", width: 12 },
    ],
    summary.map((row) => ({
      ...row,
      studentAvg: row.student.averageRating ?? "N/A",
      studentVotes: row.student.voteCount,
      facultyAvg: row.faculty.averageRating ?? "N/A",
      facultyVotes: row.faculty.voteCount,
      overallAvg: row.overall.averageRating ?? "N/A",
    }))
  );
  const ratingColumns = [
    { header: "Project No.", key: "projectNumber", width: 14 },
    { header: "Project Title", key: "projectTitle", width: 36 },
    { header: "Voter Group", key: "voterRole", width: 12 },
    { header: "Voter Name", key: "voterName", width: 24 },
    { header: "Voter Email", key: "voterEmail", width: 30 },
    { header: "Roll No. / Employee ID", key: "voterCode", width: 20 },
    { header: "Score", key: "score", width: 8 },
    { header: "Feedback", key: "feedback", width: 60 },
    { header: "Last Updated", key: "updatedAt", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm" } },
  ];
  const toRow = (r) => ({
    projectNumber: r.project?.projectNumber ?? "(deleted)",
    projectTitle: r.project?.title ?? "",
    voterRole: r.voterRole,
    voterName: r.voter?.name ?? "(deleted user)",
    voterEmail: r.voter?.email ?? "",
    voterCode: r.voter?.rollNumber ?? r.voter?.employeeId ?? "",
    score: r.score,
    feedback: r.feedback,
    updatedAt: r.updatedAt,
  });

  const byYear = req.q.groupBy === "year";
  if (byYear) {
    // Year of study applies to student voters only; faculty have no year and get their own sheet.
    const studentRatings = ratings.filter((r) => r.voterRole === "student");
    for (const group of groupRowsByYear(studentRatings, (r) => r.voter?.year)) {
      addSheet(workbook, `Ratings - ${group.name}`, ratingColumns, group.rows.map(toRow));
    }
    addSheet(workbook, "Ratings - Faculty", ratingColumns, ratings.filter((r) => r.voterRole === "faculty").map(toRow));
  } else {
    addSheet(workbook, "Ratings", ratingColumns, ratings.map(toRow));
  }

  await audit(req, "report.voting_export", { summary: `Exported voting report${byYear ? " (grouped by year)" : ""}` });
  await sendWorkbook(res, workbook, `voting-report-${new Date().toISOString().slice(0, 10)}${byYear ? "-by-year" : ""}.xlsx`);
});

router.get("/settings", async (_req, res) => {
  const settings = await Settings.getGlobal();
  res.json({ settings, deadlines: deadlineSummary(settings) });
});

router.patch("/settings", validateBody(settingsSchema), async (req, res) => {
  const before = await Settings.getGlobal();
  // Only supplied fields change: omitted fields are untouched, null clears a deadline.
  await Settings.updateOne({ key: "global" }, { $set: req.body }, { runValidators: true });
  const settings = await Settings.getGlobal();

  const previousDeadlines = Object.fromEntries(
    DEADLINE_FIELDS.filter((field) => field in req.body).map((field) => [field, before.$locals.raw[field] ?? null])
  );
  await audit(req, "settings.update", {
    summary: "Updated event settings",
    details: { ...req.body, ...(Object.keys(previousDeadlines).length && { previousDeadlines }) },
  });
  res.json({ settings, deadlines: deadlineSummary(settings) });
});

router.get("/audit-logs", async (req, res) => {
  const paging = parsePagination(req.query, { defaultLimit: 30 });
  const [logs, total] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).populate("actor", "name role").lean(),
    AuditLog.estimatedDocumentCount(),
  ]);
  res.json({ logs, pagination: paginationMeta(paging, total) });
});

export default router;
