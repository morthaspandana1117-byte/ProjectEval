import mongoose from "mongoose";

export const PROJECT_STATUSES = ["pending", "approved", "rejected"];
export const MAX_PROJECT_FILES = 5;

const fileSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true, maxlength: 120 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const memberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    rollNumber: { type: String, trim: true, uppercase: true, maxlength: 30 },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    projectNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
      match: /^[A-Z0-9][A-Z0-9-]*$/,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 8000 },
    // Legacy fields: no longer collected by the form, kept optional so older records load and save unchanged.
    abstract: { type: String, trim: true, maxlength: 1500 },
    technologies: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: undefined,
      validate: [(list) => !list || list.length <= 15, "At most 15 technologies are allowed"],
    },
    teamMembers: {
      type: [memberSchema],
      validate: [(list) => list.length >= 1 && list.length <= 10, "A team needs 1 to 10 members"],
    },
    // Guide's name as typed by the presenter (older records stored a User id; see services/migrations.js).
    facultyGuide: { type: String, required: true, trim: true, maxlength: 100 },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    files: {
      type: [fileSchema],
      validate: [(list) => list.length <= MAX_PROJECT_FILES, `At most ${MAX_PROJECT_FILES} files are allowed`],
    },
    status: { type: String, enum: PROJECT_STATUSES, default: "pending", index: true },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
  },
  { timestamps: true }
);

projectSchema.index({ status: 1, projectNumber: 1 });

projectSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);
export default Project;
