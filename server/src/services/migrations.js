import Project from "../models/Project.js";
import User from "../models/Users.js";

export const UNKNOWN_GUIDE = "Unknown guide";

/**
 * Faculty guides used to be stored as a reference to a faculty account; they are now free text.
 * Rewrites any legacy ObjectId value to that account's name (or "Unknown guide" if the account
 * no longer exists). Idempotent: once converted, records are skipped.
 * @returns {Promise<number>} number of projects converted
 */
export async function migrateLegacyFacultyGuides() {
  const legacy = await Project.collection
    .find({ facultyGuide: { $type: "objectId" } }, { projection: { facultyGuide: 1 } })
    .toArray();
  if (!legacy.length) return 0;

  const users = await User.collection
    .find({ _id: { $in: legacy.map((p) => p.facultyGuide) } }, { projection: { name: 1 } })
    .toArray();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  const result = await Project.collection.bulkWrite(
    legacy.map((project) => ({
      updateOne: {
        // Re-check the type so a concurrent edit is never overwritten.
        filter: { _id: project._id, facultyGuide: project.facultyGuide },
        update: { $set: { facultyGuide: nameById.get(project.facultyGuide.toString()) ?? UNKNOWN_GUIDE } },
      },
    }))
  );
  return result.modifiedCount;
}
