import Project from "../models/Project.js";
import Rating from "../models/Rating.js";

export const LEADERBOARD_GROUPS = ["student", "faculty", "overall"];

const round2 = (value) => Math.round(value * 100) / 100;

const emptyTotals = () => ({ sum: 0, count: 0, distribution: [0, 0, 0, 0, 0] });

function combineTotals(a, b) {
  return {
    sum: a.sum + b.sum,
    count: a.count + b.count,
    distribution: a.distribution.map((n, i) => n + b.distribution[i]),
  };
}

/**
 * Exact per-project rating totals by voter group, read straight from the ratings collection.
 * There is one rating document per (project, voter) — updates overwrite it — so every voter's
 * current rating is counted exactly once. Averages are derived from these integer sums, never
 * from previously rounded averages.
 *
 * Returns Map projectId -> { student: totals, faculty: totals }.
 */
async function ratingTotals(projectIds) {
  const match = projectIds ? { project: { $in: projectIds } } : {};
  const rows = await Rating.aggregate([
    { $match: match },
    { $group: { _id: { project: "$project", role: "$voterRole", score: "$score" }, count: { $sum: 1 } } },
  ]);

  const totals = new Map();
  for (const { _id, count } of rows) {
    const key = _id.project.toString();
    if (!totals.has(key)) totals.set(key, { student: emptyTotals(), faculty: emptyTotals() });
    const group = totals.get(key)[_id.role];
    group.sum += _id.score * count;
    group.count += count;
    group.distribution[_id.score - 1] += count;
  }
  return totals;
}

function totalsFor(totals, projectId) {
  return totals.get(projectId.toString()) ?? { student: emptyTotals(), faculty: emptyTotals() };
}

/** A category with no ratings has a null average (shown as "N/A"). */
function summarize({ sum, count }) {
  return { averageRating: count ? round2(sum / count) : null, voteCount: count };
}

function summarizeProject({ student, faculty }) {
  return {
    student: summarize(student),
    faculty: summarize(faculty),
    // Unweighted: every valid rating counts equally regardless of the voter's group.
    overall: summarize(combineTotals(student, faculty)),
  };
}

/** Map of projectId -> { student, faculty, overall }, each { averageRating, voteCount }. */
export async function ratingStatsByProject(projectIds) {
  const totals = await ratingTotals(projectIds);
  return new Map([...totals].map(([key, groups]) => [key, summarizeProject(groups)]));
}

export function statsFor(stats, projectId) {
  return stats.get(projectId.toString()) ?? summarizeProject({ student: emptyTotals(), faculty: emptyTotals() });
}

/**
 * Project leaderboard for one category: "student", "faculty" or "overall".
 * Only projects with at least one rating in that category are listed. Ordered by the exact
 * average (highest first); equal averages are ordered by project title, then project number.
 * Entries contain project details and aggregates only — never voter identities.
 */
export async function buildLeaderboard(group) {
  const projects = await Project.find({ status: "approved" })
    .select("projectNumber title teamMembers facultyGuide")
    .lean();
  const totals = await ratingTotals(projects.map((p) => p._id));

  const entries = [];
  for (const project of projects) {
    const groups = totalsFor(totals, project._id);
    const category = group === "overall" ? combineTotals(groups.student, groups.faculty) : groups[group];
    if (!category.count) continue;

    entries.push({
      sum: category.sum,
      project: {
        _id: project._id,
        projectNumber: project.projectNumber,
        title: project.title,
        teamSize: project.teamMembers.length,
        facultyGuide: project.facultyGuide ?? null,
      },
      averageRating: round2(category.sum / category.count),
      voteCount: category.count,
      distribution: category.distribution,
      ...(group === "overall" && {
        studentVoteCount: groups.student.count,
        facultyVoteCount: groups.faculty.count,
      }),
    });
  }

  entries.sort((a, b) => {
    // Compare exact averages a.sum/a.count vs b.sum/b.count with integer arithmetic.
    const byAverage = b.sum * a.voteCount - a.sum * b.voteCount;
    if (byAverage !== 0) return byAverage;
    const byTitle = a.project.title.localeCompare(b.project.title, "en", { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
    return a.project.projectNumber.localeCompare(b.project.projectNumber, "en");
  });

  return entries.map(({ sum: _sum, ...entry }, index) => ({ rank: index + 1, ...entry }));
}
