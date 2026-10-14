import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import zlib from "node:zlib";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.NODE_ENV = "test";

// Client-side preview modules are plain ES modules (no JSX), so they run directly in Node.
const { readZip, ZipError, MAX_ENTRY_BYTES } = await import("../../client/src/lib/zip.js");
const { parsePptx, parseSlideText } = await import("../../client/src/lib/pptx.js");
const { previewKind, previewPath } = await import("../../client/src/lib/filePreview.js");

const PASSWORD = "Passw0rd!";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Builds a ZIP archive (deflated by default, `store: true` for uncompressed parts). */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false } of files) {
    const nameBuf = Buffer.from(name);
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const compressed = store ? body : zlib.deflateRawSync(body);
    const crc = zlib.crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, compressed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const shape = (phType, ...paragraphs) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${phType ? `<p:ph type="${phType}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr/>` +
  `<p:txBody><a:bodyPr/>${paragraphs.map((runs) => `<a:p><a:pPr lvl="0"/>${[runs].flat().map((t) => `<a:r><a:rPr lang="en"/><a:t>${t}</a:t></a:r>`).join("")}</a:p>`).join("")}</p:txBody></p:sp>`;
const picture = (rid) => `<p:pic><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill></p:pic>`;
const slide = (body) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const rels = (items) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

/** A small but structurally real .pptx: slide order comes from presentation.xml (slide2 first). */
function samplePptx() {
  return buildZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "ppt/presentation.xml", data: `<p:presentation ${NS}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", data: rels([["rId2", "slide", "slides/slide1.xml"], ["rId3", "slide", "slides/slide2.xml"]]) },
    {
      name: "ppt/slides/slide1.xml",
      data: slide(
        shape("title", "How it works") +
          shape(null, ["Detect ", "&amp; block"], "Uses &lt;AI&gt; models", "   ") +
          picture("rId2") +
          picture("rId3") +
          picture("rId2")
      ),
    },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: rels([["rId2", "image", "../media/image1.png"], ["rId3", "image", "../media/image2.emf"]]) },
    { name: "ppt/media/image1.png", data: PNG, store: true },
    { name: "ppt/media/image2.emf", data: Buffer.from("EMF-DATA"), store: true },
    { name: "ppt/slides/slide2.xml", data: slide(shape("ctrTitle", "ScamShield AI") + shape("subTitle", "Team 7 &#8212; Final demo")) },
  ]);
}

describe("file preview helpers", () => {
  test("only PDFs, images and PowerPoint files are previewable", () => {
    for (const name of ["a.pdf", "b.PNG", "c.jpg", "d.jpeg", "e.webp", "ScamShield-AI.pptx"]) assert.ok(previewKind(name), name);
    for (const name of ["report.docx", "notes.txt", "noextension", ""]) assert.equal(previewKind(name), null, name);
    assert.equal(previewKind("ScamShield-AI.pptx").kind, "pptx");
    assert.equal(previewKind("x.pdf").type, "application/pdf");
    assert.equal(previewPath("p1", "f1"), "/projects/p1/files/f1/preview");
  });

  test("reads stored and deflated zip entries", async () => {
    const zip = readZip(buildZip([
      { name: "stored.txt", data: "plain text", store: true },
      { name: "deflated.txt", data: "compressed ".repeat(50) },
    ]));
    assert.deepEqual(zip.names(), ["stored.txt", "deflated.txt"]);
    assert.equal(await zip.readText("stored.txt"), "plain text");
    assert.equal(await zip.readText("deflated.txt"), "compressed ".repeat(50));
  });

  test("parses slides in presentation order with titles, text and pictures", async () => {
    const { slides } = await parsePptx(samplePptx());
    assert.equal(slides.length, 2);

    assert.equal(slides[0].number, 1);
    assert.equal(slides[0].title, "ScamShield AI");
    assert.deepEqual(slides[0].paragraphs, ["Team 7 — Final demo"]);

    assert.equal(slides[1].title, "How it works");
    assert.deepEqual(slides[1].paragraphs, ["Detect & block", "Uses <AI> models"]);
    assert.equal(slides[1].images.length, 1, "duplicate picture references are shown once");
    assert.equal(slides[1].images[0].type, "image/png");
    assert.ok(Buffer.from(slides[1].images[0].bytes).equals(PNG));
    assert.equal(slides[1].skippedImages, 1, "EMF pictures cannot be shown in a browser");
  });

  test("falls back to numeric slide order when presentation.xml is missing", async () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "ppt/slides/slide10.xml", data: slide(shape("title", "Ten")) },
      { name: "ppt/slides/slide2.xml", data: slide(shape("title", "Two")) },
    ]);
    const { slides } = await parsePptx(zip);
    assert.deepEqual(slides.map((s) => s.title), ["Two", "Ten"]);
  });

  test("slides without a title placeholder keep all text as body", () => {
    assert.deepEqual(parseSlideText(slide(shape(null, "Only body"))), { title: null, paragraphs: ["Only body"] });
  });

  test("invalid, non-PowerPoint and oversized files fail with readable errors", async () => {
    assert.throws(() => readZip(Buffer.from("definitely not a zip file")), ZipError);
    await assert.rejects(parsePptx(buildZip([{ name: "word/document.xml", data: "<w/>" }])), /does not look like a PowerPoint presentation/);

    const bomb = readZip(buildZip([{ name: "big.bin", data: Buffer.alloc(MAX_ENTRY_BYTES + 1024) }]));
    await assert.rejects(bomb.readBytes("big.bin"), /too large to preview/);
  });
});

describe("previewing uploaded files keeps existing access rules", () => {
  let mongo;
  let app;
  let presenter;
  let viewer;
  let admin;
  let projectId;
  let fileId;

  const binary = (req) =>
    req.buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  const signIn = async (email) => {
    const agent = request.agent(app);
    assert.equal((await agent.post("/api/auth/login").send({ email, password: PASSWORD })).status, 200);
    return agent;
  };

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = (await import("../src/app.js")).createApp();
    const User = (await import("../src/models/Users.js")).default;
    await mongoose.connection.syncIndexes();
    await User.create({ name: "Admin", email: "admin@fp.edu", password: PASSWORD, role: "admin" });
    await User.create({ name: "Presenter", email: "presenter@fp.edu", password: PASSWORD, role: "student", rollNumber: "FP001" });
    await User.create({ name: "Viewer", email: "viewer@fp.edu", password: PASSWORD, role: "student", rollNumber: "FP002" });
    presenter = await signIn("presenter@fp.edu");
    viewer = await signIn("viewer@fp.edu");
    admin = await signIn("admin@fp.edu");

    const created = await presenter.post("/api/projects").send({
      projectNumber: "FP-1",
      title: "ScamShield AI",
      description: "Detects scam messages and warns users before they respond.",
      teamMembers: [{ name: "Presenter", rollNumber: "FP001" }],
      facultyGuide: "Dr. Guide",
    });
    projectId = created.body.project._id;
    const upload = await presenter.post(`/api/projects/${projectId}/files`).attach("files", samplePptx(), "ScamShield-AI.pptx");
    assert.equal(upload.status, 201, upload.body.message);
    fileId = upload.body.files[0]._id;
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  test("private files stay private: signed-out 401, other students 404 before approval", async () => {
    const url = `/api/projects/${projectId}/files/${fileId}`;
    assert.equal((await request(app).get(url)).status, 401);
    assert.equal((await viewer.get(url)).status, 404);
  });

  test("an uploaded .pptx round-trips through storage into a slide preview", async () => {
    await admin.patch(`/api/admin/projects/${projectId}/status`).send({ status: "approved" });
    const res = await binary(viewer.get(`/api/projects/${projectId}/files/${fileId}`));
    assert.equal(res.status, 200);
    // Download behaviour is unchanged: still served as an attachment with a locked-down CSP.
    assert.match(res.headers["content-disposition"], /^attachment;/);
    assert.match(res.headers["content-security-policy"], /sandbox/);

    const { slides } = await parsePptx(res.body);
    assert.deepEqual(slides.map((s) => s.title), ["ScamShield AI", "How it works"]);
  });

  test("the View button and preview route are wired in the client (static check)", async () => {
    const detail = await readFile(new URL("../../client/src/pages/ProjectDetail.jsx", import.meta.url), "utf8");
    assert.match(detail, /href=\{previewPath\(project\._id, file\._id\)\}\s*target="_blank"\s*rel="noopener noreferrer"/);
    assert.match(detail, /icon=\{Download\}/, "the Download button is still present");
    const routes = await readFile(new URL("../../client/src/App.jsx", import.meta.url), "utf8");
    const authBlock = routes.slice(routes.indexOf("<Route element={<RequireAuth />}>"));
    assert.match(authBlock, /<Route path="projects\/:id\/files\/:fileId\/preview" element=\{<FilePreview \/>\} \/>/);
  });
});
