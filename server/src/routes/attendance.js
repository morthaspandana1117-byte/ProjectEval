import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import Attendance from "../models/Attendance.js";
import Rating from "../models/Rating.js";
import Settings from "../models/Settings.js";
import User from "../models/Users.js";
import { audit } from "../services/audit.js";
import { addSheet, createWorkbook, groupRowsByYear, sendWorkbook } from "../services/excel.js";
import { badRequest, escapeRegex } from "../utils/http.js";
import { attendanceExportQuery, attendanceQuery, attendanceUpdateSchema } from "../utils/schemas.js";

const router = Router();
router.use(authenticate, authorize("admin"));

router.get("/sessions", async (_req, res) => {
  const settings = await Settings.getGlobal();
  const rows = await Attendance.aggregate([
    {
      $group: {
        _id: "$session",
        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  res.json({
    activeSession: settings.activeSession,
    sessions: rows.map((row) => ({ session: row._id, present: row.present, absent: row.absent })),
  });
});

router.get("/", validateQuery(attendanceQuery), async (req, res) => {
  const settings = await Settings.getGlobal();
  const session = req.q.session ?? settings.activeSession;

  const filter = { role: "student", isActive: true };
  if (req.q.search) {
    const pattern = new RegExp(escapeRegex(req.q.search), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { rollNumber: pattern }, { department: pattern }];
  }

  const students = await User.find(filter)
    .select("name email rollNumber department year")
    .sort({ rollNumber: 1, name: 1 })
    .lean();
  const ids = students.map((s) => s._id);
  const [records, voteCounts] = await Promise.all([
    Attendance.find({ session, student: { $in: ids } }).lean(),
    Rating.aggregate([{ $match: { voter: { $in: ids } } }, { $group: { _id: "$voter", count: { $sum: 1 } } }]),
  ]);
  const recordByStudent = new Map(records.map((r) => [r.student.toString(), r]));
  const votesByStudent = new Map(voteCounts.map((r) => [r._id.toString(), r.count]));

  const rows = students.map((student) => {
    const record = recordByStudent.get(student._id.toString());
    return {
      ...student,
      status: record?.status ?? "unmarked",
      markedAt: record?.markedAt ?? null,
      votesCast: votesByStudent.get(student._id.toString()) ?? 0,
    };
  });

  const summary = { total: rows.length, present: 0, absent: 0, unmarked: 0 };
  rows.forEach((row) => (summary[row.status] += 1));

  res.json({
    session,
    activeSession: settings.activeSession,
    summary,
    students: req.q.status ? rows.filter((row) => row.status === req.q.status) : rows,
  });
});

router.put("/", validateBody(attendanceUpdateSchema), async (req, res) => {
  const { session, records } = req.body;
  const uniqueRecords = [...new Map(records.map((r) => [r.studentId, r])).values()];
  const ids = uniqueRecords.map((r) => r.studentId);

  const studentCount = await User.countDocuments({ _id: { $in: ids }, role: "student" });
  if (studentCount !== ids.length) throw badRequest("Attendance can only be marked for registered students.");

  const markedAt = new Date();
  await Attendance.bulkWrite(
    uniqueRecords.map(({ studentId, status }) => ({
      updateOne: {
        filter: { student: studentId, session },
        update: { $set: { status, markedBy: req.user._id, markedAt } },
        upsert: true,
      },
    }))
  );

  const present = uniqueRecords.filter((r) => r.status === "present").length;
  await audit(req, "attendance.mark", {
    targetType: "Attendance",
    summary: `Session ${session}: ${present} present, ${uniqueRecords.length - present} absent`,
    details: { session, count: uniqueRecords.length },
  });
  res.json({ message: `Attendance saved for ${uniqueRecords.length} student(s).`, updated: uniqueRecords.length });
});

router.get("/export", validateQuery(attendanceExportQuery), async (req, res) => {
  const settings = await Settings.getGlobal();
  const session = req.q.session ?? settings.activeSession;
  const allSessions = session === "all";

  const students = await User.find({ role: "student" })
    .select("name email rollNumber department year isActive")
    .sort({ rollNumber: 1, name: 1 })
    .lean();
  const records = await Attendance.find(allSessions ? {} : { session })
    .populate("markedBy", "name")
    .sort({ session: 1 })
    .lean();
  const voteCounts = await Rating.aggregate([
    { $match: { voterRole: "student" } },
    { $group: { _id: "$voter", count: { $sum: 1 } } },
  ]);
  const votesByStudent = new Map(voteCounts.map((r) => [r._id.toString(), r.count]));
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const workbook = createWorkbook();
  const studentColumns = [
    { header: "Roll Number", key: "rollNumber", width: 16 },
    { header: "Name", key: "name", width: 28 },
    { header: "Email", key: "email", width: 32 },
    { header: "Department", key: "department", width: 20 },
    { header: "Year", key: "year", width: 8 },
  ];

  let sheetName;
  let columns;
  let rows;
  if (allSessions) {
    sheetName = "Attendance";
    columns = [
      { header: "Session", key: "session", width: 14 },
      ...studentColumns,
      { header: "Status", key: "status", width: 12 },
      { header: "Marked By", key: "markedBy", width: 20 },
      { header: "Marked At", key: "markedAt", width: 22, style: { numFmt: "yyyy-mm-dd hh:mm" } },
    ];
    rows = records
      .filter((r) => studentById.has(r.student.toString()))
      .map((r) => {
        const s = studentById.get(r.student.toString());
        return {
          session: r.session,
          ...s,
          status: r.status === "present" ? "Present" : "Absent",
          markedBy: r.markedBy?.name ?? "",
          markedAt: r.markedAt,
        };
      });
  } else {
    sheetName = `Session ${session}`;
    columns = [
      ...studentColumns,
      { header: "Status", key: "status", width: 12 },
      { header: "Projects Rated", key: "votesCast", width: 15 },
      { header: "Marked By", key: "markedBy", width: 20 },
      { header: "Marked At", key: "markedAt", width: 22, style: { numFmt: "yyyy-mm-dd hh:mm" } },
    ];
    const recordByStudent = new Map(records.map((r) => [r.student.toString(), r]));
    rows = students
      .filter((s) => s.isActive || recordByStudent.has(s._id.toString()))
      .map((s) => {
        const r = recordByStudent.get(s._id.toString());
        return {
          ...s,
          status: r ? (r.status === "present" ? "Present" : "Absent") : "Not marked",
          votesCast: votesByStudent.get(s._id.toString()) ?? 0,
          markedBy: r?.markedBy?.name ?? "",
          markedAt: r?.markedAt ?? null,
        };
      });
  }

  const byYear = req.q.groupBy === "year";
  if (byYear) {
    // Same columns and row order as the single-sheet export, split by year of study.
    for (const group of groupRowsByYear(rows, (row) => row.year)) addSheet(workbook, group.name, columns, group.rows);
  } else {
    addSheet(workbook, sheetName, columns, rows);
  }

  await audit(req, "attendance.export", {
    summary: `Exported attendance (${session}${byYear ? ", grouped by year" : ""})`,
  });
  await sendWorkbook(res, workbook, `attendance-${session}${byYear ? "-by-year" : ""}.xlsx`);
});

export default router;
