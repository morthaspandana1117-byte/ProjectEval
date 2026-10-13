import multer from "multer";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";

const DUPLICATE_MESSAGES = {
  email: "An account with this email already exists.",
  rollNumber: "An account with this roll number already exists.",
  employeeId: "An account with this employee ID already exists.",
  projectNumber: "A project with this project number already exists.",
};

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: "Each file must be 5 MB or smaller.",
  LIMIT_FILE_COUNT: "You can upload at most 5 files at a time.",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field. Upload files using the 'files' field.",
};

export function notFoundHandler(_req, res) {
  res.status(404).json({ message: "The requested resource was not found." });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...(err.errors && { errors: err.errors }) });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: MULTER_MESSAGES[err.code] || "File upload failed." });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    return res.status(409).json({
      message: DUPLICATE_MESSAGES[field] || "This record already exists.",
      ...(field && { errors: { [field]: DUPLICATE_MESSAGES[field] || "Already exists" } }),
    });
  }
  if (err?.name === "ValidationError") {
    const errors = Object.fromEntries(Object.entries(err.errors).map(([key, value]) => [key, value.message]));
    return res.status(400).json({ message: "Please correct the highlighted fields.", errors });
  }
  if (err?.name === "CastError") {
    return res.status(400).json({ message: "Invalid identifier." });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON request body." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }

  if (!env.isTest) console.error(err);
  res.status(500).json({
    message: "Something went wrong on our side. Please try again.",
    ...(!env.isProd && { detail: err?.message }),
  });
}
