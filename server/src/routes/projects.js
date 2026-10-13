import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadLimiter, writeLimiter } from "../middleware/rateLimits.js";
import { inspectUpload, uploadFiles } from "../middleware/upload.js";
import { objectIdParam, validateBody, validateQuery } from "../middleware/validate.js";
import Project, { MAX_PROJECT_FILES } from "../models/Project.js";
import Rating from "../models/Rating.js";
import Settings from "../models/Settings.js";
import { audit } from "../services/audit.js";
import {
  deadlineSummary,
  isSubmitter,
  permissionFlags,
  projectPermissions,
  submissionStatus,
} from "../services/deadlines.js";
import { getVotingEligibility, isOwnProject } from "../services/eligibility.js";
import { deleteFile, deleteFiles, fileExists, openFileStream, saveFile } from "../services/files.js";
import { ratingStatsByProject, statsFor } from "../services/reports.js";
import {
  badRequest,
  escapeRegex,
  forbidden,
  notFound,
  paginationMeta,
  parsePagination,
} from "../utils/http.js";
import { projectListQuery, projectSchema, projectUpdateSchema, ratingSchema } from "../utils/schemas.js";

const router = Router();
router.use(authenticate);
router.param("id", objectIdParam);
router.param("fileId", objectIdParam);

// Unapproved projects are visible only to their presenter and administrators.
function canView(project, user) {
  return project.status === "approved" || user.role === "admin" || isSubmitter(project, user);
}

/** Loads settings and returns this user's permissions on the project (ownership, approval, deadlines). */
async function permissionsFor(project, user, now = new Date()) {
  const settings = await Settings.getGlobal();
  return projectPermissions(project, user, settings, now);
}

async function loadProject(id, user, { populate = false } = {}) {
  let query = Project.findById(id);
  if (populate) {
    query = query.populate("submittedBy", "name rollNumber department");
  }
  const project = await query;
  // Hide unapproved projects entirely from users who may not see them.
  if (!project || !canView(project, user)) throw notFound("Project not found.");
  return project;
}

router.get("/", validateQuery(projectListQuery), async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const filter = { status: isAdmin ? req.q.status : "approved" };
  if (!filter.status) delete filter.status;
  if (req.q.search) {
    const pattern = new RegExp(escapeRegex(req.q.search), "i");
    // Legacy abstracts stay searchable for older projects.
    filter.$or = [{ title: pattern }, { projectNumber: pattern }, { description: pattern }, { abstract: pattern }];
  }

  const paging = parsePagination(req.q, { defaultLimit: 12 });
  const [projects, total] = await Promise.all([
    Project.find(filter)
      .select("-files.fileId")
      .populate("submittedBy", "name rollNumber")
      .sort({ projectNumber: 1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .lean(),
    Project.countDocuments(filter),
  ]);

  const ids = projects.map((p) => p._id);
  const myRatings = await Rating.find({ voter: req.user._id, project: { $in: ids } }).select("project score").lean();
  const myScoreByProject = new Map(myRatings.map((r) => [r.project.toString(), r.score]));
  const stats = isAdmin ? await ratingStatsByProject(ids) : null;

  res.json({
    projects: projects.map((project) => ({
      ...project,
      fileCount: project.files?.length ?? 0,
      files: undefined,
      myScore: myScoreByProject.get(project._id.toString()) ?? null,
      isOwn: isOwnProject(project, req.user),
      ...(stats && { stats: statsFor(stats, project._id) }),
    })),
    pagination: paginationMeta(paging, total),
  });
});

router.get("/mine", authorize("student"), async (req, res) => {
  const now = new Date();
  const [projects, settings] = await Promise.all([
    Project.find({ submittedBy: req.user._id }).sort({ createdAt: -1 }).lean(),
    Settings.getGlobal(),
  ]);
  res.json({
    projects: projects.map((project) => ({
      ...project,
      permissions: permissionFlags(projectPermissions(project, req.user, settings, now)),
    })),
    deadlines: deadlineSummary(settings, now),
  });
});

router.get("/:id", async (req, res) => {
  const project = await loadProject(req.params.id, req.user, { populate: true });
  const settings = await Settings.getGlobal();
  const now = new Date();
  const own = isOwnProject(project, req.user);
  const isAdmin = req.user.role === "admin";

  const myRating = await Rating.findOne({ project: project._id, voter: req.user._id })
    .select("score feedback createdAt updatedAt")
    .lean();

  let canRate = { allowed: false, reason: null };
  if (project.status !== "approved") {
    canRate.reason = "This project has not been approved for voting yet.";
  } else if (own) {
    canRate.reason = "You cannot rate a project you are presenting.";
  } else {
    const eligibility = await getVotingEligibility(req.user, settings);
    canRate = { allowed: eligibility.eligible, reason: eligibility.reason ?? null };
  }

  const showStats = isAdmin || settings.leaderboardVisible;
  const stats = showStats ? statsFor(await ratingStatsByProject([project._id]), project._id) : null;

  res.json({
    project,
    myRating,
    canRate,
    stats,
    permissions: {
      ...permissionFlags(projectPermissions(project, req.user, settings, now)),
      canViewFeedback: isAdmin || isSubmitter(project, req.user),
      isOwn: own,
    },
    deadlines: deadlineSummary(settings, now),
  });
});

router.post("/", authorize("student"), writeLimiter, validateBody(projectSchema), async (req, res) => {
  const submission = submissionStatus(await Settings.getGlobal());
  if (!submission.open) throw forbidden(submission.reason);

  const project = await Project.create({ ...req.body, submittedBy: req.user._id, status: "pending" });
  await audit(req, "project.create", {
    targetType: "Project",
    targetId: project._id,
    summary: `${project.projectNumber} ${project.title}`,
  });
  res.status(201).json({ project });
});

router.patch("/:id", writeLimiter, validateBody(projectUpdateSchema), async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  const { edit } = await permissionsFor(project, req.user);
  if (!edit.allowed) throw forbidden(edit.reason);

  project.set(req.body);
  // A presenter's edit to a rejected project resubmits it for review.
  if (req.user.role !== "admin" && project.status === "rejected") {
    project.status = "pending";
    project.reviewNote = undefined;
  }
  await project.save();
  await audit(req, "project.update", { targetType: "Project", targetId: project._id, summary: project.projectNumber });
  res.json({ project });
});

