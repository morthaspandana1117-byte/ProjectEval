import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

const PASSWORD = "Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\n%deadline test\n%%EOF");
const HOUR = 3_600_000;

const dates = await import("../src/utils/dates.js");
const deadlines = await import("../src/services/deadlines.js");

// ---------------------------------------------------------------------------
// Pure logic (deterministic clock)
// ---------------------------------------------------------------------------

describe("deadline comparisons", () => {
  const deadline = new Date("2026-10-20T11:30:00.000Z");

  test("empty deadline stays open", () => {
    for (const value of [null, undefined]) assert.equal(deadlines.deadlineStatus(value, new Date()).open, true);
  });

  test("open before, closed exactly at and after the deadline", () => {
    assert.equal(deadlines.deadlineStatus(deadline, new Date(deadline.getTime() - 1)).open, true);
    assert.equal(deadlines.deadlineStatus(deadline, new Date(deadline.getTime())).open, false);
    assert.equal(deadlines.deadlineStatus(deadline, new Date(deadline.getTime() + 1)).open, false);
  });

  test("invalid stored values fail closed with a warning that omits the value", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    for (const value of ["s3cret-garbage", new Date("nope"), 12345, { $date: "x" }]) {
      const status = deadlines.deadlineStatus(value, new Date(), "file upload");
      assert.equal(status.open, false);
      assert.equal(status.invalid, true);
    }
    assert.equal(warn.mock.callCount(), 4);
    for (const call of warn.mock.calls) {
      assert.match(call.arguments[0], /file upload deadline setting is not a valid date/);
      assert.ok(!call.arguments.join(" ").includes("s3cret-garbage"));
    }
  });

  test("submission requires the switch and an open deadline", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const future = new Date("2026-10-20T11:00:00Z");
    const past = new Date("2026-10-20T09:00:00Z");
    const status = (s) => deadlines.submissionStatus(s, now);
    assert.equal(status({ submissionsOpen: true, submissionDeadline: null }).open, true);
    assert.equal(status({ submissionsOpen: true, submissionDeadline: future }).open, true);
    assert.equal(status({ submissionsOpen: true, submissionDeadline: now }).open, false);
    assert.match(status({ submissionsOpen: true, submissionDeadline: past }).reason, /deadline passed/);
    assert.match(status({ submissionsOpen: false, submissionDeadline: null }).reason, /closed by the administrator/);
    // Other deadlines never block submission.
    assert.equal(status({ submissionsOpen: true, editDeadline: past, uploadDeadline: past }).open, true);
  });

  test("project permissions are independent per window", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const past = new Date("2026-10-20T09:00:00Z");
    const future = new Date("2026-10-20T11:00:00Z");
    const owner = { _id: new mongoose.Types.ObjectId(), role: "student" };
    const project = { submittedBy: owner._id, status: "pending" };
    const perms = (settings, user = owner, p = project) =>
      deadlines.permissionFlags(deadlines.projectPermissions(p, user, settings, now));

    const editClosed = perms({ editDeadline: past, uploadDeadline: future, submissionDeadline: past });
    assert.deepEqual(
      [editClosed.canEdit, editClosed.canDelete, editClosed.canUploadFiles, editClosed.canRemoveFiles],
      [false, false, true, true]
    );
    const uploadClosed = perms({ editDeadline: future, uploadDeadline: past, submissionDeadline: past });
    assert.deepEqual(
      [uploadClosed.canEdit, uploadClosed.canDelete, uploadClosed.canManageFiles],
      [true, true, false]
    );
    const atBoundary = perms({ editDeadline: now, uploadDeadline: now });
    assert.equal(atBoundary.canEdit || atBoundary.canManageFiles, false);

    const approved = perms({}, owner, { ...project, status: "approved" });
    assert.equal(approved.canEdit || approved.canManageFiles || approved.canDelete, false);
    assert.match(approved.reasons.edit, /Approved projects are locked/);

    const stranger = perms({}, { _id: new mongoose.Types.ObjectId(), role: "student" });
    assert.equal(stranger.canEdit, false);

    const admin = perms({ editDeadline: past, uploadDeadline: past }, { _id: new mongoose.Types.ObjectId(), role: "admin" }, { ...project, status: "approved" });
    assert.equal(admin.canEdit && admin.canDelete && admin.canManageFiles, true);
  });
});

