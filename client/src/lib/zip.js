// Minimal read-only ZIP reader for previews (.pptx files are ZIP archives).
// Uses the platform's DecompressionStream, so no extra dependency is needed.

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_ENTRIES = 10000
export const MAX_ENTRY_BYTES = 30 * 1024 * 1024 // guards against decompression bombs

export class ZipError extends Error {}

async function inflateRaw(data, limit) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new ZipError('A part of this file is too large to preview.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Reads the central directory and returns lazy accessors for entries. */
export function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()

  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('This file is not a valid archive.')

  const count = view.getUint16(eocd + 10, true)
  if (count > MAX_ENTRIES) throw new ZipError('This file has too many parts to preview.')
  let offset = view.getUint32(eocd + 16, true)
  const entries = new Map()
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('This file is damaged or uses an unsupported format.')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    entries.set(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }

  async function readBytes(name) {
    const entry = entries.get(name)
    if (!entry) throw new ZipError(`Missing part: ${name}`)
    const local = entry.localOffset
    if (view.getUint32(local, true) !== LOCAL_SIGNATURE) throw new ZipError('This file is damaged.')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + entry.compressedSize)
    if (entry.method === 0) return data.slice()
    if (entry.method === 8) return inflateRaw(data, MAX_ENTRY_BYTES)
    throw new ZipError('This file uses an unsupported compression method.')
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    readBytes,
    readText: async (name) => decoder.decode(await readBytes(name)),
  }
}
