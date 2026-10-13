import AuditLog from "../models/AuditLog.js";

/** Records an administrative or security-relevant action. Never throws. */
export async function audit(req, action, { targetType, targetId, summary, details, actor } = {}) {
  try {
    await AuditLog.create({
      actor: actor ?? req.user?._id,
      action,
      targetType,
      targetId,
      summary,
      details,
      ip: req.ip,
    });
  } catch (error) {
    console.error("Failed to write audit log:", error.message);
  }
}