describe("event timezone conversion", () => {
  test("converts IST wall-clock time to UTC", () => {
    assert.equal(dates.zonedDateTimeToUtc("2026-10-20T17:00", "Asia/Kolkata").toISOString(), "2026-10-20T11:30:00.000Z");
    assert.equal(dates.toZonedLocalString(new Date("2026-10-20T11:30:00Z"), "Asia/Kolkata"), "2026-10-20T17:00");
    assert.equal(dates.formatInEventZone(new Date("2026-10-20T11:30:00Z"), "Asia/Kolkata"), "20 Oct 2026, 17:00 IST");
  });

  test("handles daylight-saving transitions safely", () => {
    const ny = "America/New_York";
    assert.equal(dates.zonedDateTimeToUtc("2026-07-01T12:00", ny).toISOString(), "2026-07-01T16:00:00.000Z"); // EDT
    assert.equal(dates.zonedDateTimeToUtc("2026-12-01T12:00", ny).toISOString(), "2026-12-01T17:00:00.000Z"); // EST
    assert.equal(dates.zonedDateTimeToUtc("2026-11-01T03:00", ny).toISOString(), "2026-11-01T08:00:00.000Z");
    assert.throws(() => dates.zonedDateTimeToUtc("2026-03-08T02:30", ny), /does not exist/); // skipped hour
    assert.throws(() => dates.zonedDateTimeToUtc("2026-11-01T01:30", ny), /ambiguous/); // repeated hour
  });

  test("rejects malformed, impossible, out-of-range values and unsupported zones", () => {
    const bad = [
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-10-20T24:00",
      "2026-10-20 17:00",
      "2026-10-20T17:00Z",
      "1999-12-31T23:59",
      "2101-01-01T00:00",
      "tomorrow",
      "",
    ];
    for (const value of bad) {
      assert.throws(() => dates.zonedDateTimeToUtc(value, "Asia/Kolkata"), dates.DateTimeInputError, value);
    }
    assert.throws(() => dates.zonedDateTimeToUtc("2026-10-20T17:00", "Mars/Phobos"), /not supported/);
  });
});

// ---------------------------------------------------------------------------
// API enforcement
// ---------------------------------------------------------------------------

let mongo;
let app;
let models;

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.body.message);
  return agent;
}

// Wall-clock strings in the event timezone, relative to now.
const istFromNow = (ms) => dates.toZonedLocalString(new Date(Date.now() + ms));
const PAST = () => istFromNow(-2 * HOUR);
const FUTURE = () => istFromNow(2 * HOUR);

const projectPayload = (n, overrides = {}) => ({
  projectNumber: `DL-${n}`,
  title: `Deadline Project ${n}`,
  description: "A description that is comfortably long enough to satisfy the project validation rules.",
  teamMembers: [{ name: "Presenter", rollNumber: "DL001" }],
  facultyGuide: "Prof. Anita Desai",
  ...overrides,
});

