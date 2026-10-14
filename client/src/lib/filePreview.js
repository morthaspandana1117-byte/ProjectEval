// Which uploaded files can be previewed in the browser, and how.
// Upload types are limited server-side to PDF, PNG, JPEG, WEBP, DOCX and PPTX.
const KINDS = {
  pdf: { kind: 'pdf', type: 'application/pdf' },
  png: { kind: 'image', type: 'image/png' },
  jpg: { kind: 'image', type: 'image/jpeg' },
  jpeg: { kind: 'image', type: 'image/jpeg' },
  webp: { kind: 'image', type: 'image/webp' },
  pptx: { kind: 'pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
}

/** @returns {{ kind: 'pdf' | 'image' | 'pptx', type: string } | null} */
export function previewKind(filename = '') {
  return KINDS[filename.split('.').pop().toLowerCase()] ?? null
}

export const previewPath = (projectId, fileId) => `/projects/${projectId}/files/${fileId}/preview`
