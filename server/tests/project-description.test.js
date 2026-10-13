import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

const PASSWORD = "Passw0rd!";
let mongo;
let app;
let Project;
let User;

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.body.message);
  return agent;
}

let counter = 0;
const payload = (overrides = {}) => {
  counter += 1;
  return {
    projectNumber: `DESC-${counter}`,
    title: `Description Project ${counter}`,
    description: "A smart irrigation controller that waters plants based on soil moisture readings.",
    teamMembers: [{ name: "Presenter", rollNumber: "DS001" }],
    facultyGuide: "Dr. Kavya Rao",
    ...overrides,
  };
};

describe("single project description", () => {
  let presenter;
  let viewer;
  let admin;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    Project = (await import("../src/models/Project.js")).default;
    User = (await import("../src/models/Users.js")).default;
    await mongoose.connection.syncIndexes();
    await User.create({ name: "Presenter", email: "p@desc.edu", password: PASSWORD, role: "student", rollNumber: "DS001" });
    await User.create({ name: "Viewer", email: "v@desc.edu", password: PASSWORD, role: "student", rollNumber: "DS002" });
    await User.create({ name: "Admin", email: "a@desc.edu", password: PASSWORD, role: "admin" });
    presenter = await signIn("p@desc.edu");
    viewer = await signIn("v@desc.edu");
    admin = await signIn("a@desc.edu");
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("a project is submitted with only a trimmed description", async () => {
    const res = await presenter
      .post("/api/projects")
      .send(payload({ description: "   Tracks bus arrivals in real time for students.   " }));
    assert.equal(res.status, 201, res.body.message);
    assert.ok(res.body.project._id, "the client navigates to /projects/:id after submitting");
    assert.equal(res.body.project.description, "Tracks bus arrivals in real time for students.");
    assert.equal(res.body.project.abstract, undefined);
    assert.equal(res.body.project.technologies, undefined);

    const raw = await Project.collection.findOne({ _id: new mongoose.Types.ObjectId(res.body.project._id) });
    assert.ok(!("abstract" in raw) && !("technologies" in raw), "new records do not store the removed fields");

    const detail = await presenter.get(`/api/projects/${res.body.project._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.project.description, "Tracks bus arrivals in real time for students.");
  });

  test("missing, blank, too short, too long and non-text descriptions are rejected", async () => {
    const before = await Project.countDocuments();
    for (const description of [undefined, "", "     ", "   too short   ", "x".repeat(8001), 12345, null]) {
      const res = await presenter.post("/api/projects").send(payload({ description }));
      assert.equal(res.status, 400, JSON.stringify(description));
      assert.ok(res.body.errors.description, `no description error for ${JSON.stringify(description)}`);
    }
    assert.equal(await Project.countDocuments(), before);
  });

  test("abstract and technologies are no longer accepted from the form", async () => {
    for (const extra of [{ abstract: "An old-style abstract for this project." }, { technologies: ["React"] }]) {
      const res = await presenter.post("/api/projects").send(payload(extra));
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    const created = await presenter.post("/api/projects").send(payload());
    const patch = await presenter.patch(`/api/projects/${created.body.project._id}`).send({ technologies: ["Vue"] });
    assert.equal(patch.status, 400);
  });

  test("the description can be edited and is validated on update", async () => {
    const created = await presenter.post("/api/projects").send(payload());
    const id = created.body.project._id;
    const ok = await presenter.patch(`/api/projects/${id}`).send({ description: "  An updated short description of the project.  " });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.project.description, "An updated short description of the project.");
    const blank = await presenter.patch(`/api/projects/${id}`).send({ description: "    " });
    assert.equal(blank.status, 400);
    assert.ok(blank.body.errors.description);
  });

  test("existing projects with abstract and technologies keep loading and can still be edited", async () => {
    const presenterUser = await User.findOne({ email: "p@desc.edu" });
    const legacy = {
      title: "Legacy Weather Station",
      abstract: "Original abstract written before the form was simplified.",
      description: "Measures temperature and humidity and publishes the readings to a dashboard.",
      technologies: ["Arduino", "MQTT"],
      teamMembers: [{ name: "Presenter", rollNumber: "DS001" }],
      facultyGuide: "Dr. Old Guide",
      submittedBy: presenterUser._id,
      files: [],
    };
    const { insertedIds } = await Project.collection.insertMany([
      { ...legacy, projectNumber: "LEG-A", status: "approved" },
      { ...legacy, projectNumber: "LEG-P", title: "Legacy Pending Project", status: "pending" },
    ]);

    const list = await viewer.get("/api/projects?search=weather");
    assert.equal(list.status, 200);
    const entry = list.body.projects.find((p) => p.projectNumber === "LEG-A");
    assert.equal(entry.description, legacy.description, "cards now receive the description");

    const byAbstract = await viewer.get("/api/projects?search=simplified");
    assert.ok(byAbstract.body.projects.some((p) => p.projectNumber === "LEG-A"), "legacy abstracts stay searchable");

    const detail = await viewer.get(`/api/projects/${insertedIds[0]}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.project.abstract, legacy.abstract);

    const board = await viewer.get("/api/leaderboard?group=overall");
    assert.equal(board.status, 200);

    // Editing a legacy project neither fails validation nor erases its old data.
    const edit = await presenter.patch(`/api/projects/${insertedIds[1]}`).send({ title: "Legacy Pending Project v2" });
    assert.equal(edit.status, 200, edit.body.message);
    const raw = await Project.collection.findOne({ _id: insertedIds[1] });
    assert.equal(raw.abstract, legacy.abstract);
    assert.deepEqual(raw.technologies, legacy.technologies);

    const adminEdit = await admin.patch(`/api/projects/${insertedIds[0]}`).send({ facultyGuide: "Dr. New Guide" });
    assert.equal(adminEdit.status, 200);
  });

  test("description search finds new projects", async () => {
    await presenter.post("/api/projects").send(payload({ projectNumber: "SRCH-1", description: "A hydroponics monitor for vertical farms." }));
    const project = await Project.findOne({ projectNumber: "SRCH-1" });
    await admin.patch(`/api/admin/projects/${project._id}/status`).send({ status: "approved" });
    const res = await viewer.get("/api/projects?search=hydroponics");
    assert.deepEqual(res.body.projects.map((p) => p.projectNumber), ["SRCH-1"]);
  });

  test("the form has one small required description and no abstract or technologies (static check)", async () => {
    const source = await readFile(new URL("../../client/src/pages/ProjectForm.jsx", import.meta.url), "utf8");
    assert.ok(!/abstract/i.test(source), "abstract is still referenced in the form");
    assert.ok(!/technolog/i.test(source), "technologies are still referenced in the form");
    const textarea = source.match(/<Textarea\b(?:(?!\/>)[\s\S])*value=\{form\.description\}(?:(?!\/>)[\s\S])*\/>/)?.[0];
    assert.ok(textarea, "description textarea not found");
    assert.match(textarea, /label="Project description"/);
    assert.match(textarea, /\brequired\b/);
    assert.match(textarea, /rows=\{4\}/);
    assert.match(textarea, /placeholder="Briefly describe your project, its purpose, and what it does\.\.\."/);
  });
});
