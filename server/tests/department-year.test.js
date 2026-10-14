import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Test-only credentials for the in-memory database.
const PASSWORD = "Passw0rd!";
const YEAR_ERROR = "Select a year of study from Year 1 to Year 6";
const INVALID_YEARS = [0, 7, 2.5, "2.5", "abc", "", true, null];
const INVALID_DEPARTMENTS = ["", "   ", "x".repeat(101), 42, null];

let mongo;
let app;
let User;
let seq = 0;

const registration = (overrides = {}) => {
  seq += 1;
  return {
    name: "Reg Student",
    email: `reg${seq}@college.edu`,
    rollNumber: `REG${String(seq).padStart(3, "0")}`,
    department: "Computer Science",
    year: 2,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  };
};

const adminStudent = (overrides = {}) => {
  seq += 1;
  return {
    name: "Admin Student",
    email: `adm${seq}@college.edu`,
    password: PASSWORD,
    role: "student",
    rollNumber: `ADM${String(seq).padStart(3, "0")}`,
    department: "Mechanical Engineering",
    year: 4,
    ...overrides,
  };
};

const withoutKey = (obj, key) => {
  const { [key]: _omit, ...rest } = obj;
  return rest;
};

async function login(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  return { agent, res };
}

describe("department and year of study", () => {
  let admin;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    User = (await import("../src/models/Users.js")).default;
    await mongoose.connection.syncIndexes();
    await User.create({ name: "Admin", email: "admin@dy.edu", password: PASSWORD, role: "admin" });
    ({ agent: admin } = await login("admin@dy.edu"));
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  describe("student self-registration", () => {
    test("saves a trimmed department and a numeric year", async () => {
      const res = await request(app).post("/api/auth/register").send(registration({ email: "valid.reg@college.edu", department: "  Civil Engineering  ", year: "4" }));
      assert.equal(res.status, 201, res.body.message);
      assert.equal(res.body.user.department, "Civil Engineering");
      assert.equal(res.body.user.year, 4);
      const raw = await User.collection.findOne({ email: "valid.reg@college.edu" });
      assert.equal(raw.department, "Civil Engineering");
      assert.equal(raw.year, 4); // stored as a number, like admin-created students
      assert.equal(raw.role, "student");
    });

    test("accepts every year from 1 to 6 and a 100-character department", async () => {
      for (const year of [1, 2, 3, 4, 5, 6]) {
        assert.equal((await request(app).post("/api/auth/register").send(registration({ year }))).status, 201, `year ${year}`);
      }
      assert.equal((await request(app).post("/api/auth/register").send(registration({ department: "D".repeat(100) }))).status, 201);
    });

    test("rejects missing or invalid departments and years without creating an account", async () => {
      const before = await User.countDocuments();
      for (const body of [withoutKey(registration(), "department"), ...INVALID_DEPARTMENTS.map((department) => registration({ department }))]) {
        const res = await request(app).post("/api/auth/register").send(body);
        assert.equal(res.status, 400, JSON.stringify(body.department));
        assert.ok(res.body.errors.department, `no department error for ${JSON.stringify(body.department)}`);
      }
      for (const body of [withoutKey(registration(), "year"), ...INVALID_YEARS.map((year) => registration({ year }))]) {
        const res = await request(app).post("/api/auth/register").send(body);
        assert.equal(res.status, 400, JSON.stringify(body.year));
        assert.equal(res.body.errors.year, YEAR_ERROR);
      }
      assert.equal(await User.countDocuments(), before);
    });
  });

  describe("admin student accounts", () => {
    test("admins create students with a department and year", async () => {
      const res = await admin.post("/api/admin/users").send(adminStudent({ email: "adm.valid@college.edu", department: "  ECE  ", year: "1" }));
      assert.equal(res.status, 201, res.body.message);
      assert.equal(res.body.user.department, "ECE");
      assert.equal(res.body.user.year, 1);
    });

    test("admin-created students need a valid department and year", async () => {
      for (const body of [withoutKey(adminStudent(), "department"), ...INVALID_DEPARTMENTS.filter((d) => d !== null).map((department) => adminStudent({ department }))]) {
        const res = await admin.post("/api/admin/users").send(body);
        assert.equal(res.status, 400, JSON.stringify(body.department));
        assert.ok(res.body.errors.department, JSON.stringify(res.body));
      }
      for (const body of [withoutKey(adminStudent(), "year"), ...INVALID_YEARS.filter((y) => y !== null).map((year) => adminStudent({ year }))]) {
        const res = await admin.post("/api/admin/users").send(body);
        assert.equal(res.status, 400, JSON.stringify(body.year));
        assert.equal(res.body.errors.year, YEAR_ERROR);
      }
    });

    test("faculty accounts still do not need a department or year", async () => {
      const res = await admin.post("/api/admin/users").send({ name: "Dr. Faculty", email: "fac@college.edu", password: PASSWORD, role: "faculty" });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.year, undefined);
      const edit = await admin.patch(`/api/admin/users/${res.body.user._id}`).send({ department: "", year: "" });
      assert.equal(edit.status, 200, "faculty department stays optional");
    });

    test("admins update a student's department and year with the same rules", async () => {
      const created = await admin.post("/api/admin/users").send(adminStudent({ email: "adm.update@college.edu" }));
      const id = created.body.user._id;

      const ok = await admin.patch(`/api/admin/users/${id}`).send({ department: "  Physics  ", year: "6" });
      assert.equal(ok.status, 200, ok.body.message);
      assert.equal(ok.body.user.department, "Physics");
      assert.equal(ok.body.user.year, 6);

      for (const body of [{ year: 0 }, { year: 7 }, { year: "abc" }, { year: true }, { department: "x".repeat(101) }]) {
        assert.equal((await admin.patch(`/api/admin/users/${id}`).send(body)).status, 400, JSON.stringify(body));
      }
      // Clearing is not allowed for students.
      for (const body of [{ department: "" }, { department: "   " }, { year: "" }, { year: null }]) {
        const res = await admin.patch(`/api/admin/users/${id}`).send(body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.body.errors.department || res.body.errors.year);
      }
      const stored = await User.findById(id);
      assert.equal(stored.department, "Physics");
      assert.equal(stored.year, 6);
    });

    test("existing students without these fields still sign in and can be updated", async () => {
      // An account created before Department/Year were collected.
      const legacy = await User.create({ name: "Legacy Student", email: "legacy@college.edu", password: PASSWORD, role: "student", rollNumber: "LEG001" });
      assert.equal((await login("legacy@college.edu")).res.status, 200);
      assert.equal((await admin.get("/api/admin/attendance")).status, 200);

      // Edits that do not touch Department/Year keep working.
      assert.equal((await admin.patch(`/api/admin/users/${legacy._id}`).send({ name: "Legacy Student Renamed" })).status, 200);
      // Saving the profile form sends both fields, so the admin is asked to fill them in.
      const incomplete = await admin.patch(`/api/admin/users/${legacy._id}`).send({ name: "Legacy Student", department: "", year: "" });
      assert.equal(incomplete.status, 400);
      const completed = await admin.patch(`/api/admin/users/${legacy._id}`).send({ department: "Chemistry", year: 3 });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.user.year, 3);
      assert.equal((await admin.patch(`/api/admin/users/${legacy._id}`).send({ isActive: false })).status, 200);
    });
  });

  describe("faculty registration and login are unaffected", () => {
    test("faculty register with only name, email and password", async () => {
      const agent = request.agent(app);
      const res = await agent.post("/api/auth/register/faculty").send({ name: "Dr. Kavya Rao", email: "kavya@college.edu", password: PASSWORD });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, "faculty");
      assert.equal((await agent.get("/api/auth/me")).status, 200);
      const extra = await request(app).post("/api/auth/register/faculty").send({ name: "Dr. Two", email: "two@college.edu", password: PASSWORD, department: "CSE", year: 2 });
      assert.equal(extra.status, 400, "faculty registration fields are unchanged");
      assert.equal((await login("kavya@college.edu")).res.status, 200);
    });
  });

  describe("client and server use the same options", () => {
    test("year options and department limit match, and both forms use them (static check)", async () => {
      const server = await import("../src/utils/schemas.js");
      const client = await import("../../client/src/lib/academic.js");
      assert.deepEqual(client.YEAR_OPTIONS, server.YEAR_OPTIONS);
      assert.deepEqual(server.YEAR_OPTIONS, [1, 2, 3, 4, 5, 6]);
      assert.equal(client.DEPARTMENT_MAX, server.DEPARTMENT_MAX);
      assert.equal(client.DEPARTMENT_MAX, 100);
      assert.deepEqual(client.YEAR_OPTIONS.map(client.yearLabel), ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Year 6"]);

      const read = (path) => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");
      for (const page of ["pages/StudentRegister.jsx", "pages/admin/Accounts.jsx"]) {
        const source = await read(page);
        assert.match(source, /YEAR_OPTIONS\.map/, `${page} must use the shared year options`);
        assert.match(source, /label="Department"/);
        assert.match(source, /label="Year of study"/);
      }
    });
  });
});
