import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Test-only credentials for the in-memory database.
const PASSWORD = "Passw0rd!";
const ENDPOINT = "/api/auth/register/faculty";
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$.{53}$/;

let mongo;
let app;
let User;
let AuditLog;

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
  for (const key of ["password", "tokenVersion"]) assert.ok(!keys.has(key), `response exposes "${key}"`);
  assert.ok(!/\$2[aby]\$\d{2}\$/.test(JSON.stringify(body)), "response contains a bcrypt hash");
}

async function login(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  return { agent, res };
}

describe("faculty self-registration", () => {
  let admin;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    User = (await import("../src/models/Users.js")).default;
    AuditLog = (await import("../src/models/AuditLog.js")).default;
    await mongoose.connection.syncIndexes();
    await User.create({ name: "Admin", email: "admin@fr.edu", password: PASSWORD, role: "admin" });
    ({ agent: admin } = await login("admin@fr.edu"));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("a faculty member registers, is active immediately and is signed in", async () => {
    const agent = request.agent(app);
    const res = await agent.post(ENDPOINT).send({ name: "  Dr. Kavya Rao  ", email: "  Kavya.Rao@College.EDU ", password: PASSWORD });

    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.user.role, "faculty");
    assert.equal(res.body.user.isActive, true);
    assert.equal(res.body.user.name, "Dr. Kavya Rao");
    assert.equal(res.body.user.email, "kavya.rao@college.edu"); // normalized
    assertNoSecrets(res.body);
    assert.match(res.headers["set-cookie"].join(";"), /pe_session=.*HttpOnly/i);

    const me = await agent.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, "faculty");
    assertNoSecrets(me.body);

    const stored = await User.findOne({ email: "kavya.rao@college.edu" }).select("+password");
    assert.match(stored.password, BCRYPT_HASH);
    assert.notEqual(stored.password, PASSWORD);
    assert.ok(await AuditLog.exists({ action: "user.register_faculty", targetId: stored._id }), "activity log entry missing");
  });

  test("the new faculty member can log out and log in again", async () => {
    const { agent, res } = await login("kavya.rao@college.edu");
    assert.equal(res.status, 200);
    assert.equal((await agent.post("/api/auth/logout")).status, 200);
    assert.equal((await agent.get("/api/auth/me")).status, 401);

    const again = await agent.post("/api/auth/login").send({ email: "KAVYA.RAO@college.edu", password: PASSWORD });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.role, "faculty");
    assertNoSecrets(again.body);
    assert.equal((await agent.get("/api/auth/me")).status, 200);
  });

  test("duplicate emails are rejected, including case and spacing variations", async () => {
    await admin
      .post("/api/admin/users")
      .send({ name: "Existing Student", email: "taken.student@college.edu", password: PASSWORD, role: "student", rollNumber: "TK001", department: "CSE", year: 2 });
    for (const email of ["kavya.rao@college.edu", "KAVYA.RAO@COLLEGE.EDU", "  Kavya.Rao@college.edu  ", "Taken.Student@College.edu", "ADMIN@fr.edu"]) {
      const res = await request(app).post(ENDPOINT).send({ name: "Someone Else", email, password: PASSWORD });
      assert.equal(res.status, 409, email);
      assert.equal(res.body.errors.email, "An account with this email already exists.");
    }
    assert.equal(await User.countDocuments({ email: "kavya.rao@college.edu" }), 1);
    assert.equal((await User.findOne({ email: "admin@fr.edu" })).role, "admin");
  });

  test("invalid name, email and password are rejected with field errors", async () => {
    const valid = { name: "Dr. Valid Name", email: "valid@college.edu", password: PASSWORD };
    const cases = [
      [{ ...valid, name: "" }, "name"],
      [{ ...valid, name: "   " }, "name"],
      [{ ...valid, name: "A" }, "name"],
      [{ ...valid, name: "x".repeat(101) }, "name"],
      [{ email: valid.email, password: PASSWORD }, "name"],
      [{ ...valid, email: "not-an-email" }, "email"],
      [{ ...valid, email: "" }, "email"],
      [{ name: valid.name, password: PASSWORD }, "email"],
      [{ ...valid, password: "Sh0rt" }, "password"],
      [{ ...valid, password: "nodigitshere" }, "password"],
      [{ ...valid, password: "1234567890" }, "password"],
      [{ ...valid, password: `A1${"x".repeat(127)}` }, "password"],
      [{ name: valid.name, email: valid.email }, "password"],
    ];
    for (const [body, field] of cases) {
      const res = await request(app).post(ENDPOINT).send(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.ok(res.body.errors?.[field], `expected an error for ${field}`);
    }
    assert.equal(await User.exists({ email: "valid@college.edu" }), null);
  });

  test("role and other unauthorized fields are rejected; no admin can be created", async () => {
    const adminsBefore = await User.countDocuments({ role: "admin" });
    const extras = [
      { role: "admin" },
      { role: "student" },
      { role: "faculty" },
      { isActive: false },
      { tokenVersion: 7 },
      { rollNumber: "ESC001" },
      { employeeId: "FAC-X" },
    ];
    for (const [i, extra] of extras.entries()) {
      const res = await request(app).post(ENDPOINT).send({ name: "Escalation Attempt", email: `escalate${i}@college.edu`, password: PASSWORD, ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal(await User.countDocuments({ email: /^escalate/ }), 0);
    assert.equal(await User.countDocuments({ role: "admin" }), adminsBefore);
  });

  test("public student registration can never create a faculty or admin account", async () => {
    for (const role of ["faculty", "admin"]) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Public Student", email: "public.student@college.edu", rollNumber: "PB001", password: PASSWORD, confirmPassword: PASSWORD, role });
      assert.equal(res.status, 400);
      assert.equal(res.headers["set-cookie"], undefined);
    }
    assert.equal(await User.exists({ email: "public.student@college.edu" }), null);
  });

  test("admins still create student and faculty accounts, and everyone logs in", async () => {
    const student = await admin
      .post("/api/admin/users")
      .send({ name: "Admin Made Student", email: "made.student@college.edu", password: PASSWORD, role: "student", rollNumber: "MS001", department: "CSE", year: 2 });
    assert.equal(student.status, 201);
    const faculty = await admin
      .post("/api/admin/users")
      .send({ name: "Admin Made Faculty", email: "made.faculty@college.edu", password: PASSWORD, role: "faculty", employeeId: "FAC-77" });
    assert.equal(faculty.status, 201);

    for (const [email, role] of [
      ["made.student@college.edu", "student"],
      ["made.faculty@college.edu", "faculty"],
      ["admin@fr.edu", "admin"],
    ]) {
      const { res } = await login(email);
      assert.equal(res.status, 200, email);
      assert.equal(res.body.user.role, role);
    }
  });

  test("self-registered faculty cannot use admin-only endpoints", async () => {
    const { agent } = await login("kavya.rao@college.edu");
    const attempts = [
      agent.get("/api/admin/stats"),
      agent.get("/api/admin/users"),
      agent.post("/api/admin/users").send({ name: "X Y", email: "x@college.edu", password: PASSWORD, role: "student", rollNumber: "XY001" }),
      agent.patch("/api/admin/settings").send({ votingOpen: true }),
      agent.get("/api/admin/attendance"),
      agent.get("/api/admin/reports/voting/export"),
      agent.get("/api/admin/audit-logs"),
    ];
    for (const res of await Promise.all(attempts)) assert.equal(res.status, 403);
    assert.equal(await User.exists({ email: "x@college.edu" }), null);
  });

  test("the faculty endpoint uses the registration rate limiter and fixed role (static check)", async () => {
    // Rate limiters are skipped under NODE_ENV=test, so confirm the wiring in the route source.
    const source = await readFile(new URL("../src/routes/auth.js", import.meta.url), "utf8");
    assert.match(source, /router\.post\("\/register\/faculty", registerLimiter, validateBody\(facultyRegisterSchema\)/);
    // The faculty route passes no extra profile fields, so faculty accounts never get a roll number.
    assert.match(source, /createSelfRegisteredUser\(req, req\.body, "faculty"\);/);
    assert.match(source, /User\.create\(\{ name, email, password, role, isActive: true, \.\.\.profile \}\)/);
  });

  test("the faculty page has exactly three fields and the login page links to it (static check)", async () => {
    const page = await readFile(new URL("../../client/src/pages/FacultyRegister.jsx", import.meta.url), "utf8");
    const inputs = page.match(/<Input\b/g) ?? [];
    assert.equal(inputs.length, 3);
    assert.ok(!/confirm/i.test(page), "the faculty form must not have a confirm-password field");
    const loginPage = await readFile(new URL("../../client/src/pages/Login.jsx", import.meta.url), "utf8");
    assert.match(loginPage, /to="\/register\/faculty"[^>]*>\s*Register as Faculty/);
    const appRoutes = await readFile(new URL("../../client/src/App.jsx", import.meta.url), "utf8");
    assert.match(appRoutes, /<Route path="register\/faculty" element=\{<FacultyRegister \/>\} \/>/);
  });
});
