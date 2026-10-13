/**
 * Which parts of the project form are usable, from the server's permissions.
 * `isNew` must come from how the form was opened (no initial project), never from state that
 * changes after a successful create — a new project has no `permissions` object.
 */
export function projectFormMode({ isNew, permissions, deadlines }) {
  if (isNew) {
    return {
      isEdit: false,
      canEditDetails: true,
      canUpload: Boolean(deadlines?.upload?.open),
      canRemove: true,
      filesReason: deadlines?.upload?.reason ?? null,
      filesOnly: false,
    }
  }
  return {
    isEdit: true,
    canEditDetails: permissions.canEdit,
    canUpload: permissions.canUploadFiles,
    canRemove: permissions.canRemoveFiles,
    filesReason: permissions.reasons.files,
    filesOnly: !permissions.canEdit,
  }
}
