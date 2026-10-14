// Simplified, read-only .pptx preview: each slide's title, text and pictures, in presentation order.
// Pure string parsing (no DOM), so it runs the same in the browser and in tests.
import { readZip } from './zip.js'

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

function attributes(tag) {
  const result = {}
  for (const [, name, value] of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) result[name] = decodeXml(value)
  return result
}

/** Resolves a relationship target (e.g. "../media/image1.png") against the part's folder. */
function resolvePath(baseDir, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`).split('/')
  const out = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

async function readRelationships(zip, relsPath, baseDir) {
  if (!zip.has(relsPath)) return new Map()
  const xml = await zip.readText(relsPath)
  const rels = new Map()
  for (const [tag] of xml.matchAll(/<(?:[\w-]+:)?Relationship\b[^>]*>/g)) {
    const { Id, Target, Type = '', TargetMode } = attributes(tag)
    if (Id && Target && TargetMode !== 'External') rels.set(Id, { type: Type, path: resolvePath(baseDir, Target) })
  }
  return rels
}

/** Paragraph texts (runs joined) in document order, skipping empty paragraphs. */
export function extractParagraphs(xml) {
  const paragraphs = []
  for (const [, body] of xml.matchAll(/<(?:[\w-]+:)?p(?=[\s>])[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?p>/g)) {
    const runs = [...body.matchAll(/<(?:[\w-]+:)?t(?=[\s>])[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g)].map((m) => decodeXml(m[1]))
    const text = runs.join('').replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push(text)
  }
  return paragraphs
}

/** Splits a slide into its title (title placeholders) and the remaining body text. */
export function parseSlideText(xml) {
  const titleShapes = []
  let rest = xml
  for (const [shape] of xml.matchAll(/<(?:[\w-]+:)?sp(?=[\s>])[\s\S]*?<\/(?:[\w-]+:)?sp>/g)) {
    if (/<(?:[\w-]+:)?ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(shape)) {
      titleShapes.push(shape)
      rest = rest.replace(shape, '')
    }
  }
  return {
    title: titleShapes.flatMap(extractParagraphs).join(' — ') || null,
    paragraphs: extractParagraphs(rest),
  }
}

async function slideOrder(zip) {
  const rels = await readRelationships(zip, 'ppt/_rels/presentation.xml.rels', 'ppt')
  if (zip.has('ppt/presentation.xml')) {
    const xml = await zip.readText('ppt/presentation.xml')
    const ordered = [...xml.matchAll(/<(?:[\w-]+:)?sldId\b[^>]*>/g)]
      .map(([tag]) => Object.entries(attributes(tag)).find(([name]) => /^[\w-]+:id$/.test(name))?.[1])
      .map((rid) => rels.get(rid)?.path)
      .filter((path) => path && zip.has(path))
    if (ordered.length) return ordered
  }
  // Fallback: slide files sorted by number.
  return zip
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))
}

/**
 * @returns {Promise<{ slides: { number, title, paragraphs, images: { name, type, bytes }[], skippedImages }[] }>}
 */
export async function parsePptx(input) {
  const zip = readZip(input)
  if (!zip.has('[Content_Types].xml') || !zip.names().some((n) => n.startsWith('ppt/'))) {
    throw new Error('This does not look like a PowerPoint presentation.')
  }

  const slides = []
  for (const [index, path] of (await slideOrder(zip)).entries()) {
    const xml = await zip.readText(path)
    const dir = path.slice(0, path.lastIndexOf('/'))
    const file = path.slice(path.lastIndexOf('/') + 1)
    const rels = await readRelationships(zip, `${dir}/_rels/${file}.rels`, dir)

    const images = []
    let skippedImages = 0
    const seen = new Set()
    for (const [, rid] of xml.matchAll(/<(?:[\w-]+:)?blip\b[^>]*?\b[\w-]+:embed="([^"]+)"/g)) {
      const rel = rels.get(rid)
      if (!rel || seen.has(rel.path) || !zip.has(rel.path)) continue
      seen.add(rel.path)
      const type = IMAGE_TYPES[rel.path.split('.').pop().toLowerCase()]
      if (!type) {
        skippedImages += 1 // e.g. EMF/WMF/TIFF, which browsers cannot display
        continue
      }
      images.push({ name: rel.path.split('/').pop(), type, bytes: await zip.readBytes(rel.path) })
    }

    slides.push({ number: index + 1, ...parseSlideText(xml), images, skippedImages })
  }
  return { slides }
}
