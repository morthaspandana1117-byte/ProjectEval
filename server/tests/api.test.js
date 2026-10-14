import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

let mongo;
let app;
let User;

const PASSWORD = "Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function signIn(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200, res.body.message);
  return agent;
}

const projectPayload = (overrides = {}) => ({
  projectNumber: "CSE-001",
  title: "Smart Attendance System",
  description:
    "The system captures classroom images, detects faces and matches them against enrolled students to record attendance automatically.",
  teamMembers: [
    { name: "Asha Rao", rollNumber: "21CS001" },
    { name: "Vikram N", rollNumber: "21CS002" },
  ],
  ...overrides,
});

const feedback = "The project detects faces from classroom photos and marks attendance automatically.";

describe("ProjectEval API", () => {
  let admin, presenter, voter, outsider, faculty, facultyId, projectId, voterId;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    ({ createApp: app } = await import("../src/app.js"));
    app = app();
    ({ User } = await import("../src/models/Users.js"));
    await mongoose.connection.syncIndexes();

    await User.create({ name: "Admin", email: "admin@college.edu", password: PASSWORD, role: "admin" });
    admin = await signIn("admin@college.edu");
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  describe("authentication and roles", () => {
    test("public registration cannot assign a privileged role", async () => {
      for (const role of ["admin", "faculty"]) {
        const res = await request(app).post("/api/auth/register").send({
          name: "Mallory",
          email: "mallory@college.edu",
          password: PASSWORD,
          confirmPassword: PASSWORD,
          rollNumber: "21CS999",
          role,
        });
        assert.equal(res.status, 400);
        assert.equal(res.headers["set-cookie"], undefined);
      }
      assert.equal(await User.countDocuments({ email: "mallory@college.edu" }), 0);
    });

    test("admins create student accounts that can sign in", async () => {
      for (const [name, email, rollNumber] of [
        ["Asha Rao", "asha@college.edu", "21CS001"],
        ["Ravi Kumar", "ravi@college.edu", "21CS050"],
        ["Neha Singh", "neha@college.edu", "21CS051"],
      ]) {
        const res = await admin.post("/api/admin/users").send({ name, email, password: PASSWORD, role: "student", rollNumber });
        assert.equal(res.status, 201);
        assert.equal(res.body.user.role, "student");
        assert.equal(res.body.user.password, undefined);
      }
      const login = await request(app).post("/api/auth/login").send({ email: "asha@college.edu", password: PASSWORD });
      assert.match(login.headers["set-cookie"].join(";"), /pe_session=.*HttpOnly/i);
      presenter = await signIn("asha@college.edu");
      voter = await signIn("ravi@college.edu");
      outsider = await signIn("neha@college.edu");
      voterId = (await User.findOne({ email: "ravi@college.edu" }))._id.toString();
    });

    test("duplicate email and roll number are rejected", async () => {
      const res = await admin.post("/api/admin/users").send({
        name: "Asha Again",
        email: "ASHA@college.edu",
        password: PASSWORD,
        role: "student",
        rollNumber: "21CS777",
      });
      assert.equal(res.status, 409);
      const res2 = await admin.post("/api/admin/users").send({
        name: "Roll Clash",
        email: "clash@college.edu",
        password: PASSWORD,
        role: "student",
        rollNumber: "21cs001",
      });
      assert.equal(res2.status, 409);
    });

    test("weak passwords and wrong credentials are rejected", async () => {
      const weak = await admin
        .post("/api/admin/users")
        .send({ name: "Weak", email: "weak@college.edu", password: "short", role: "student", rollNumber: "21CS800" });
      assert.equal(weak.status, 400);
      assert.ok(weak.body.errors.password);
      const wrong = await request(app).post("/api/auth/login").send({ email: "ravi@college.edu", password: "nope12345" });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.message, "Invalid email or password.");
    });

    test("admin routes require an authenticated admin", async () => {
      assert.equal((await request(app).get("/api/admin/stats")).status, 401);
      assert.equal((await voter.get("/api/admin/stats")).status, 403);
      assert.equal((await voter.get("/api/admin/users")).status, 403);
      assert.equal((await admin.get("/api/admin/stats")).status, 200);
    });

    test("admin creates faculty but cannot create admins", async () => {
      const bad = await admin.post("/api/admin/users").send({
        name: "Fake Admin",
        email: "fake@college.edu",
        password: PASSWORD,
        role: "admin",
      });
      assert.equal(bad.status, 400);

      const res = await admin.post("/api/admin/users").send({
        name: "Dr. Meera Iyer",
        email: "meera@college.edu",
        password: PASSWORD,
        role: "faculty",
        employeeId: "FAC-01",
        department: "CSE",
      });
      assert.equal(res.status, 201);
      facultyId = res.body.user._id;
      faculty = await signIn("meera@college.edu");
    });

    test("admin accounts cannot be modified through the API", async () => {
      const adminUser = await User.findOne({ role: "admin" });
      const res = await admin.patch(`/api/admin/users/${adminUser._id}`).send({ isActive: false });
      assert.equal(res.status, 403);
    });
  });

  describe("projects", () => {
    test("presenters submit projects with a unique project number", async () => {
      const res = await presenter.post("/api/projects").send(projectPayload({ facultyGuide: "Dr. Meera Iyer" }));
      assert.equal(res.status, 201);
      assert.equal(res.body.project.status, "pending");
      projectId = res.body.project._id;

      const dup = await outsider
        .post("/api/projects")
        .send(projectPayload({ facultyGuide: "Dr. Meera Iyer", projectNumber: "cse-001" }));
      assert.equal(dup.status, 409);
    });

    test("the faculty guide name is required", async () => {
      const res = await outsider
        .post("/api/projects")
        .send(projectPayload({ facultyGuide: "   ", projectNumber: "CSE-099" }));
      assert.equal(res.status, 400);
      assert.ok(res.body.errors.facultyGuide);
    });

    test("faculty cannot submit projects", async () => {
      const res = await faculty.post("/api/projects").send(projectPayload({ facultyGuide: "Dr. Meera Iyer", projectNumber: "F-1" }));
      assert.equal(res.status, 403);
    });

    test("unapproved projects are hidden from other users", async () => {
      assert.equal((await voter.get(`/api/projects/${projectId}`)).status, 404);
      assert.equal((await presenter.get(`/api/projects/${projectId}`)).status, 200);
      const list = await voter.get("/api/projects");
      assert.equal(list.body.projects.length, 0);
    });

    test("uploads are type-checked by content and downloadable", async () => {
      const ok = await presenter.post(`/api/projects/${projectId}/files`).attach("files", PDF, "report.pdf");
      assert.equal(ok.status, 201, ok.body.message);
      assert.equal(ok.body.files[0].contentType, "application/pdf");

      const spoofed = await presenter
        .post(`/api/projects/${projectId}/files`)
        .attach("files", Buffer.from("MZ not really a pdf"), "evil.pdf");
      assert.equal(spoofed.status, 400);

      const exe = await presenter.post(`/api/projects/${projectId}/files`).attach("files", Buffer.from("MZ"), "run.exe");
      assert.equal(exe.status, 400);

      const notOwner = await voter.post(`/api/projects/${projectId}/files`).attach("files", PDF, "x.pdf");
      assert.equal(notOwner.status, 404);

      const download = await presenter
        .get(`/api/projects/${projectId}/files/${ok.body.files[0]._id}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      assert.equal(download.status, 200);
      assert.match(download.headers["content-disposition"], /attachment/);
      assert.ok(download.body.equals(PDF));
    });

    test("admin approves projects", async () => {
      const res = await admin.patch(`/api/admin/projects/${projectId}/status`).send({ status: "approved" });
      assert.equal(res.status, 200);
      assert.equal((await voter.get(`/api/projects/${projectId}`)).status, 200);
    });

    test("presenters cannot edit approved projects", async () => {
      const res = await presenter.patch(`/api/projects/${projectId}`).send({ title: "Changed title here" });
      assert.equal(res.status, 403);
    });
  });

  describe("voting", () => {
    const rate = (agent, body = { score: 4, feedback }) => agent.put(`/api/projects/${projectId}/rating`).send(body);

    test("nobody can vote while voting is closed", async () => {
      assert.equal((await rate(faculty)).status, 403);
      const res = await admin.patch("/api/admin/settings").send({ votingOpen: true, activeSession: "2026-10-12" });
      assert.equal(res.status, 200);
    });

    test("students must be marked present before voting", async () => {
      const res = await rate(voter);
      assert.equal(res.status, 403);
      assert.match(res.body.message, /present/);

      const absent = await admin
        .put("/api/admin/attendance")
        .send({ session: "2026-10-12", records: [{ studentId: voterId, status: "absent" }] });
      assert.equal(absent.status, 200);
      assert.equal((await rate(voter)).status, 403);

      const present = await admin
        .put("/api/admin/attendance")
        .send({ session: "2026-10-12", records: [{ studentId: voterId, status: "present" }] });
      assert.equal(present.status, 200);
    });

    test("attendance cannot be marked for non-students", async () => {
      const res = await admin
        .put("/api/admin/attendance")
        .send({ session: "2026-10-12", records: [{ studentId: facultyId, status: "present" }] });
      assert.equal(res.status, 400);
    });

    test("ratings require a 1-5 score and meaningful feedback", async () => {
      assert.equal((await rate(voter, { score: 6, feedback })).status, 400);
      assert.equal((await rate(voter, { score: 3, feedback: "nice" })).status, 400);
      assert.equal((await rate(voter, { score: 3.5, feedback })).status, 400);
    });

    test("one rating per voter per project, updates allowed", async () => {
      const first = await rate(voter, { score: 5, feedback });
      assert.equal(first.status, 201);
      const second = await rate(voter, { score: 3, feedback });
      assert.equal(second.status, 200);
      const { default: Rating } = await import("../src/models/Rating.js");
      assert.equal(await Rating.countDocuments({ project: projectId }), 1);
    });

    test("presenters cannot rate their own project", async () => {
      await admin.put("/api/admin/attendance").send({
        session: "2026-10-12",
        records: [{ studentId: (await User.findOne({ email: "asha@college.edu" }))._id.toString(), status: "present" }],
      });
      const res = await rate(presenter);
      assert.equal(res.status, 403);
    });

    test("faculty vote without attendance", async () => {
      assert.equal((await rate(faculty, { score: 5, feedback })).status, 201);
    });

    test("admins cannot vote", async () => {
      assert.equal((await rate(admin)).status, 403);
    });

    test("leaderboards are computed per voter group", async () => {
      const students = await voter.get("/api/leaderboard?group=student");
      assert.equal(students.status, 200);
      assert.equal(students.body.entries[0].averageRating, 3);
      assert.equal(students.body.entries[0].voteCount, 1);
      assert.equal(students.body.entries[0].rank, 1);

      const facultyBoard = await voter.get("/api/leaderboard?group=faculty");
      assert.equal(facultyBoard.body.entries[0].averageRating, 5);
      assert.equal(facultyBoard.body.entries[0].voteCount, 1);
    });

    test("hidden leaderboards are visible to admins only", async () => {
      await admin.patch("/api/admin/settings").send({ leaderboardVisible: false });
      assert.equal((await voter.get("/api/leaderboard")).status, 403);
      assert.equal((await admin.get("/api/leaderboard")).status, 200);
      const detail = await voter.get(`/api/projects/${projectId}`);
      assert.equal(detail.body.stats, null);
      await admin.patch("/api/admin/settings").send({ leaderboardVisible: true });
    });

    test("voter identities are protected from ordinary users", async () => {
      assert.equal((await voter.get(`/api/admin/projects/${projectId}/ratings`)).status, 403);
      assert.equal((await outsider.get(`/api/projects/${projectId}/feedback`)).status, 403);

      const ownerView = await presenter.get(`/api/projects/${projectId}/feedback`);
      assert.equal(ownerView.status, 200);
      assert.equal(ownerView.body.feedback.length, 2);
      assert.ok(ownerView.body.feedback.every((f) => f.voter === undefined && f._id === undefined));

      const adminView = await admin.get(`/api/admin/projects/${projectId}/ratings`);
      assert.equal(adminView.status, 200);
      assert.ok(adminView.body.ratings.every((r) => r.voter?.name));
    });

    test("admin sees participation statistics", async () => {
      const res = await admin.get("/api/admin/stats");
      assert.equal(res.body.attendance.present, 2);
      assert.equal(res.body.participation.studentVoters, 1);
      assert.equal(res.body.participation.facultyVoters, 1);
      assert.equal(res.body.ratings.total, 2);

      const notVoted = await admin.get("/api/admin/reports/participation?role=student&filter=not-voted");
      assert.equal(notVoted.body.users.length, 2);
    });
  });

  describe("exports", () => {
    const binary = (req) =>
      req.buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    test("attendance exports to Excel", async () => {
      for (const session of ["2026-10-12", "all"]) {
        const res = await binary(admin.get(`/api/admin/attendance/export?session=${session}`));
        assert.equal(res.status, 200);
        assert.match(res.headers["content-type"], /spreadsheetml/);
        assert.equal(res.body.subarray(0, 2).toString(), "PK");
      }
      assert.equal((await voter.get("/api/admin/attendance/export")).status, 403);
    });

    test("voting report exports to Excel", async () => {
      const res = await binary(admin.get("/api/admin/reports/voting/export"));
      assert.equal(res.status, 200);
      assert.equal(res.body.subarray(0, 2).toString(), "PK");
    });
  });

  describe("session revocation", () => {
    test("changing a password signs out other sessions", async () => {
      const otherDevice = await signIn("neha@college.edu");
      const res = await outsider
        .patch("/api/auth/password")
        .send({ currentPassword: PASSWORD, newPassword: "NewPassw0rd" });
      assert.equal(res.status, 200);
      assert.equal((await otherDevice.get("/api/auth/me")).status, 401);
      assert.equal((await outsider.get("/api/auth/me")).status, 200);
    });

    test("deactivated users lose access", async () => {
      const res = await admin.patch(`/api/admin/users/${voterId}`).send({ isActive: false });
      assert.equal(res.status, 200);
      assert.equal((await voter.get("/api/auth/me")).status, 401);
      const login = await request(app).post("/api/auth/login").send({ email: "ravi@college.edu", password: PASSWORD });
      assert.equal(login.status, 403);
    });
  });
});
