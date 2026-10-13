import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Test-only credentials for the in-memory database; not real secrets.
const ADMIN = { ADMIN_NAME: "Test Super Admin", ADMIN_EMAIL: "superadmin@test.edu", ADMIN_PASSWORD: "SeedPassw0rd" };
const PASSWORD = "Passw0rd!";
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$.{53}$/;

let mongo;
let app;
let User;
let seed;

/** Recursively collects every key in a JSON value. */
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

function assertNoSecrets(body, label) {
  const keys = allKeys(body);
  for (const forbidden of ["password", "tokenVersion"]) {
    assert.ok(!keys.has(forbidden), `${label} exposes "${forbidden}"`);
  }
  assert.ok(!/\$2[aby]\$\d{2}\$/.test(JSON.stringify(body)), `${label} contains a bcrypt hash`);
}

async function signIn(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200, res.body.message);
  assertNoSecrets(res.body, "login response");
  return agent;
}

const storedHash = async (email) => (await User.findOne({ email }).select("+password")).password;

describe("Super Admin seeding", () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    User = (await import("../src/models/Users.js")).default;
    seed = await import("../src/services/adminSeed.js");
    await mongoose.connection.syncIndexes();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("requires ADMIN_EMAIL and ADMIN_PASSWORD, with no defaults", () => {
    const cases = [
      [{}, /ADMIN_EMAIL and ADMIN_PASSWORD/],
      [{ ADMIN_EMAIL: ADMIN.ADMIN_EMAIL }, /Missing ADMIN_PASSWORD/],
      [{ ADMIN_PASSWORD: ADMIN.ADMIN_PASSWORD }, /Missing ADMIN_EMAIL/],
      [{ ADMIN_EMAIL: "   ", ADMIN_PASSWORD: "   " }, /ADMIN_EMAIL and ADMIN_PASSWORD/],
    ];
    for (const [source, message] of cases) {
      assert.throws(() => seed.readAdminSeedConfig(source), (err) => err instanceof seed.AdminSeedError && message.test(err.message));
    }
  });

  test("rejects invalid, weak and example credentials without echoing the password", () => {
    const bad = [
      { ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: ADMIN.ADMIN_PASSWORD },
      { ADMIN_EMAIL: ADMIN.ADMIN_EMAIL, ADMIN_PASSWORD: "short1" },
      { ADMIN_EMAIL: ADMIN.ADMIN_EMAIL, ADMIN_PASSWORD: "nodigitsatall" },
      { ADMIN_EMAIL: "admin@your-college.edu", ADMIN_PASSWORD: ADMIN.ADMIN_PASSWORD },
      { ADMIN_EMAIL: ADMIN.ADMIN_EMAIL, ADMIN_PASSWORD: "change-me-to-a-strong-unique-password" },
    ];
    for (const source of bad) {
      assert.throws(
        () => seed.readAdminSeedConfig(source),
        (err) => err instanceof seed.AdminSeedError && !err.message.includes(source.ADMIN_PASSWORD)
      );
    }
  });

  test("creates the Super Admin with a hashed password", async () => {
    const config = seed.readAdminSeedConfig(ADMIN);
    assert.equal(await seed.seedSuperAdmin(config), "created");

    const admin = await User.findOne({ email: ADMIN.ADMIN_EMAIL }).select("+password");
    assert.equal(admin.role, "admin");
    assert.equal(admin.isActive, true);
    assert.notEqual(admin.password, ADMIN.ADMIN_PASSWORD);
    assert.match(admin.password, BCRYPT_HASH);
    assert.ok(await admin.comparePassword(ADMIN.ADMIN_PASSWORD));
  });

  test("re-running neither duplicates the admin nor changes its password", async () => {
    const before = await storedHash(ADMIN.ADMIN_EMAIL);
    const config = seed.readAdminSeedConfig({ ...ADMIN, ADMIN_PASSWORD: "DifferentPassw0rd" });
    assert.equal(await seed.seedSuperAdmin(config), "exists");
    assert.equal(await seed.seedSuperAdmin(config), "exists");

    assert.equal(await User.countDocuments({ email: ADMIN.ADMIN_EMAIL }), 1);
    assert.equal(await User.countDocuments({ role: "admin" }), 1);
    assert.equal(await storedHash(ADMIN.ADMIN_EMAIL), before);
    await signIn(ADMIN.ADMIN_EMAIL, ADMIN.ADMIN_PASSWORD); // original password still works
  });

  test("a different ADMIN_EMAIL does not silently create a second admin", async () => {
    const config = seed.readAdminSeedConfig({ ...ADMIN, ADMIN_EMAIL: "other-admin@test.edu" });
    await assert.rejects(seed.seedSuperAdmin(config), seed.AdminSeedError);
    assert.equal(await User.countDocuments({ role: "admin" }), 1);
  });

  test("never promotes an existing student or faculty account", async () => {
    await User.create({ name: "Existing Student", email: "existing@test.edu", password: PASSWORD, role: "student", rollNumber: "EX001" });
    const config = seed.readAdminSeedConfig({ ...ADMIN, ADMIN_EMAIL: "existing@test.edu" });
    await assert.rejects(seed.seedSuperAdmin(config, { allowAdditional: true }), /already belongs to a student/);
    assert.equal((await User.findOne({ email: "existing@test.edu" })).role, "student");
  });

  test("password changes only with an explicit reset", async () => {
    const config = seed.readAdminSeedConfig({ ...ADMIN, ADMIN_PASSWORD: "ResetPassw0rd" });
    assert.equal(await seed.seedSuperAdmin(config, { resetPassword: true }), "password_reset");
    assert.equal(await User.countDocuments({ role: "admin" }), 1);
    await signIn(ADMIN.ADMIN_EMAIL, "ResetPassw0rd");
    const old = await request(app).post("/api/auth/login").send({ email: ADMIN.ADMIN_EMAIL, password: ADMIN.ADMIN_PASSWORD });
    assert.equal(old.status, 401);
  });

  describe("account management", () => {
    let admin;
    let student;
    let faculty;

    before(async () => {
      admin = await signIn(ADMIN.ADMIN_EMAIL, "ResetPassw0rd");
      const created = await admin
        .post("/api/admin/users")
        .send({ name: "Admin Made Student One", email: "self@test.edu", password: PASSWORD, role: "student", rollNumber: "SR001" });
      assert.equal(created.status, 201);
      assertNoSecrets(created.body, "create student response");
      student = await signIn("self@test.edu");
      await User.create({ name: "Faculty Member", email: "fac@test.edu", password: PASSWORD, role: "faculty" });
      faculty = await signIn("fac@test.edu");
    });

    test("public registration is disabled for every role", async () => {
      for (const role of ["student", "faculty", "admin"]) {
        const res = await request(app)
          .post("/api/auth/register")
          .send({ name: "Escalator", email: `${role}-escalate@test.edu`, password: PASSWORD, rollNumber: `ESC-${role}`, role });
        assert.equal(res.status, 403, `role=${role} was accepted`);
      }
      assert.equal(await User.countDocuments({ email: /escalate/ }), 0);
      assert.equal(await User.countDocuments({ role: "admin" }), 1);
    });

    test("unauthorized users cannot create accounts through admin endpoints", async () => {
      const payload = { name: "New Faculty", email: "blocked@test.edu", password: PASSWORD, role: "faculty" };
      assert.equal((await request(app).post("/api/admin/users").send(payload)).status, 401);
      assert.equal((await student.post("/api/admin/users").send(payload)).status, 403);
      assert.equal((await faculty.post("/api/admin/users").send(payload)).status, 403);
      assert.equal(
        (await student.post("/api/admin/users").send({ ...payload, role: "student", rollNumber: "BL001" })).status,
        403
      );
      assert.equal(await User.countDocuments({ email: "blocked@test.edu" }), 0);
    });

    test("admins create student and faculty accounts with hashed passwords", async () => {
      const studentRes = await admin.post("/api/admin/users").send({
        name: "Admin Made Student",
        email: "made-student@test.edu",
        password: PASSWORD,
        role: "student",
        rollNumber: "AM001",
        year: 2,
      });
      assert.equal(studentRes.status, 201, studentRes.body.message);
      assert.equal(studentRes.body.user.role, "student");
      assertNoSecrets(studentRes.body, "create student response");

      const facultyRes = await admin.post("/api/admin/users").send({
        name: "Admin Made Faculty",
        email: "made-faculty@test.edu",
        password: PASSWORD,
        role: "faculty",
        employeeId: "FAC-AM",
        department: "CSE",
      });
      assert.equal(facultyRes.status, 201, facultyRes.body.message);
      assert.equal(facultyRes.body.user.role, "faculty");
      assertNoSecrets(facultyRes.body, "create faculty response");

      for (const email of ["made-student@test.edu", "made-faculty@test.edu"]) {
        assert.match(await storedHash(email), BCRYPT_HASH);
      }
      await signIn("made-faculty@test.edu"); // the new faculty account can sign in
    });

    test("admins cannot create or grant the admin role", async () => {
      const create = await admin
        .post("/api/admin/users")
        .send({ name: "Second Admin", email: "second-admin@test.edu", password: PASSWORD, role: "admin" });
      assert.equal(create.status, 400);

      const target = await User.findOne({ email: "made-faculty@test.edu" });
      const promote = await admin.patch(`/api/admin/users/${target._id}`).send({ role: "admin" });
      assert.equal(promote.status, 400);
      assert.equal(await User.countDocuments({ role: "admin" }), 1);
    });

    test("invalid input returns clear field messages", async () => {
      const duplicate = await admin
        .post("/api/admin/users")
        .send({ name: "Duplicate", email: "MADE-FACULTY@test.edu", password: PASSWORD, role: "faculty" });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.errors.email, "An account with this email already exists.");

      const invalid = await admin
        .post("/api/admin/users")
        .send({ name: "X", email: "nope", password: "weak", role: "student" });
      assert.equal(invalid.status, 400);
      for (const field of ["name", "email", "password", "rollNumber"]) {
        assert.ok(invalid.body.errors[field], `missing error for ${field}`);
      }
    });

    test("account listings and session responses never expose password hashes", async () => {
      const list = await admin.get("/api/admin/users?limit=100");
      assert.equal(list.status, 200);
      assert.ok(list.body.users.some((u) => u.role === "admin"));
      assertNoSecrets(list.body, "user list");

      const target = await User.findOne({ email: "made-student@test.edu" });
      assertNoSecrets((await admin.get(`/api/admin/users/${target._id}`)).body, "user detail");
      assertNoSecrets((await admin.get("/api/auth/me")).body, "/auth/me");
    });

    test("the three project leaderboards still respond", async () => {
      for (const group of ["student", "faculty", "overall"]) {
        const res = await student.get(`/api/leaderboard?group=${group}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { group, entries: [] });
      }
    });
  });
});
