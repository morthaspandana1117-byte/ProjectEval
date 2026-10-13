import mongoose from "mongoose";

const BUCKET_NAME = "projectFiles";

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

/** Stores a buffer in GridFS (MongoDB) so uploads survive redeploys on ephemeral hosts. */
export function saveFile(buffer, { filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(filename, { metadata: { ...metadata, contentType } });
    stream.once("error", reject);
    stream.once("finish", () => resolve(stream.id));
    stream.end(buffer);
  });
}

export async function fileExists(fileId) {
  const [file] = await bucket().find({ _id: new mongoose.Types.ObjectId(fileId) }).limit(1).toArray();
  return Boolean(file);
}

export function openFileStream(fileId) {
  return bucket().openDownloadStream(new mongoose.Types.ObjectId(fileId));
}

export async function deleteFile(fileId) {
  try {
    await bucket().delete(new mongoose.Types.ObjectId(fileId));
  } catch (error) {
    // Already gone is fine; anything else should surface.
    if (!/FileNotFound|not found/i.test(error?.message || "")) throw error;
  }
}

export async function deleteFiles(fileIds) {
  await Promise.all(fileIds.map((id) => deleteFile(id)));
}
