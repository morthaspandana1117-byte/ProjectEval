import path from "node:path";
import multer from "multer";
import { badRequest } from "../utils/http.js";

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// Allow-list of supporting file types. The stored content type comes from this table,
// never from the client, and each upload's leading bytes must match its extension.
const FILE_TYPES = {
  ".pdf": { contentType: "application/pdf", matches: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  ".png": {
    contentType: "image/png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  ".jpg": { contentType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".jpeg": { contentType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".webp": {
    contentType: "image/webp",
    matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  ".docx": {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (b) => b.subarray(0, 4).equals(ZIP_MAGIC),
  },
  ".pptx": {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    matches: (b) => b.subarray(0, 4).equals(ZIP_MAGIC),
  },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);

export const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 5, fields: 0, parts: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!FILE_TYPES[ext]) {
      return cb(badRequest(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
    }
    cb(null, true);
  },
}).array("files", 5);

export function sanitizeFilename(original) {
  const base = path.basename(original).normalize("NFKC");
  const ext = path.extname(base).toLowerCase();
  const stem = base
    .slice(0, base.length - ext.length)
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${stem || "file"}${ext}`;
}

/** Verifies an uploaded file's signature and returns its trusted metadata. */
export function inspectUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const type = FILE_TYPES[ext];
  if (!type || !type.matches(file.buffer)) {
    throw badRequest(`"${sanitizeFilename(file.originalname)}" does not look like a valid ${ext || "supported"} file.`);
  }
  return { filename: sanitizeFilename(file.originalname), contentType: type.contentType, size: file.size };
}