router.delete("/:id", async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  const permissions = await permissionsFor(project, req.user);
  if (!permissions.delete.allowed) throw forbidden(permissions.delete.reason);

  await deleteFiles(project.files.map((f) => f.fileId));
  await Rating.deleteMany({ project: project._id });
  await project.deleteOne();
  await audit(req, "project.delete", {
    targetType: "Project",
    targetId: project._id,
    summary: `${project.projectNumber} ${project.title}`,
  });
  res.json({ message: "Project deleted." });
});

router.post("/:id/files", uploadLimiter, async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  // Checked on arrival, before multer reads or stores any file data.
  const { uploadFiles: upload } = await permissionsFor(project, req.user);
  if (!upload.allowed) throw forbidden(upload.reason);

  await new Promise((resolve, reject) => uploadFiles(req, res, (err) => (err ? reject(err) : resolve())));
  const files = req.files ?? [];
  if (!files.length) throw badRequest("Choose at least one file to upload.");
  if (project.files.length + files.length > MAX_PROJECT_FILES) {
    throw badRequest(`A project can have at most ${MAX_PROJECT_FILES} files. Remove some files first.`);
  }

  const inspected = files.map((file) => ({ file, meta: inspectUpload(file) }));
  const stored = [];
  try {
    for (const { file, meta } of inspected) {
      const fileId = await saveFile(file.buffer, {
        ...meta,
        metadata: { project: project._id, uploadedBy: req.user._id },
      });
      stored.push({ ...meta, fileId });
    }
    project.files.push(...stored);
    await project.save();
  } catch (error) {
    await deleteFiles(stored.map((f) => f.fileId));
    throw error;
  }

  await audit(req, "project.files_upload", {
    targetType: "Project",
    targetId: project._id,
    summary: `${stored.length} file(s) added to ${project.projectNumber}`,
  });
  res.status(201).json({ files: project.files });
});

router.delete("/:id/files/:fileId", async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  const { removeFiles } = await permissionsFor(project, req.user);
  if (!removeFiles.allowed) throw forbidden(removeFiles.reason);

  const file = project.files.id(req.params.fileId);
  if (!file) throw notFound("File not found.");
  const storedId = file.fileId;
  file.deleteOne();
  await project.save();
  await deleteFile(storedId);
  res.json({ files: project.files });
});

router.get("/:id/files/:fileId", async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  const file = project.files.id(req.params.fileId);
  if (!file) throw notFound("File not found.");

  if (!(await fileExists(file.fileId))) throw notFound("File not found.");

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Length", file.size);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  try {
    await pipeline(openFileStream(file.fileId), res);
  } catch (error) {
    if (!res.headersSent) throw error;
    res.destroy(error);
  }
});

// The presenter and admins see what voters understood, without voter identities.
router.get("/:id/feedback", async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  const allowed = req.user.role === "admin" || isSubmitter(project, req.user);
  if (!allowed) throw forbidden("Only the presenter and administrators can view feedback.");

  const feedback = await Rating.find({ project: project._id })
    .select("score feedback voterRole updatedAt -_id")
    .sort({ updatedAt: -1 })
    .lean();
  res.json({ feedback });
});

router.put("/:id/rating", authorize("student", "faculty"), writeLimiter, validateBody(ratingSchema), async (req, res) => {
  const project = await loadProject(req.params.id, req.user);
  if (project.status !== "approved") throw badRequest("This project is not open for rating.");
  if (isOwnProject(project, req.user)) throw forbidden("You cannot rate a project you are presenting.");

  const eligibility = await getVotingEligibility(req.user);
  if (!eligibility.eligible) throw forbidden(eligibility.reason);

  const filter = { project: project._id, voter: req.user._id };
  const update = { $set: { ...req.body, voterRole: req.user.role } };
  const options = { upsert: true, returnDocument: "after", runValidators: true, includeResultMetadata: true };

  let result;
  try {
    result = await Rating.findOneAndUpdate(filter, update, options);
  } catch (error) {
    // Two concurrent first-time submissions can race on the unique index; the retry becomes an update.
    if (error?.code !== 11000) throw error;
    result = await Rating.findOneAndUpdate(filter, update, options);
  }

  const created = !result.lastErrorObject?.updatedExisting;
  const rating = result.value;
  res.status(created ? 201 : 200).json({
    message: created ? "Thank you! Your rating has been recorded." : "Your rating has been updated.",
    rating: { score: rating.score, feedback: rating.feedback, createdAt: rating.createdAt, updatedAt: rating.updatedAt },
  });
});

export default router;
