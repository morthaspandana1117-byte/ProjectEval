import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Test-only credentials for the in-memory database.
const PASSWORD = "Passw0rd!";
const ENDPOINT = "/api/auth/register";
const SESSION = "2026-10-14";
const FEEDBACK = "I understood the problem, the approach and the results that were demonstrated.";
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$.{53}$/;

let mongo;
let app;
let User;
let Attendance;
let AuditLog;
let Project;
let Settings;

// Each payload gets its own roll number unless a test sets one, so roll-number uniqueness never
// interferes with tests about other fields.
let rollSeq = 0;
const registration = (overrides = {}) => ({
  name: "Asha Rao",
  email: "asha.rao@college.edu",
  rollNumber: `AUTO${String(++rollSeq).padStart(3, "0")}`,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  ...overrides,
});

function allKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      allKeys(v, keys);
    }
  }
  return keys;
}

function assertNoSecrets(body) {
  const keys = allKeys(body);
  for (const key of ["password", "confirmPassword", "tokenVersion"]) assert.ok(!keys.has(key), `response exposes "${key}"`);
  assert.ok(!/\$2[aby]\$\d{2}\$/.test(JSON.stringify(body)), "response contains a bcrypt hash");
}

async function login(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  return { agent, res };
}

describe("student self-registration", () => {
  let admin;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    User = (await import("../src/models/Users.js")).default;
    Attendance = (await import("../src/models/Attendance.js")).default;
    AuditLog = (await import("../src/models/AuditLog.js")).default;
    Project = (await import("../src/models/Project.js")).default;
    Settings = (await import("../src/models/Settings.js")).default;
    await mongoose.connection.syncIndexes(); // the unique email index guards against duplicate races
    await User.create({ name: "Admin", email: "admin@sr.edu", password: PASSWORD, role: "admin" });
    ({ agent: admin } = await login("admin@sr.edu"));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("a student registers and gets a student account (without being signed in)", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send(registration({ name: "  Asha Rao  ", email: "  Asha.Rao@College.EDU ", rollNumber: "  21cs045 " }));

    assert.equal(res.status, 201, res.body.message);
    assert.match(res.body.message, /student account has been created/i);
    assert.equal(res.body.user.role, "student");
    assert.equal(res.body.user.isActive, true);
    assert.equal(res.body.user.name, "Asha Rao");
    assert.equal(res.body.user.email, "asha.rao@college.edu"); // normalized
    assert.equal(res.body.user.rollNumber, "21CS045"); // normalized like admin-created students
    assertNoSecrets(res.body);
    assert.equal(res.headers["set-cookie"], undefined, "the student signs in through the login page");
  });

  test("the password is hashed and the confirmation is never stored", async () => {
    const raw = await User.collection.findOne({ email: "asha.rao@college.edu" });
    assert.match(raw.password, BCRYPT_HASH);
    assert.notEqual(raw.password, PASSWORD);
    assert.ok(!("confirmPassword" in raw), "confirmPassword must not be persisted");
    assert.equal(raw.role, "student");
    assert.equal(raw.rollNumber, "21CS045");
    assert.ok(await AuditLog.exists({ action: "user.register", targetId: raw._id }), "activity log entry missing");
  });

  test("the new student can log in with the registered credentials", async () => {
    const { agent, res } = await login("ASHA.RAO@college.edu");
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "student");
    assertNoSecrets(res.body);
    const me = await agent.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "asha.rao@college.edu");
    assert.equal((await login("asha.rao@college.edu", "WrongPassw0rd")).res.status, 401);
  });

  test("missing and invalid fields are rejected with field errors", async () => {
    const cases = [
      [registration({ name: "" }), "name"],
      [registration({ name: "   " }), "name"],
      [registration({ name: "A" }), "name"],
      [registration({ name: "x".repeat(101) }), "name"],
      [registration({ name: undefined }), "name"],
      [registration({ email: "not-an-email" }), "email"],
      [registration({ email: "" }), "email"],
      [registration({ email: undefined }), "email"],
      [registration({ password: "Sh0rt", confirmPassword: "Sh0rt" }), "password"],
      [registration({ password: "nodigitshere", confirmPassword: "nodigitshere" }), "password"],
      [registration({ password: undefined }), "password"],
      [registration({ confirmPassword: undefined }), "confirmPassword"],
      [registration({ confirmPassword: "" }), "confirmPassword"],
      [registration({ confirmPassword: "Passw0rd!different" }), "confirmPassword"],
    ];
    for (const [body, field] of cases) {
      const res = await request(app).post(ENDPOINT).send({ ...body, email: body.email === undefined ? undefined : body.email.replace("asha.rao", "new.person") });
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 90));
      assert.ok(res.body.errors?.[field], `expected an error for ${field}: ${JSON.stringify(res.body)}`);
    }
    assert.equal(await User.exists({ email: "new.person@college.edu" }), null);
  });

  test("duplicate emails are rejected, including case and spacing variations", async () => {
    await admin.post("/api/admin/users").send({ name: "Existing Faculty", email: "faculty.taken@college.edu", password: PASSWORD, role: "faculty" });
    for (const email of ["asha.rao@college.edu", "ASHA.RAO@COLLEGE.EDU", "  Asha.Rao@college.edu  ", "Faculty.Taken@College.edu", "ADMIN@sr.edu"]) {
      const res = await request(app).post(ENDPOINT).send(registration({ name: "Someone Else", email }));
      assert.equal(res.status, 409, email);
      assert.equal(res.body.errors.email, "An account with this email already exists.");
      assertNoSecrets(res.body);
    }
    assert.equal(await User.countDocuments({ email: "asha.rao@college.edu" }), 1);
    assert.equal((await User.findOne({ email: "faculty.taken@college.edu" })).role, "faculty");
    assert.equal((await User.findOne({ email: "admin@sr.edu" })).role, "admin");
  });

  test("concurrent duplicate registrations create exactly one account", async () => {
    const results = await Promise.all([
      request(app).post(ENDPOINT).send(registration({ name: "Race One", email: "race@college.edu" })),
      request(app).post(ENDPOINT).send(registration({ name: "Race Two", email: "RACE@college.edu" })),
      request(app).post(ENDPOINT).send(registration({ name: "Race Three", email: " race@College.edu " })),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await User.countDocuments({ email: "race@college.edu" }), 1);
  });

  test("missing, empty, whitespace-only, malformed and overlong roll numbers are rejected", async () => {
    const cases = [undefined, "", "   ", "A", "21 CS 045", "bad#roll", "x".repeat(31), 21045, null];
    for (const [i, rollNumber] of cases.entries()) {
      const res = await request(app).post(ENDPOINT).send(registration({ email: `badroll${i}@college.edu`, rollNumber }));
      assert.equal(res.status, 400, JSON.stringify(rollNumber));
      assert.ok(res.body.errors?.rollNumber, `expected a rollNumber error for ${JSON.stringify(rollNumber)}`);
    }
    assert.equal(await User.countDocuments({ email: /^badroll/ }), 0);
  });

  test("duplicate roll numbers are rejected, including case and spacing variations", async () => {
    // 21CS045 belongs to the first registered student; ST900 to an admin-created student.
    await admin.post("/api/admin/users").send({ name: "Admin Made", email: "admin.made@college.edu", password: PASSWORD, role: "student", rollNumber: "ST900" });
    for (const [i, rollNumber] of ["21CS045", "21cs045", "  21Cs045  ", "st900", " ST900 "].entries()) {
      const res = await request(app).post(ENDPOINT).send(registration({ name: "Roll Clash", email: `rollclash${i}@college.edu`, rollNumber }));
      assert.equal(res.status, 409, rollNumber);
      assert.equal(res.body.errors.rollNumber, "An account with this roll number already exists.");
      assertNoSecrets(res.body);
    }
    assert.equal(await User.countDocuments({ rollNumber: "21CS045" }), 1);
    assert.equal(await User.countDocuments({ email: /^rollclash/ }), 0);
  });

  test("concurrent registrations with the same roll number create exactly one account", async () => {
    const results = await Promise.all(
      ["RACE77", "race77", " Race77 "].map((rollNumber, i) =>
        request(app).post(ENDPOINT).send(registration({ name: `Roll Race ${i}`, email: `rollrace${i}@college.edu`, rollNumber }))
      )
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      assert.equal(res.body.errors.rollNumber, "An account with this roll number already exists.");
    }
    assert.equal(await User.countDocuments({ rollNumber: "RACE77" }), 1);
  });

  test("role, faculty/admin escalation and other unexpected fields are rejected", async () => {
    const adminsBefore = await User.countDocuments({ role: "admin" });
    const extras = [{ role: "admin" }, { role: "faculty" }, { role: "student" }, { isActive: false }, { tokenVersion: 3 }, { year: 2 }, { department: "CSE" }];
    for (const [i, extra] of extras.entries()) {
      const res = await request(app).post(ENDPOINT).send(registration({ email: `escalate${i}@college.edu`, ...extra }));
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal(await User.countDocuments({ email: /^escalate/ }), 0);
    assert.equal(await User.countDocuments({ role: "admin" }), adminsBefore);
    assert.equal(await User.countDocuments({ role: "faculty", email: /^escalate/ }), 0);
  });

  test("registration does not mark attendance; voting still requires being marked present", async () => {
    const res = await request(app).post(ENDPOINT).send(registration({ name: "Voting Student", email: "voter@college.edu" }));
    const voterId = res.body.user._id;
    assert.equal(await Attendance.countDocuments({ student: voterId }), 0);

    await Settings.getGlobal();
    await Settings.updateOne({ key: "global" }, { votingOpen: true, activeSession: SESSION });
    const list = await admin.get(`/api/admin/attendance?session=${SESSION}&search=voter@college.edu`);
    assert.equal(list.body.students[0].status, "unmarked");

    const presenter = await admin.post("/api/admin/users").send({ name: "Presenter", email: "presenter@college.edu", password: PASSWORD, role: "student", rollNumber: "PR001" });
    const project = await Project.create({
      projectNumber: "SR-1",
      title: "Registration Project",
      description: "A project used to check that self-registered students still need attendance.",
      teamMembers: [{ name: "Presenter", rollNumber: "PR001" }],
      facultyGuide: "Dr. Guide",
      submittedBy: presenter.body.user._id,
      status: "approved",
    });

    const { agent: voter } = await login("voter@college.edu");
    const rate = () => voter.put(`/api/projects/${project._id}/rating`).send({ score: 5, feedback: FEEDBACK });
    const blocked = await rate();
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.message, /present/);

    await admin.put("/api/admin/attendance").send({ session: SESSION, records: [{ studentId: voterId, status: "present" }] });
    assert.equal((await rate()).status, 201);
  });

  test("a registered student whose roll number is on a project's team cannot rate it", async () => {
    await Settings.getGlobal();
    await Settings.updateOne({ key: "global" }, { votingOpen: true, activeSession: SESSION });
    const lead = await admin.post("/api/admin/users").send({ name: "Team Lead", email: "lead@college.edu", password: PASSWORD, role: "student", rollNumber: "TL001" });
    const project = await Project.create({
      projectNumber: "OWN-1",
      title: "Team Project",
      description: "A project whose team includes a self-registered student by roll number.",
      teamMembers: [
        { name: "Team Lead", rollNumber: "TL001" },
        { name: "Team Member", rollNumber: "own777" }, // stored uppercase by the model
      ],
      facultyGuide: "Dr. Guide",
      submittedBy: lead.body.user._id, // the member is NOT the submitter
      status: "approved",
    });

    const member = await request(app).post(ENDPOINT).send(registration({ name: "Team Member", email: "member@college.edu", rollNumber: " Own777 " }));
    assert.equal(member.status, 201);
    assert.equal(member.body.user.rollNumber, "OWN777");
    const outsider = await request(app).post(ENDPOINT).send(registration({ name: "Outsider", email: "outsider@college.edu", rollNumber: "OUT001" }));
    // Both are marked present, so attendance is not what blocks the team member.
    await admin.put("/api/admin/attendance").send({
      session: SESSION,
      records: [member.body.user._id, outsider.body.user._id].map((studentId) => ({ studentId, status: "present" })),
    });

    const { agent: memberAgent } = await login("member@college.edu");
    const detail = await memberAgent.get(`/api/projects/${project._id}`);
    assert.equal(detail.body.permissions.isOwn, true);
    assert.equal(detail.body.canRate.allowed, false);
    const blocked = await memberAgent.put(`/api/projects/${project._id}/rating`).send({ score: 5, feedback: FEEDBACK });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.message, /cannot rate a project you are presenting/);

    const { agent: outsiderAgent } = await login("outsider@college.edu");
    assert.equal((await outsiderAgent.put(`/api/projects/${project._id}/rating`).send({ score: 4, feedback: FEEDBACK })).status, 201);
  });

  test("self-registered students get no admin-only access", async () => {
    const { agent } = await login("asha.rao@college.edu");
    const project = await Project.findOne({ projectNumber: "SR-1" });
    const attempts = [
      agent.get("/api/admin/stats"),
      agent.get("/api/admin/users"),
      agent.get("/api/admin/reports/voting"),
      agent.get("/api/admin/reports/participation"),
      agent.get(`/api/admin/projects/${project._id}/ratings`),
      agent.get("/api/admin/attendance"),
      agent.get("/api/admin/audit-logs"),
      agent.patch("/api/admin/settings").send({ leaderboardVisible: true }),
      agent.post("/api/admin/users").send({ name: "Sneaky", email: "s@college.edu", password: PASSWORD, role: "student", rollNumber: "S001" }),
    ];
    for (const res of await Promise.all(attempts)) assert.equal(res.status, 403);
  });

  test("faculty self-registration and admin-created students still work", async () => {
    const faculty = request.agent(app);
    const res = await faculty.post("/api/auth/register/faculty").send({ name: "Dr. Kavya Rao", email: "kavya@college.edu", password: PASSWORD });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "faculty");
    assert.equal((await faculty.get("/api/auth/me")).body.user.role, "faculty");
    // The faculty endpoint does not accept the student-only confirmation field.
    const extra = await request(app).post("/api/auth/register/faculty").send({ name: "Dr. Two", email: "two@college.edu", password: PASSWORD, confirmPassword: PASSWORD });
    assert.equal(extra.status, 400);

    const created = await admin.post("/api/admin/users").send({ name: "Admin Made", email: "made@college.edu", password: PASSWORD, role: "student", rollNumber: "AM001" });
    assert.equal(created.status, 201);
    assert.equal((await login("made@college.edu")).res.status, 200);
  });

  test("login, student registration and faculty registration link to each other (static check)", async () => {
    const read = (path) => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
    const [loginPage, studentPage, facultyPage] = await Promise.all([read("pages/Login.jsx"), read("pages/StudentRegister.jsx"), read("pages/FacultyRegister.jsx")]);
    assert.match(loginPage, /to="\/register\/student"/);
    assert.match(loginPage, /to="\/register\/faculty"/);
    assert.match(studentPage, /to="\/login"/);
    assert.match(studentPage, /to="\/register\/faculty"/);
    assert.match(facultyPage, /to="\/register\/student"/);
    assert.equal((studentPage.match(/<Input\b/g) ?? []).length, 5, "full name, email, roll number, password, confirm password");
    assert.match(studentPage, /label="Roll number"[\s\S]*?value=\{form\.rollNumber\}[\s\S]*?\brequired\b/);
    assert.match(studentPage, /label="Confirm password"/);
    assert.ok(!/otp|verification code/i.test(studentPage), "no OTP or email verification");
  });
});
