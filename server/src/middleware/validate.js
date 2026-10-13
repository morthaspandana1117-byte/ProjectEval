import { badRequest } from "../utils/http.js";

function toFieldErrors(issues) {
  const errors = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Validates req.body (replacing it with the parsed value) against a zod schema. */
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(badRequest("Please correct the highlighted fields.", toFieldErrors(result.error.issues)));
    }
    req.body = result.data;
    next();
  };
}

/** Validates req.query and exposes the parsed value as req.q (req.query is read-only in Express 5). */
export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      return next(badRequest("Invalid query parameters.", toFieldErrors(result.error.issues)));
    }
    req.q = result.data;
    next();
  };
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** router.param handler rejecting malformed ObjectIds before they reach Mongoose. */
export function objectIdParam(req, _res, next, value) {
  if (!OBJECT_ID.test(value)) return next(badRequest("Invalid identifier."));
  next();
}
