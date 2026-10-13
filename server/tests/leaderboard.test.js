import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

const PASSWORD = "Passw0rd!";
const FEEDBACK = "I understood the problem statement, the approach taken and the results shown.";
const SESSION = "2026-10-13";

let mongo;
let app;
let models;

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.body.message);
  return agent;
}

const board = async (agent, group) => {
  const res = await agent.get(`/api/leaderboard?group=${group}`);
  assert.equal(res.status, 200, res.body.message);
  return res.body.entries;
};

// [title, averageRating, voteCount] in leaderboard order.
const summary = (entries) => entries.map((e) => [e.project.title, e.averageRating, e.voteCount]);

describe("project leaderboards", () => {
  const users = {};
  const projects = {};
  let viewer;

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

    const make = (key, data) => User.create({ password: PASSWORD, ...data }).then((u) => (users[key] = u));
    await make("guide", { name: "Guide Person", email: "guide@test.edu", role: "faculty", employeeId: "FAC-G" });
    await make("f1", { name: "Faculty Voter One", email: "f1@test.edu", role: "faculty", employeeId: "FAC-1" });
    await make("f2", { name: "Faculty Voter Two", email: "f2@test.edu", role: "faculty", employeeId: "FAC-2" });
    await make("presenter", { name: "Presenter Person", email: "presenter@test.edu", role: "student", rollNumber: "P001" });
    await make("s1", { name: "Student Voter One", email: "s1@test.edu", role: "student", rollNumber: "S001" });
    await make("s2", { name: "Student Voter Two", email: "s2@test.edu", role: "student", rollNumber: "S002" });
    await make("s3", { name: "Student Voter Three", email: "s3@test.edu", role: "student", rollNumber: "S003" });

    await Settings.create({ key: "global", votingOpen: true, activeSession: SESSION });
    await Attendance.create(
      ["s1", "s2", "s3"].map((k) => ({ student: users[k]._id, session: SESSION, status: "present" }))
    );

    const titles = ["Alpha Analytics", "Beta Bridge", "Gamma Grid", "Delta Drone", "Eta Engine", "Zeta Zone", "Theta Tracker"];
    for (const [i, title] of titles.entries()) {
      projects[title.split(" ")[0]] = await Project.create({
        projectNumber: `T-${i + 1}`,
        title,
        abstract: "An abstract that is long enough to satisfy validation rules.",
        description: "A description that is comfortably long enough to satisfy the model validation rules.",
        technologies: ["Node.js"],
        teamMembers: [{ name: "Presenter Person", rollNumber: "P001" }],
        facultyGuide: "Guide Person",
        submittedBy: users.presenter._id,
        status: "approved",
      });
    }

    // Authoritative rating data (one document per voter per project).
    const ratings = {
      Alpha: { s1: 5, s2: 4 }, // student-only
      Beta: { f1: 3, f2: 4 }, // faculty-only
      Gamma: { s1: 5, s2: 5, s3: 2, f1: 1 }, // both groups; overall must not be the mean of the two averages
      // Delta: no ratings
      Eta: { s3: 4 },
      Zeta: { s1: 4 },
      Theta: { s1: 3, s2: 3, s3: 4, f2: 5 }, // student average is 10/3
    };
    await Rating.create(
      Object.entries(ratings).flatMap(([project, votes]) =>
        Object.entries(votes).map(([voter, score]) => ({
          project: projects[project]._id,
          voter: users[voter]._id,
          voterRole: users[voter].role,
          score,
          feedback: FEEDBACK,
        }))
      )
    );

    viewer = await signIn("presenter@test.edu");
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("rejects unknown leaderboard groups", async () => {
    assert.equal((await viewer.get("/api/leaderboard?group=voters")).status, 400);
  });

  test("student leaderboard uses student ratings only, ties ordered by name", async () => {
    const entries = await board(viewer, "student");
    assert.deepEqual(summary(entries), [
      ["Alpha Analytics", 4.5, 2],
      ["Eta Engine", 4, 1], // Eta, Gamma and Zeta all average exactly 4 → name order
      ["Gamma Grid", 4, 3],
      ["Zeta Zone", 4, 1],
      ["Theta Tracker", 3.33, 3], // 10/3, rounded only for display
    ]);
    assert.deepEqual(entries.map((e) => e.rank), [1, 2, 3, 4, 5]);
  });

  test("faculty leaderboard uses faculty ratings only", async () => {
    const entries = await board(viewer, "faculty");
    assert.deepEqual(summary(entries), [
      ["Theta Tracker", 5, 1],
      ["Beta Bridge", 3.5, 2],
      ["Gamma Grid", 1, 1],
    ]);
  });

  test("overall leaderboard averages every rating equally", async () => {
    const entries = await board(viewer, "overall");
    assert.deepEqual(summary(entries), [
      ["Alpha Analytics", 4.5, 2],
      ["Eta Engine", 4, 1],
      ["Zeta Zone", 4, 1],
      ["Theta Tracker", 3.75, 4], // (3+3+4+5)/4
      ["Beta Bridge", 3.5, 2],
      ["Gamma Grid", 3.25, 4], // (5+5+2+1)/4 — not (4+1)/2 = 2.5
    ]);
    const gamma = entries.find((e) => e.project.title === "Gamma Grid");
    assert.equal(gamma.studentVoteCount, 3);
    assert.equal(gamma.facultyVoteCount, 1);
  });

  test("projects without ratings in a category are excluded from that leaderboard", async () => {
    const titlesIn = async (group) => (await board(viewer, group)).map((e) => e.project.title);
    for (const group of ["student", "faculty", "overall"]) {
      assert.ok(!(await titlesIn(group)).includes("Delta Drone"), `Delta listed on ${group}`);
    }
    assert.ok(!(await titlesIn("student")).includes("Beta Bridge"));
    assert.ok(!(await titlesIn("faculty")).includes("Alpha Analytics"));
  });

  test("project detail and admin report expose N/A (null) for empty categories", async () => {
    const delta = await viewer.get(`/api/projects/${projects.Delta._id}`);
    assert.deepEqual(delta.body.stats, {
      student: { averageRating: null, voteCount: 0 },
      faculty: { averageRating: null, voteCount: 0 },
      overall: { averageRating: null, voteCount: 0 },
    });

    const beta = await viewer.get(`/api/projects/${projects.Beta._id}`);
    assert.deepEqual(beta.body.stats.student, { averageRating: null, voteCount: 0 });
    assert.deepEqual(beta.body.stats.overall, { averageRating: 3.5, voteCount: 2 });

    const admin = request.agent(app);
    await models.User.create({ name: "Admin", email: "admin@test.edu", password: PASSWORD, role: "admin" });
    await admin.post("/api/auth/login").send({ email: "admin@test.edu", password: PASSWORD });
    const report = await admin.get("/api/admin/reports/voting");
    const gamma = report.body.projects.find((p) => p.title === "Gamma Grid");
    assert.deepEqual(gamma.overall, { averageRating: 3.25, voteCount: 4 });
    assert.equal(gamma.totalVotes, 4);
  });

  test("leaderboard responses contain no voter identities", async () => {
    const voterKeys = ["f1", "f2", "s1", "s2", "s3"];
    for (const group of ["student", "faculty", "overall"]) {
      const res = await viewer.get(`/api/leaderboard?group=${group}`);
      const body = JSON.stringify(res.body);
      for (const key of voterKeys) {
        const voter = users[key];
        assert.ok(!body.includes(voter._id.toString()), `${group} leaks ${key} id`);
        assert.ok(!body.includes(voter.email), `${group} leaks ${key} email`);
        assert.ok(!body.includes(voter.name), `${group} leaks ${key} name`);
        assert.ok(!body.includes(voter.rollNumber ?? voter.employeeId), `${group} leaks ${key} roll/employee id`);
      }
      assert.ok(!/"(voter|voters|voterRole|feedback|email)"/.test(body), `${group} has voter fields`);
    }
  });

  test("rating updates replace the earlier value without adding a rating", async () => {
    const rate = async (key, project, score) => {
      const agent = await signIn(`${key}@test.edu`);
      const res = await agent.put(`/api/projects/${projects[project]._id}/rating`).send({ score, feedback: FEEDBACK });
      assert.equal(res.status, 200, res.body.message); // 200 = updated, not created
    };

    await rate("f1", "Gamma", 5); // faculty 1 → 5
    assert.deepEqual(summary(await board(viewer, "faculty")), [
      ["Gamma Grid", 5, 1], // ties with Theta at 5 → name order
      ["Theta Tracker", 5, 1],
      ["Beta Bridge", 3.5, 2],
    ]);

    await rate("s3", "Gamma", 5); // student 2 → 5 (s3 is marked present)
    const student = summary(await board(viewer, "student"));
    assert.deepEqual(student[0], ["Gamma Grid", 5, 3]);

    const overall = summary(await board(viewer, "overall"));
    assert.deepEqual(overall[0], ["Gamma Grid", 5, 4]); // (5+5+5+5)/4, still 4 ratings
    assert.equal(await models.Rating.countDocuments({ project: projects.Gamma._id }), 4);
  });

  test("hidden leaderboards stay admin-only for every group", async () => {
    await models.Settings.updateOne({ key: "global" }, { leaderboardVisible: false });
    for (const group of ["student", "faculty", "overall"]) {
      assert.equal((await viewer.get(`/api/leaderboard?group=${group}`)).status, 403);
    }
    await models.Settings.updateOne({ key: "global" }, { leaderboardVisible: true });
  });
});
