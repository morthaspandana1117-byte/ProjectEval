import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Test-only credentials for the in-memory database.
const PASSWORD = "Passw0rd!";
const SESSION = "2026-10-14";
const FEEDBACK = "I understood the problem, the approach and the results that were demonstrated.";
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$.{53}$/;
const clientFile = (path) => new URL(`../../client/src/${path}`, import.meta.url);

let mongo;
let app;
let User;
let Project;
let Settings;

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  return { agent, res };
}

const studentPayload = (n, overrides = {}) => ({
  name: `Student Number ${n}`,
  email: `student${n}@college.edu`,
  password: PASSWORD,
  role: "student",
  department: "Computer Science",
  year: 2,
  rollNumber: `ST${String(n).padStart(3, "0")}`,
  ...overrides,
});

describe("admin-only student accounts", () => {
  let admin;
  let faculty;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    User = (await import("../src/models/Users.js")).default;
    Project = (await import("../src/models/Project.js")).default;
    Settings = (await import("../src/models/Settings.js")).default;
    await mongoose.connection.syncIndexes();

    await User.create({ name: "Admin", email: "admin@college.edu", password: PASSWORD, role: "admin" });
    ({ agent: admin } = await signIn("admin@college.edu"));
    const fac = await admin.post("/api/admin/users").send({
      name: "Dr. Faculty Member",
      email: "faculty@college.edu",
      password: PASSWORD,
      role: "faculty",
      employeeId: "FAC-01",
    });
    assert.equal(fac.status, 201);
    ({ agent: faculty } = await signIn("faculty@college.edu"));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("public student registration rejects role choices and admin-only fields", async () => {
    const before = await User.countDocuments();
    const base = { name: "Public Student", email: "public@college.edu", rollNumber: "PB001", department: "CSE", year: 1, password: PASSWORD, confirmPassword: PASSWORD };
    for (const extra of [{ role: "student" }, { role: "admin" }, { employeeId: "EMP-1" }, { isActive: false }]) {
      const res = await request(app).post("/api/auth/register").send({ ...base, ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra));
      assert.equal(res.headers["set-cookie"], undefined, "no session must be issued");
    }
    assert.equal(await User.countDocuments(), before);
    assert.equal(await User.exists({ email: "public@college.edu" }), null);
  });

  test("admins create student accounts with the existing validation and hashing", async () => {
    const res = await admin.post("/api/admin/users").send(studentPayload(1, { email: "  Student1@College.EDU ", rollNumber: "st001", year: 3 }));
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.user.role, "student");
    assert.equal(res.body.user.email, "student1@college.edu");
    assert.equal(res.body.user.rollNumber, "ST001");
    assert.equal(res.body.user.password, undefined);

    const stored = await User.findOne({ email: "student1@college.edu" }).select("+password");
    assert.match(stored.password, BCRYPT_HASH);

    // Student rules still apply: a roll number is required and must be unique.
    const noRoll = await admin.post("/api/admin/users").send(studentPayload(2, { rollNumber: undefined }));
    assert.equal(noRoll.status, 400);
    assert.ok(noRoll.body.errors.rollNumber);
    const dupRoll = await admin.post("/api/admin/users").send(studentPayload(3, { rollNumber: "ST001" }));
    assert.equal(dupRoll.status, 409);
  });

  test("unauthenticated users, students and faculty cannot create students", async () => {
    const { agent: student } = await signIn("student1@college.edu");
    const payload = studentPayload(9);
    assert.equal((await request(app).post("/api/admin/users").send(payload)).status, 401);
    assert.equal((await student.post("/api/admin/users").send(payload)).status, 403);
    assert.equal((await faculty.post("/api/admin/users").send(payload)).status, 403);
    assert.equal(await User.exists({ email: payload.email }), null);
  });

  test("students created by an admin can log in", async () => {
    const { agent, res } = await signIn("STUDENT1@college.edu");
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "student");
    assert.match(res.headers["set-cookie"].join(";"), /pe_session=.*HttpOnly/i);
    assert.equal((await agent.get("/api/auth/me")).body.user.email, "student1@college.edu");
  });

  test("faculty and admin login still work", async () => {
    const fac = await signIn("faculty@college.edu");
    assert.equal(fac.res.status, 200);
    assert.equal(fac.res.body.user.role, "faculty");
    const adm = await signIn("admin@college.edu");
    assert.equal(adm.res.status, 200);
    assert.equal(adm.res.body.user.role, "admin");
    assert.equal((await adm.agent.get("/api/admin/stats")).status, 200);
  });

  test("attendance and voting eligibility are unchanged for admin-created students", async () => {
    const presenter = await admin.post("/api/admin/users").send(studentPayload(20));
    const voterRes = await admin.post("/api/admin/users").send(studentPayload(21));
    const project = await Project.create({
      projectNumber: "ELG-1",
      title: "Eligibility Project",
      description: "A project used to check that attendance still gates student voting.",
      teamMembers: [{ name: "Student Number 20", rollNumber: "ST020" }],
      facultyGuide: "Dr. Guide",
      submittedBy: presenter.body.user._id,
      status: "approved",
    });
    await Settings.getGlobal();
    await Settings.updateOne({ key: "global" }, { votingOpen: true, activeSession: SESSION });

    const { agent: voter } = await signIn("student21@college.edu");
    const rate = (agent) => agent.put(`/api/projects/${project._id}/rating`).send({ score: 4, feedback: FEEDBACK });

    const notPresent = await rate(voter);
    assert.equal(notPresent.status, 403);
    assert.match(notPresent.body.message, /present/);

    const marked = await admin
      .put("/api/admin/attendance")
      .send({ session: SESSION, records: [{ studentId: voterRes.body.user._id, status: "present" }] });
    assert.equal(marked.status, 200);
    assert.equal((await rate(voter)).status, 201);

    // Faculty still vote without attendance.
    assert.equal((await rate(faculty)).status, 201);
  });

  test("the old /register URL forwards to the student registration page (static check)", async () => {
    await assert.rejects(access(clientFile("pages/Register.jsx")), "the old admin-era registration page stays removed");
    const app = await readFile(clientFile("App.jsx"), "utf8");
    assert.match(app, /<Route path="register" element=\{<Navigate to="\/register\/student" replace \/>\} \/>/);
    assert.match(app, /<Route path="register\/student" element=\{<StudentRegister \/>\} \/>/);
  });
});
