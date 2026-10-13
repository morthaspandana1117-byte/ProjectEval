import { env } from "../config/env.js";
import { formatInEventZone, toZonedLocalString } from "../utils/dates.js";

/**
 * Presenter deadlines. Rules:
 *  - An empty deadline (null/undefined) means no time restriction.
 *  - An action is open only while `now` is strictly earlier than its deadline (closed at the exact instant).
 *  - A stored value that is not a valid date fails closed and logs a warning.
 *  - Admins are never restricted by presenter deadlines.
 * Every helper takes `now` so tests can use a deterministic clock.
 */

export const DEADLINES = {
  submission: { field: "submissionDeadline", label: "project submission" },
  edit: { field: "editDeadline", label: "project editing" },
  upload: { field: "uploadDeadline", label: "file upload" },
};

const SWITCH_CLOSED = "Project submissions are currently closed by the administrator.";
const APPROVED_LOCK = "Approved projects are locked so ratings stay fair. Contact the administrator if something needs to change.";
const NOT_PRESENTER = "Only the presenter who submitted this project can change it.";

const sameId = (a, b) => Boolean(a && b) && (a._id ?? a).toString() === (b._id ?? b).toString();
export const isSubmitter = (project, user) => sameId(project.submittedBy, user._id);

/** Reads the stored value, preferring the raw record so invalid values are not silently dropped. */
function storedValue(settings, field) {
  const raw = settings?.$locals?.raw;
  return raw ? raw[field] : settings?.[field];
}

/**
 * @returns {{ configured: boolean, open: boolean, invalid: boolean, deadline: Date | null }}
 */
export function deadlineStatus(value, now = new Date(), label = "deadline") {
  if (value === null || value === undefined) {
    return { configured: false, open: true, invalid: false, deadline: null };
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    // Never log the value itself; just enough to find and fix the setting.
    console.warn(`[deadlines] The ${label} deadline setting is not a valid date; treating the action as closed.`);
    return { configured: true, open: false, invalid: true, deadline: null };
  }
  return { configured: true, open: now.getTime() < value.getTime(), invalid: false, deadline: value };
}

function closedReason(kind, status) {
  const { label } = DEADLINES[kind];
  if (status.invalid) return `The ${label} deadline is misconfigured, so this action is closed. Contact the administrator.`;
  return `The ${label} deadline passed on ${formatInEventZone(status.deadline)}.`;
}

/** Open/closed state of one presenter window, with a reason when closed. */
export function windowStatus(settings, kind, now = new Date()) {
  const status = deadlineStatus(storedValue(settings, DEADLINES[kind].field), now, DEADLINES[kind].label);
  return { ...status, reason: status.open ? null : closedReason(kind, status) };
}

/** New submissions need the manual switch ON and the submission deadline not yet reached. */
export function submissionStatus(settings, now = new Date()) {
  const window = windowStatus(settings, "submission", now);
  if (!settings.submissionsOpen) return { ...window, open: false, reason: SWITCH_CLOSED };
  return window;
}

const allow = { allowed: true, reason: null };
const deny = (reason) => ({ allowed: false, reason });

/**
 * Distinct permissions for an existing project:
 *  edit (details) and delete follow the edit deadline; uploadFiles and removeFiles follow the upload deadline.
 * Existing ownership and approval rules apply first; admins keep full management rights.
 */
export function projectPermissions(project, user, settings, now = new Date()) {
  if (user.role === "admin") return { edit: allow, delete: allow, uploadFiles: allow, removeFiles: allow };

  let blocked = null;
  if (!isSubmitter(project, user)) blocked = deny(NOT_PRESENTER);
  else if (project.status === "approved") blocked = deny(APPROVED_LOCK);
  if (blocked) return { edit: blocked, delete: blocked, uploadFiles: blocked, removeFiles: blocked };

  const edit = windowStatus(settings, "edit", now);
  const upload = windowStatus(settings, "upload", now);
  const editPermission = edit.open ? allow : deny(edit.reason);
  const uploadPermission = upload.open ? allow : deny(upload.reason);
  return { edit: editPermission, delete: editPermission, uploadFiles: uploadPermission, removeFiles: uploadPermission };
}

/** Flattens permissions for API responses; `canEdit` keeps its original meaning (edit project details). */
export function permissionFlags(permissions) {
  return {
    canEdit: permissions.edit.allowed,
    canDelete: permissions.delete.allowed,
    canUploadFiles: permissions.uploadFiles.allowed,
    canRemoveFiles: permissions.removeFiles.allowed,
    canManageFiles: permissions.uploadFiles.allowed && permissions.removeFiles.allowed,
    reasons: {
      edit: permissions.edit.reason,
      delete: permissions.delete.reason,
      files: permissions.uploadFiles.reason ?? permissions.removeFiles.reason,
    },
  };
}

function describe(status) {
  return {
    deadline: status.deadline ? status.deadline.toISOString() : null,
    local: status.deadline ? toZonedLocalString(status.deadline) : null,
    display: status.deadline ? formatInEventZone(status.deadline) : null,
    configured: status.configured,
    invalid: status.invalid,
    passed: status.configured && !status.open,
    open: status.open,
    reason: status.reason,
  };
}

/** Deadline overview for the UI. The server's `open` flags are the source of truth. */
export function deadlineSummary(settings, now = new Date()) {
  const submissionWindow = windowStatus(settings, "submission", now);
  const submission = submissionStatus(settings, now);
  return {
    eventTimezone: env.timezone,
    serverTime: now.toISOString(),
    serverTimeLocal: toZonedLocalString(now),
    submission: {
      ...describe(submissionWindow),
      switchOn: Boolean(settings.submissionsOpen),
      open: submission.open,
      reason: submission.reason,
    },
    edit: describe(windowStatus(settings, "edit", now)),
    upload: describe(windowStatus(settings, "upload", now)),
  };
}
