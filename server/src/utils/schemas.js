import { z } from "zod";
import { FEEDBACK_MAX, FEEDBACK_MIN } from "../models/Rating.js";
import { DateTimeInputError, isValidSession, zonedDateTimeToUtc } from "./dates.js";

const blankToUndefined = (value) => (value === "" || value === null ? undefined : value);

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
export const session = z.string().refine(isValidSession, "Use a valid date in YYYY-MM-DD format");

export const name = z.string().trim().min(2, "Name must be at least 2 characters").max(100);
export const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));
export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

const code = (label) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(2, `${label} is too short`)
    .max(30, `${label} is too long`)
    .regex(/^[A-Z0-9/_-]+$/, `${label} may contain only letters, numbers, - / _`);

export const rollNumber = code("Roll number");
export const employeeId = code("Employee ID");
export const department = z.string().trim().max(100);
export const year = z.coerce.number().int().min(1).max(6);

export const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

export const registerSchema = z
  .object({
    name,
    email,
    password,
    rollNumber,
    department: optional(department),
    year: optional(year),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, "Password is required").max(128),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(128),
    newPassword: password,
  })
  .strict();

export const adminCreateUserSchema = z
  .object({
    name,
    email,
    password,
    role: z.enum(["student", "faculty"], "Role must be student or faculty"),
    rollNumber: optional(rollNumber),
    employeeId: optional(employeeId),
    department: optional(department),
    year: optional(year),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === "student" && !value.rollNumber) {
      ctx.addIssue({ code: "custom", path: ["rollNumber"], message: "Roll number is required for students" });
    }
  });

export const adminUpdateUserSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    role: z.enum(["student", "faculty"]).optional(),
    rollNumber: rollNumber.nullable().optional().or(z.literal("").transform(() => null)),
    employeeId: employeeId.nullable().optional().or(z.literal("").transform(() => null)),
    department: department.optional(),
    year: year.nullable().optional().or(z.literal("").transform(() => null)),
    isActive: z.boolean().optional(),
  })
  .strict();

export const resetPasswordSchema = z.object({ password }).strict();

export const userListQuery = z.object({
  role: z.enum(["admin", "student", "faculty"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

const member = z
  .object({
    name: z.string().trim().min(2, "Member name is required").max(100),
    rollNumber: optional(rollNumber),
  })
  .strict();

export const GUIDE_NAME_MAX = 100;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 8000;

export const projectSchema = z
  .object({
    projectNumber: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, "Project number is required")
      .max(20)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers and hyphens only (e.g. CSE-042)"),
    title: z.string().trim().min(5, "Title must be at least 5 characters").max(200),
    // The single project description (abstract and technologies are no longer collected).
    description: z
      .string("Project description is required")
      .trim()
      .min(DESCRIPTION_MIN, `Please describe your project in at least ${DESCRIPTION_MIN} characters`)
      .max(DESCRIPTION_MAX, `Project description must be at most ${DESCRIPTION_MAX} characters`),
    teamMembers: z.array(member).min(1, "Add at least one team member").max(10, "At most 10 team members"),
    // Free-text guide name; the guide does not need a registered faculty account.
    facultyGuide: z
      .string("Faculty guide name is required")
      .trim()
      .min(1, "Faculty guide name is required")
      .max(GUIDE_NAME_MAX, `Faculty guide name must be at most ${GUIDE_NAME_MAX} characters`),
  })
  .strict();

export const projectUpdateSchema = projectSchema.partial().strict();

export const projectListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const reviewSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]),
    reviewNote: optional(z.string().trim().max(500)),
  })
  .strict();

export const ratingSchema = z
  .object({
    score: z.number().int("Score must be a whole number").min(1, "Minimum score is 1").max(5, "Maximum score is 5"),
    feedback: z
      .string()
      .trim()
      .min(FEEDBACK_MIN, `Please describe what you understood in at least ${FEEDBACK_MIN} characters`)
      .max(FEEDBACK_MAX),
  })
  .strict();

export const attendanceQuery = z.object({
  session: session.optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["present", "absent", "unmarked"]).optional(),
});

// "none" keeps the original single-sheet layout; "year" splits rows into year-of-study sheets.
export const exportLayout = z.enum(["none", "year"], "groupBy must be 'none' or 'year'").default("none");

export const attendanceExportQuery = z
  .object({
    session: z.union([session, z.literal("all")]).optional(),
    groupBy: exportLayout,
  })
  .strict();

export const votingExportQuery = z.object({ groupBy: exportLayout }).strict();

export const attendanceUpdateSchema = z
  .object({
    session,
    records: z
      .array(z.object({ studentId: objectId, status: z.enum(["present", "absent"]) }).strict())
      .min(1, "No attendance records supplied")
      .max(1000),
  })
  .strict();

/**
 * Deadline input: omitted = unchanged; null or "" = clear (no time restriction);
 * "YYYY-MM-DDTHH:mm" = wall-clock time in EVENT_TIMEZONE, converted to a UTC Date.
 */
const deadlineInput = z
  .union([
    z.null(),
    z.string().transform((value, ctx) => {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      try {
        return zonedDateTimeToUtc(trimmed);
      } catch (error) {
        if (!(error instanceof DateTimeInputError)) throw error;
        ctx.addIssue({ code: "custom", message: error.message });
        return z.NEVER;
      }
    }),
  ], "Use YYYY-MM-DDTHH:mm, or null to clear the deadline")
  .optional();

export const settingsSchema = z
  .object({
    eventName: z.string().trim().min(2).max(120).optional(),
    votingOpen: z.boolean().optional(),
    submissionsOpen: z.boolean().optional(),
    leaderboardVisible: z.boolean().optional(),
    activeSession: session.optional(),
    submissionDeadline: deadlineInput,
    editDeadline: deadlineInput,
    uploadDeadline: deadlineInput,
  })
  .strict();

export const leaderboardQuery = z.object({
  group: z.enum(["student", "faculty", "overall"]).default("student"),
});

export const participationQuery = z.object({
  role: z.enum(["student", "faculty"]).default("student"),
  filter: z.enum(["all", "voted", "not-voted"]).default("all"),
  search: z.string().trim().max(100).optional(),
});
