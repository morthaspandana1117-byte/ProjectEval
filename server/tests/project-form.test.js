// Regression tests for the blank page after submitting a new project.
// Root cause: ProjectEditor derived "edit mode" from `project` state; after a successful create it set
// that state, then read `permissions.canEdit` while `permissions` was null (new project) and crashed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const { projectFormMode } = await import("../../client/src/lib/projectFormMode.js");
const source = await readFile(new URL("../../client/src/pages/ProjectForm.jsx", import.meta.url), "utf8");

describe("project form mode", () => {
  test("a new project never reads permissions (there are none)", () => {
    const open = projectFormMode({ isNew: true, permissions: null, deadlines: { upload: { open: true, reason: null } } });
    assert.deepEqual(open, {
      isEdit: false,
      canEditDetails: true,
      canUpload: true,
      canRemove: true,
      filesReason: null,
      filesOnly: false,
    });

    const closed = projectFormMode({
      isNew: true,
      permissions: null,
      deadlines: { upload: { open: false, reason: "The file upload deadline passed on 20 Oct 2026, 17:00 IST." } },
    });
    assert.equal(closed.canUpload, false);
    assert.match(closed.filesReason, /file upload deadline passed/);
    assert.equal(projectFormMode({ isNew: true, permissions: null, deadlines: null }).canUpload, false);
  });

  test("an existing project follows the server permissions", () => {
    const permissions = {
      canEdit: false,
      canUploadFiles: true,
      canRemoveFiles: true,
      reasons: { edit: "The project editing deadline passed.", files: null },
    };
    assert.deepEqual(projectFormMode({ isNew: false, permissions, deadlines: null }), {
      isEdit: true,
      canEditDetails: false,
      canUpload: true,
      canRemove: true,
      filesReason: null,
      filesOnly: true,
    });
  });
});

describe("ProjectForm submit flow (static checks)", () => {
  test("mode comes from how the form was opened, not from post-create state", () => {
    assert.match(source, /projectFormMode\(\{\s*isNew: !initialProject,/);
    assert.ok(!/const isEdit = Boolean\(project\)/.test(source), "edit mode is derived from state again");
    assert.match(source, /if \(isEdit\) setProject\(saved\)/, "a new project must not be put into editor state");
  });

  test("double submission is blocked and Back cannot resubmit a new project", () => {
    assert.match(source, /if \(submittingRef\.current\) return/);
    assert.match(source, /navigate\(`\/projects\/\$\{saved\._id\}`, \{ replace: !isEdit \}\)/);
    assert.match(source, /navigate\(`\/projects\/\$\{saved\._id\}`, \{ replace: true \}\)/, "failed upload after create must leave the form");
  });
});
