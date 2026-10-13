import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

const PASSWORD = "Passw0rd!";
const SESSION = "2026-10-13";
const EARLIER = "2026-10-12";
const FEEDBACK = "I understood the problem, the approach and the results that were demonstrated.";
const YEAR_SHEETS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

let mongo;
let app;
let models;

const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

/** Downloads an export and returns { names, sheets: { [name]: { headers, rows } } }. */
async function fetchWorkbook(agent, url) {
  const res = await binary(agent.get(url));
  assert.equal(res.status, 200, res.body?.toString?.());
  assert.match(res.headers["content-type"], /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body);
  const sheets = {};
  workbook.eachSheet((sheet) => {
    const headers = sheet.getRow(1).values.slice(1);
    const rows = [];
    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const values = sheet.getRow(i).values;
      rows.push(Object.fromEntries(headers.map((h, idx) => [h, values[idx + 1]])));
    }
    sheets[sheet.name] = { headers, rows };
  });
  return { names: workbook.worksheets.map((s) => s.name), sheets, disposition: res.headers["content-disposition"] };
}

const rolls = (sheet) => sheet.rows.map((r) => r["Roll Number"]).sort();

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.body.message);
  return agent;
}

describe("year-wise Excel exports", () => {
  const users = {};
  let admin;
  let student;
  let faculty;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    models = {
      User: (await import("../src/models/Users.js")).default,
      Project: (await import("../src/models/Project.js")).default,
      Rating: (await import("../src/models/Rating.js")).default,
      Attendance: (await import("../src/models/Attendance.js")).default,
      Settings: (await import("../src/models/Settings.js")).default,
    };
    await mongoose.connection.syncIndexes();
    const { User, Project, Rating, Attendance, Settings } = models;

    const make = async (key, data) => (users[key] = await User.create({ password: PASSWORD, ...data }));
    await make("admin", { name: "Admin", email: "admin@x.edu", role: "admin" });
    await make("fa", { name: "Faculty A", email: "fa@x.edu", role: "faculty", employeeId: "FA" });
    await make("fb", { name: "Faculty B", email: "fb@x.edu", role: "faculty", employeeId: "FB" });
    await make("y1a", { name: "Year1 A", email: "y1a@x.edu", role: "student", rollNumber: "S101", year: 1 });
    await make("y1b", { name: "Year1 B", email: "y1b@x.edu", role: "student", rollNumber: "S102", year: 1 });
    await make("y2", { name: "Year2", email: "y2@x.edu", role: "student", rollNumber: "S201", year: 2 });
    await make("y3", { name: "Year3", email: "y3@x.edu", role: "student", rollNumber: "S301", year: 3 });
    await make("y5", { name: "Year5", email: "y5@x.edu", role: "student", rollNumber: "S501", year: 5 });
    await make("none", { name: "No Year", email: "none@x.edu", role: "student", rollNumber: "S901" });
    await make("bad", { name: "Bad Year", email: "bad@x.edu", role: "student", rollNumber: "S902" });
    // Legacy/invalid data written around schema validation.
    await User.collection.updateOne({ _id: users.bad._id }, { $set: { year: "second" } });
    // A stray year on a faculty account must not place faculty in a student year sheet.
    await User.collection.updateOne({ _id: users.fa._id }, { $set: { year: 2 } });

    await Settings.create({ key: "global", votingOpen: true, activeSession: SESSION });
    const mark = (key, session, status) => ({ student: users[key]._id, session, status, markedBy: users.admin._id });
    await Attendance.create([
      mark("y1a", SESSION, "present"),
      mark("y1b", SESSION, "absent"),
      mark("y2", SESSION, "present"),
      mark("none", SESSION, "present"),
      mark("bad", SESSION, "absent"),
      mark("y1a", EARLIER, "present"),
      mark("y3", EARLIER, "absent"),
    ]);

    const project = await Project.create({
      projectNumber: "EX-1",
      title: "Export Project",
      abstract: "An abstract long enough for the validation rules to pass.",
      description: "A description that is long enough to pass the model's validation rules comfortably.",
      technologies: ["Excel"],
      teamMembers: [{ name: "Someone Else" }],
      facultyGuide: "Faculty B",
      submittedBy: users.y5._id,
      status: "approved",
    });
    await Rating.create(
      ["y1a", "y2", "none", "bad", "fa", "fb"].map((key, i) => ({
        project: project._id,
        voter: users[key]._id,
        voterRole: users[key].role,
        score: (i % 5) + 1,
        feedback: FEEDBACK,
      }))
    );

    admin = await signIn("admin@x.edu");
    student = await signIn("y1a@x.edu");
    faculty = await signIn("fb@x.edu");
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  describe("attendance export", () => {
    test("All in One Sheet keeps the original layout", async () => {
      for (const url of [`/api/admin/attendance/export?session=${SESSION}`, `/api/admin/attendance/export?session=${SESSION}&groupBy=none`]) {
        const wb = await fetchWorkbook(admin, url);
        assert.deepEqual(wb.names, [`Session ${SESSION}`]);
        const sheet = wb.sheets[`Session ${SESSION}`];
        assert.deepEqual(sheet.headers, ["Roll Number", "Name", "Email", "Department", "Year", "Status", "Projects Rated", "Marked By", "Marked At"]);
        assert.deepEqual(sheet.rows.map((r) => r["Roll Number"]), ["S101", "S102", "S201", "S301", "S501", "S901", "S902"]); // roll-number order
        assert.match(wb.disposition, /attendance-2026-10-13\.xlsx/);
      }
    });

    test("Group by Year puts each record only in its own year sheet", async () => {
      const flat = (await fetchWorkbook(admin, `/api/admin/attendance/export?session=${SESSION}`)).sheets[`Session ${SESSION}`];
      const wb = await fetchWorkbook(admin, `/api/admin/attendance/export?session=${SESSION}&groupBy=year`);

      assert.deepEqual(wb.names, [...YEAR_SHEETS, "5th Year", "Unassigned Year"]);
      assert.match(wb.disposition, /attendance-2026-10-13-by-year\.xlsx/);
      assert.deepEqual(rolls(wb.sheets["1st Year"]), ["S101", "S102"]);
      assert.deepEqual(rolls(wb.sheets["2nd Year"]), ["S201"]);
      assert.deepEqual(rolls(wb.sheets["3rd Year"]), ["S301"]);
      assert.deepEqual(rolls(wb.sheets["5th Year"]), ["S501"]);
      for (const name of wb.names) {
        assert.deepEqual(wb.sheets[name].headers, flat.headers, `${name} headers differ`);
        const expectedYear = { "1st Year": 1, "2nd Year": 2, "3rd Year": 3, "5th Year": 5 }[name];
        if (expectedYear) assert.ok(wb.sheets[name].rows.every((r) => r.Year === expectedYear), `${name} has another year`);
      }

      // Nothing lost or duplicated.
      const all = wb.names.flatMap((n) => rolls(wb.sheets[n])).sort();
      assert.deepEqual(all, rolls(flat));
    });

    test("statuses and existing fields are preserved per row", async () => {
      const wb = await fetchWorkbook(admin, `/api/admin/attendance/export?session=${SESSION}&groupBy=year`);
      const row = (sheet, roll) => wb.sheets[sheet].rows.find((r) => r["Roll Number"] === roll);
      assert.equal(row("1st Year", "S101").Status, "Present");
      assert.equal(row("1st Year", "S101")["Projects Rated"], 1);
      assert.equal(row("1st Year", "S101")["Marked By"], "Admin");
      assert.equal(row("1st Year", "S101").Email, "y1a@x.edu");
      assert.equal(row("1st Year", "S102").Status, "Absent");
      assert.equal(row("3rd Year", "S301").Status, "Not marked");
    });

    test("missing and invalid years go to Unassigned Year; empty years stay valid sheets", async () => {
      const wb = await fetchWorkbook(admin, `/api/admin/attendance/export?session=${SESSION}&groupBy=year`);
      const unassigned = wb.sheets["Unassigned Year"];
      assert.deepEqual(rolls(unassigned), ["S901", "S902"]);
      assert.equal(unassigned.rows.find((r) => r["Roll Number"] === "S901").Status, "Present");
      assert.equal(unassigned.rows.find((r) => r["Roll Number"] === "S902").Status, "Absent");

      const empty = wb.sheets["4th Year"];
      assert.equal(empty.rows.length, 0);
      assert.equal(empty.headers[0], "Roll Number");
    });

    test("all-sessions export groups every attendance record by year", async () => {
      const flat = (await fetchWorkbook(admin, "/api/admin/attendance/export?session=all")).sheets.Attendance;
      const wb = await fetchWorkbook(admin, "/api/admin/attendance/export?session=all&groupBy=year");
      assert.deepEqual(wb.names, [...YEAR_SHEETS, "Unassigned Year"]); // no 5th-year records in any session
      assert.equal(wb.sheets["1st Year"].headers[0], "Session");
      const firstYear = wb.sheets["1st Year"].rows.map((r) => [r.Session, r["Roll Number"], r.Status]);
      // The existing export orders by session only, so compare the set and the session order.
      assert.deepEqual(firstYear.map((r) => r[0]), [EARLIER, SESSION, SESSION]);
      assert.deepEqual(
        firstYear.map((r) => r.join("|")).sort(),
        [`${EARLIER}|S101|Present`, `${SESSION}|S101|Present`, `${SESSION}|S102|Absent`]
      );
      assert.deepEqual(wb.sheets["3rd Year"].rows.map((r) => [r.Session, r.Status]), [[EARLIER, "Absent"]]);
      const total = wb.names.reduce((n, name) => n + wb.sheets[name].rows.length, 0);
      assert.equal(total, flat.rows.length);
      assert.equal(total, 7);
    });
  });

  describe("voting report export", () => {
    test("All in One Sheet keeps Project Summary and a single Ratings sheet", async () => {
      const wb = await fetchWorkbook(admin, "/api/admin/reports/voting/export");
      assert.deepEqual(wb.names, ["Project Summary", "Ratings"]);
      assert.equal(wb.sheets.Ratings.rows.length, 6);
    });

    test("Group by Year splits student ratings by year and keeps faculty separate", async () => {
      const flat = (await fetchWorkbook(admin, "/api/admin/reports/voting/export")).sheets.Ratings;
      const wb = await fetchWorkbook(admin, "/api/admin/reports/voting/export?groupBy=year");
      assert.deepEqual(wb.names, [
        "Project Summary",
        ...YEAR_SHEETS.map((n) => `Ratings - ${n}`),
        "Ratings - Unassigned Year",
        "Ratings - Faculty",
      ]);

      const codes = (name) => wb.sheets[name].rows.map((r) => r["Roll No. / Employee ID"]).sort();
      assert.deepEqual(codes("Ratings - 1st Year"), ["S101"]);
      assert.deepEqual(codes("Ratings - 2nd Year"), ["S201"]); // faculty FA (stray year 2) is not here
      assert.deepEqual(codes("Ratings - Unassigned Year"), ["S901", "S902"]);
      assert.deepEqual(codes("Ratings - Faculty"), ["FA", "FB"]);
      assert.ok(wb.sheets["Ratings - Faculty"].rows.every((r) => r["Voter Group"] === "faculty"));
      for (const name of wb.names.slice(1, -1)) {
        assert.ok(wb.sheets[name].rows.every((r) => r["Voter Group"] === "student"), `${name} has non-students`);
        assert.deepEqual(wb.sheets[name].headers, flat.headers);
      }
      const total = wb.names.slice(1).reduce((n, name) => n + wb.sheets[name].rows.length, 0);
      assert.equal(total, flat.rows.length);
    });
  });

  describe("validation and authorization", () => {
    test("rejects unknown export parameters", async () => {
      assert.equal((await admin.get("/api/admin/attendance/export?groupBy=department")).status, 400);
      assert.equal((await admin.get("/api/admin/attendance/export?groupBy=year&sort=name")).status, 400);
      assert.equal((await admin.get("/api/admin/reports/voting/export?groupBy=semester")).status, 400);
    });

    test("only admins can download exports", async () => {
      const urls = [
        "/api/admin/attendance/export?groupBy=year",
        "/api/admin/attendance/export?session=all&groupBy=none",
        "/api/admin/reports/voting/export?groupBy=year",
        "/api/admin/reports/voting/export",
      ];
      for (const url of urls) {
        assert.equal((await request(app).get(url)).status, 401, url);
        assert.equal((await student.get(url)).status, 403, url);
        assert.equal((await faculty.get(url)).status, 403, url);
      }
    });
  });
});