describe("deadline enforcement through the API", () => {
  let admin, presenter, other, faculty;
  let counter = 0;

  const setSettings = async (body) => {
    const res = await admin.patch("/api/admin/settings").send(body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const clearAll = () =>
    setSettings({ submissionsOpen: true, submissionDeadline: null, editDeadline: null, uploadDeadline: null });
  const createProject = async (overrides) => {
    counter += 1;
    const res = await presenter.post("/api/projects").send(projectPayload(counter, overrides));
    assert.equal(res.status, 201, res.body.message);
    return res.body.project;
  };
  const storedFileCount = () => mongoose.connection.db.collection("projectFiles.files").countDocuments();

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    models = {
      User: (await import("../src/models/Users.js")).default,
      Project: (await import("../src/models/Project.js")).default,
      Settings: (await import("../src/models/Settings.js")).default,
    };
    await mongoose.connection.syncIndexes();
    const { User } = models;
    await User.create({ name: "Admin", email: "admin@dl.edu", password: PASSWORD, role: "admin" });
    await User.create({ name: "Presenter", email: "presenter@dl.edu", password: PASSWORD, role: "student", rollNumber: "DL001" });
    await User.create({ name: "Other", email: "other@dl.edu", password: PASSWORD, role: "student", rollNumber: "DL002" });
    await User.create({ name: "Faculty", email: "faculty@dl.edu", password: PASSWORD, role: "faculty" });
    admin = await signIn("admin@dl.edu");
    presenter = await signIn("presenter@dl.edu");
    other = await signIn("other@dl.edu");
    faculty = await signIn("faculty@dl.edu");
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  describe("settings", () => {
    beforeEach(clearAll);

    test("each deadline can be set and cleared independently", async () => {
      const set = await setSettings({ submissionDeadline: "2026-10-20T17:00" });
      assert.equal(set.settings.submissionDeadline, "2026-10-20T11:30:00.000Z");
      assert.equal(set.deadlines.submission.local, "2026-10-20T17:00");
      assert.equal(set.deadlines.submission.display, "20 Oct 2026, 17:00 IST");
      assert.equal(set.settings.editDeadline, null);
      assert.equal(set.settings.uploadDeadline, null);

      await setSettings({ editDeadline: "2026-10-21T09:15" });
      const third = await setSettings({ uploadDeadline: "2026-10-22T23:59" });
      assert.equal(third.settings.submissionDeadline, "2026-10-20T11:30:00.000Z");
      assert.equal(third.settings.editDeadline, "2026-10-21T03:45:00.000Z");
      assert.equal(third.settings.uploadDeadline, "2026-10-22T18:29:00.000Z");

      const cleared = await setSettings({ editDeadline: null });
      assert.equal(cleared.settings.editDeadline, null);
      assert.equal(cleared.settings.submissionDeadline, "2026-10-20T11:30:00.000Z");
      assert.equal(cleared.settings.uploadDeadline, "2026-10-22T18:29:00.000Z");
      assert.equal(cleared.deadlines.edit.configured, false);
      assert.equal(cleared.deadlines.edit.open, true);

      const emptyString = await setSettings({ uploadDeadline: "" });
      assert.equal(emptyString.settings.uploadDeadline, null); // "" clears; never a past deadline
      assert.equal(emptyString.deadlines.upload.open, true);
      assert.equal(emptyString.settings.submissionDeadline, "2026-10-20T11:30:00.000Z");
    });

    test("other settings updates leave deadlines untouched", async () => {
      await setSettings({ editDeadline: "2026-10-21T09:15" });
      const res = await setSettings({ votingOpen: true, eventName: "Expo 2026" });
      assert.equal(res.settings.editDeadline, "2026-10-21T03:45:00.000Z");
      assert.equal(res.settings.votingOpen, true);
      assert.equal(res.settings.eventName, "Expo 2026");
      assert.ok(res.settings.activeSession);
    });

    test("malformed and out-of-range values are rejected with 400", async () => {
      const bad = [
        { submissionDeadline: "2026-02-30T10:00" },
        { editDeadline: "1999-12-31T10:00" },
        { uploadDeadline: "2101-01-01T00:00" },
        { editDeadline: "not-a-date" },
        { editDeadline: "2026-10-20T17:00Z" },
        { submissionDeadline: 1760000000000 },
        { submissionDeadline: true },
      ];
      for (const body of bad) {
        const res = await admin.patch("/api/admin/settings").send(body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.body.errors?.[Object.keys(body)[0]], JSON.stringify(res.body));
      }
      const current = await admin.get("/api/admin/settings");
      assert.equal(current.body.settings.submissionDeadline, null);
    });

    test("students and faculty cannot change settings", async () => {
      for (const agent of [presenter, faculty]) {
        assert.equal((await agent.patch("/api/admin/settings").send({ editDeadline: null })).status, 403);
      }
    });

    test("responses expose the event timezone and deadline status", async () => {
      await setSettings({ submissionDeadline: PAST() });
      const adminView = await admin.get("/api/admin/settings");
      assert.equal(adminView.body.settings.eventTimezone, "Asia/Kolkata");
      assert.equal(adminView.body.deadlines.eventTimezone, "Asia/Kolkata");
      assert.equal(adminView.body.deadlines.submission.passed, true);

      const me = await presenter.get("/api/auth/me");
      assert.equal(me.body.settings.eventTimezone, "Asia/Kolkata");
      assert.equal(me.body.deadlines.submission.open, false);
      assert.equal(me.body.deadlines.edit.open, true);
      assert.match(me.body.deadlines.serverTimeLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

      const stats = await admin.get("/api/admin/stats");
      assert.equal(stats.body.deadlines.submission.open, false);
    });

    test("an invalid stored deadline fails closed", async (t) => {
      const warn = t.mock.method(console, "warn", () => {});
      const project = await createProject();
      await models.Settings.collection.updateOne({ key: "global" }, { $set: { editDeadline: "garbage-value" } });

      const res = await presenter.patch(`/api/projects/${project._id}`).send({ title: "Should not save" });
      assert.equal(res.status, 403);
      assert.match(res.body.message, /misconfigured/);
      assert.ok(warn.mock.callCount() >= 1);
      assert.ok(!JSON.stringify(warn.mock.calls.map((c) => c.arguments)).includes("garbage-value"));
      assert.equal((await presenter.get("/api/auth/me")).body.deadlines.edit.invalid, true);
    });
  });

  describe("submission", () => {
    beforeEach(clearAll);

    test("blocked after the submission deadline even with the switch on", async () => {
      await setSettings({ submissionDeadline: PAST() });
      const res = await presenter.post("/api/projects").send(projectPayload("S1"));
      assert.equal(res.status, 403);
      assert.match(res.body.message, /project submission deadline passed on .* IST/);
    });

    test("blocked by the switch even without a deadline", async () => {
      await setSettings({ submissionsOpen: false });
      const res = await presenter.post("/api/projects").send(projectPayload("S2"));
      assert.equal(res.status, 403);
      assert.match(res.body.message, /closed by the administrator/);
    });

    test("allowed with the switch on and an empty or future deadline", async () => {
      await createProject();
      await setSettings({ submissionDeadline: FUTURE() });
      await createProject();
    });

    test("expired edit and upload deadlines do not block submission", async () => {
      await setSettings({ editDeadline: PAST(), uploadDeadline: PAST() });
      await createProject();
    });
  });

  describe("editing and deletion", () => {
    beforeEach(clearAll);

    test("presenter editing and deletion follow the edit deadline only", async () => {
      const project = await createProject();
      await setSettings({ editDeadline: PAST() });
      const edit = await presenter.patch(`/api/projects/${project._id}`).send({ title: "Edited after deadline" });
      assert.equal(edit.status, 403);
      assert.match(edit.body.message, /project editing deadline passed/);
      assert.equal((await presenter.delete(`/api/projects/${project._id}`)).status, 403);

      await setSettings({ editDeadline: FUTURE(), submissionDeadline: PAST(), uploadDeadline: PAST() });
      const ok = await presenter.patch(`/api/projects/${project._id}`).send({ title: "Edited before deadline" });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.project.title, "Edited before deadline");
      assert.equal((await presenter.delete(`/api/projects/${project._id}`)).status, 200);
    });

    test("returned-for-changes projects cannot be resubmitted after the edit deadline", async () => {
      const project = await createProject();
      await admin.patch(`/api/admin/projects/${project._id}/status`).send({ status: "rejected", reviewNote: "Fix" });
      await setSettings({ editDeadline: PAST() });
      assert.equal((await presenter.patch(`/api/projects/${project._id}`).send({ title: "Fixed project" })).status, 403);
      assert.equal((await models.Project.findById(project._id)).status, "rejected");
    });

    test("approved projects stay locked even before the edit deadline", async () => {
      const project = await createProject();
      await admin.patch(`/api/admin/projects/${project._id}/status`).send({ status: "approved" });
      await setSettings({ editDeadline: FUTURE(), uploadDeadline: FUTURE() });
      const res = await presenter.patch(`/api/projects/${project._id}`).send({ title: "Approved change" });
      assert.equal(res.status, 403);
      assert.match(res.body.message, /Approved projects are locked/);
      assert.equal((await presenter.post(`/api/projects/${project._id}/files`).attach("files", PDF, "a.pdf")).status, 403);
    });

    test("other students cannot change someone else's project", async () => {
      const project = await createProject();
      assert.equal((await other.patch(`/api/projects/${project._id}`).send({ title: "Not mine at all" })).status, 404);
    });

    test("admins keep management rights after every deadline", async () => {
      const project = await createProject();
      await setSettings({ submissionDeadline: PAST(), editDeadline: PAST(), uploadDeadline: PAST() });
      assert.equal((await admin.patch(`/api/projects/${project._id}`).send({ title: "Admin edit after" })).status, 200);
      const upload = await admin.post(`/api/projects/${project._id}/files`).attach("files", PDF, "admin.pdf");
      assert.equal(upload.status, 201);
      const removed = await admin.delete(`/api/projects/${project._id}/files/${upload.body.files[0]._id}`);
      assert.equal(removed.status, 200);
      assert.equal((await admin.delete(`/api/projects/${project._id}`)).status, 200);
    });
  });

  describe("file operations", () => {
    beforeEach(clearAll);

    test("upload, replacement and removal are blocked after the upload deadline", async () => {
      const project = await createProject();
      const first = await presenter.post(`/api/projects/${project._id}/files`).attach("files", PDF, "first.pdf");
      assert.equal(first.status, 201);
      const storedBefore = await storedFileCount();

      await setSettings({ uploadDeadline: PAST() });
      const upload = await presenter.post(`/api/projects/${project._id}/files`).attach("files", PDF, "late.pdf");
      assert.equal(upload.status, 403);
      assert.match(upload.body.message, /file upload deadline passed/);
      const remove = await presenter.delete(`/api/projects/${project._id}/files/${first.body.files[0]._id}`);
      assert.equal(remove.status, 403);

      // Nothing stored and no orphaned records.
      assert.equal(await storedFileCount(), storedBefore);
      const saved = await models.Project.findById(project._id);
      assert.deepEqual(saved.files.map((f) => f.filename), ["first.pdf"]);
    });

    test("expired edit deadline does not block an authorized upload", async () => {
      const project = await createProject();
      await setSettings({ editDeadline: PAST(), uploadDeadline: FUTURE() });
      const res = await presenter.post(`/api/projects/${project._id}/files`).attach("files", PDF, "ok.pdf");
      assert.equal(res.status, 201);
      assert.equal((await presenter.delete(`/api/projects/${project._id}/files/${res.body.files[0]._id}`)).status, 200);
    });

    test("expired upload deadline does not block an authorized detail edit", async () => {
      const project = await createProject();
      await setSettings({ uploadDeadline: PAST() });
      assert.equal((await presenter.patch(`/api/projects/${project._id}`).send({ title: "Edit while uploads closed" })).status, 200);
    });

    test("existing file safety checks still apply", async () => {
      const project = await createProject();
      const before = await storedFileCount();
      const spoofed = await presenter.post(`/api/projects/${project._id}/files`).attach("files", Buffer.from("MZ fake"), "x.pdf");
      assert.equal(spoofed.status, 400);
      const exe = await presenter.post(`/api/projects/${project._id}/files`).attach("files", Buffer.from("MZ"), "x.exe");
      assert.equal(exe.status, 400);
      assert.equal(await storedFileCount(), before);
    });

    test("project detail and my projects expose distinct permissions", async () => {
      const project = await createProject();
      await setSettings({ editDeadline: PAST(), uploadDeadline: FUTURE() });
      const detail = await presenter.get(`/api/projects/${project._id}`);
      const p = detail.body.permissions;
      assert.deepEqual(
        [p.canEdit, p.canDelete, p.canUploadFiles, p.canRemoveFiles, p.canManageFiles],
        [false, false, true, true, true]
      );
      assert.match(p.reasons.edit, /editing deadline passed/);
      assert.equal(p.reasons.files, null);
      assert.equal(detail.body.deadlines.edit.passed, true);

      const mine = await presenter.get("/api/projects/mine");
      const entry = mine.body.projects.find((x) => x._id === project._id);
      assert.equal(entry.permissions.canEdit, false);
      assert.equal(entry.permissions.canManageFiles, true);
      assert.equal(mine.body.deadlines.upload.open, true);
    });

    test("with every deadline empty, presenters keep today's permissions", async () => {
      const project = await createProject();
      const detail = await presenter.get(`/api/projects/${project._id}`);
      const p = detail.body.permissions;
      assert.equal(p.canEdit && p.canDelete && p.canManageFiles, true);
      assert.equal((await presenter.patch(`/api/projects/${project._id}`).send({ title: "Normal edit works" })).status, 200);
    });
  });

  describe("faculty guide as free text", () => {
    beforeEach(clearAll);

    test("a typed guide name is trimmed, saved and displayed", async () => {
      const project = await createProject({ facultyGuide: "   Prof. Ravi Shankar   " });
      assert.equal(project.facultyGuide, "Prof. Ravi Shankar");
      const detail = await presenter.get(`/api/projects/${project._id}`);
      assert.equal(detail.body.project.facultyGuide, "Prof. Ravi Shankar");

      const edited = await presenter.patch(`/api/projects/${project._id}`).send({ facultyGuide: "Dr. Unregistered Person" });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.project.facultyGuide, "Dr. Unregistered Person");

      await admin.patch(`/api/admin/projects/${project._id}/status`).send({ status: "approved" });
      const report = await admin.get("/api/admin/reports/voting");
      assert.equal(report.body.projects.find((x) => x._id === project._id).facultyGuide, "Dr. Unregistered Person");
      const list = await other.get("/api/projects");
      assert.equal(list.body.projects.find((x) => x._id === project._id).facultyGuide, "Dr. Unregistered Person");
    });

    test("empty, whitespace-only, overlong and non-text guide names are rejected", async () => {
      const values = ["", "    ", "x".repeat(101), 42, null];
      for (const facultyGuide of values) {
        const res = await presenter.post("/api/projects").send(projectPayload(`G-${String(facultyGuide).length}`, { facultyGuide }));
        assert.equal(res.status, 400, JSON.stringify(facultyGuide));
        assert.ok(res.body.errors.facultyGuide);
      }
      const { facultyGuide: _omit, ...missing } = projectPayload("G-missing");
      assert.equal((await presenter.post("/api/projects").send(missing)).status, 400);

      const project = await createProject();
      assert.equal((await presenter.patch(`/api/projects/${project._id}`).send({ facultyGuide: "   " })).status, 400);
    });

    test("legacy guide references are converted to names and stay readable", async () => {
      const { migrateLegacyFacultyGuides, UNKNOWN_GUIDE } = await import("../src/services/migrations.js");
      const guide = await models.User.findOne({ email: "faculty@dl.edu" });
      const presenterUser = await models.User.findOne({ email: "presenter@dl.edu" });
      const base = {
        title: "Legacy Project",
        abstract: "An abstract that is comfortably long enough for validation.",
        description: "A description that is comfortably long enough to satisfy the project validation rules.",
        technologies: ["Legacy"],
        teamMembers: [{ name: "Old Team" }],
        submittedBy: presenterUser._id,
        status: "approved",
        files: [],
      };
      const { insertedIds } = await models.Project.collection.insertMany([
        { ...base, projectNumber: "LEG-1", facultyGuide: guide._id },
        { ...base, projectNumber: "LEG-2", facultyGuide: new mongoose.Types.ObjectId() },
      ]);

      assert.equal(await migrateLegacyFacultyGuides(), 2);
      assert.equal(await migrateLegacyFacultyGuides(), 0); // idempotent

      const first = await other.get(`/api/projects/${insertedIds[0]}`);
      assert.equal(first.status, 200);
      assert.equal(first.body.project.facultyGuide, "Faculty");
      const second = await other.get(`/api/projects/${insertedIds[1]}`);
      assert.equal(second.body.project.facultyGuide, UNKNOWN_GUIDE);
    });

    test("the project form uses a text input, not a dropdown of faculty accounts (static check)", async () => {
      const source = await readFile(new URL("../../client/src/pages/ProjectForm.jsx", import.meta.url), "utf8");
      assert.ok(!source.includes("api.get('/faculty')"), "form still loads the faculty directory");
      const selects = source.match(/<Select\b[\s\S]*?<\/Select>/g) ?? [];
      assert.ok(selects.every((block) => !block.includes("facultyGuide")), "faculty guide is still a <Select>");
      assert.match(source, /<Input\b(?:(?!\/>)[\s\S])*facultyGuide(?:(?!\/>)[\s\S])*\/>/);
    });
  });
});
