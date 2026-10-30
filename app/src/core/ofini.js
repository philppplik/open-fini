// The .ofini document container: a ZIP archive holding
//   mimetype          application/vnd.openfini+zip (stored first, uncompressed)
//   document.json     structure, styles, text stories
//   assets/<id>.<ext> original image bytes
//   pixels/<id>.png   pixel layers (lossless)
//   web/files/<path>  files of the website project (Code studio), listed in document.json → "web"
//   office/media/<id>.<ext>  images of the Office Studio document (document.json → "office")
//   thumbnail.png     preview
import { zipSync, unzipSync, strToU8, strFromU8 } from "../../vendor/fflate/fflate.js";
import { Doc, createCanvas } from "./doc.js";
import { WebProject, attachWeb } from "./web.js";
import { OfficeProject } from "./office.js";
import { walk } from "./nodes.js";
import { migrateDocumentJson } from "./ofini-migrate.js";
import { dlState, buildPageDL } from "../engine/dl.js";
import { renderToCanvas } from "../engine/backends/canvas.js";

export const OFINI_MIME = "application/vnd.openfini+zip";
const EXT = { "application/vnd.iccprofile": "icc", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg" };

export async function canvasToBytes(canvas, type = "image/png", quality) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type, quality }) : await new Promise((r) => canvas.toBlob(r, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

async function bytesToCanvas(bytes, mime = "image/png") {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const c = createCanvas(bmp.width, bmp.height);
  c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

/** Serializes a document to .ofini bytes. */
export async function saveOfini(doc) {
  const files = { mimetype: [strToU8(OFINI_MIME), { level: 0 }] };
  files["document.json"] = strToU8(JSON.stringify(doc.toJSON()));
  for (const a of Object.values(doc.assets)) {
    if (a.bytes) files[`assets/${a.id}.${EXT[a.mime] || "bin"}`] = [a.bytes, { level: 0 }];
  }
  const jobs = [];
  const seen = new Set();
  doc.walkAll(
    (n) => {
      if (n.type === "pixel" && !seen.has(n.id)) {
        seen.add(n.id);
        const c = doc.pixels.get(n.id);
        if (c) jobs.push(canvasToBytes(c).then((b) => (files[`pixels/${n.id}.png`] = [b, { level: 0 }])));
      }
      if (n.mask) walk(n.mask, (m) => {
        if (m.type === "pixel" && !seen.has(m.id)) {
          seen.add(m.id);
          const c = doc.pixels.get(m.id);
          if (c) jobs.push(canvasToBytes(c).then((b) => (files[`pixels/${m.id}.png`] = [b, { level: 0 }])));
        }
      });
    },
    { masters: true },
  );
  await Promise.all(jobs);
  if (doc.web) for (const [name, bytes] of Object.entries(doc.web.entries())) files[name] = [bytes, { level: bytes.length > 512 ? 6 : 0 }];
  if (doc.web?.gitFiles) for (const [name, bytes] of Object.entries(doc.web.gitEntries())) files[name] = [bytes, { level: 0 }]; // history travels with the file; objects are already zlib-compressed
  if (doc.office) for (const [name, bytes] of Object.entries(doc.office.entries())) files[name] = [bytes, { level: 0 }]; // Office Studio images
  try {
    const page = doc.pages[0];
    const s = Math.min(1, 256 / Math.max(page.w, page.h));
    const thumb = renderToCanvas(buildPageDL(doc, page), { scale: s, bg: page.bg || null });
    files["thumbnail.png"] = [await canvasToBytes(thumb), { level: 0 }];
  } catch {
    /* thumbnails are optional */
  }
  // Deflating a large document.json (or website) blocks for 100+ ms (about 25 ms per MB): do it on the worker pool.
  let deflated = 0;
  for (const v of Object.values(files)) if (!Array.isArray(v)) deflated += v.length;
  else if (v[1]?.level) deflated += v[0].length;
  if (deflated < 512 * 1024) return zipSync(files, { level: 6 });
  const { runJob } = await import("./workers/index.js");
  return runJob("zip.compress", { files, level: 6 });
}

/** Loads a document from .ofini bytes. */
export async function loadOfini(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("This file is not a valid OpenFini document.");
  }
  if (!entries["document.json"]) throw new Error("The document is missing its content (document.json).");
  let json;
  try {
    json = JSON.parse(strFromU8(entries["document.json"]));
  } catch {
    throw new Error("The document content (document.json) is damaged and cannot be read.");
  }
  // old files are upgraded in memory (the file stays untouched until saved); newer files open best-effort
  const mig = migrateDocumentJson(json);
  json = mig.json;
  const doc = Doc.fromJSON(json);
  doc.formatNotes = mig.notes;
  doc.formatNewer = mig.newer;
  // assets
  for (const a of Object.values(doc.assets)) {
    const key = Object.keys(entries).find((k) => k.startsWith(`assets/${a.id}.`));
    if (key) {
      a.bytes = entries[key];
      try {
        a._bitmap = await createImageBitmap(new Blob([a.bytes], { type: a.mime }));
      } catch {
        /* undecodable asset: leave placeholder */
      }
    }
  }
  // pixel layers
  const jobs = [];
  doc.walkAll(
    (n) => {
      if (n.type === "pixel") jobs.push(loadPixels(doc, n, entries));
      if (n.mask) walk(n.mask, (m) => m.type === "pixel" && jobs.push(loadPixels(doc, m, entries)));
    },
    { masters: true },
  );
  await Promise.all(jobs);
  if (json.web) {
    doc.web = WebProject.fromManifest(json.web, (path) => entries[`web/files/${path}`]);
    attachWeb(doc);
    const git = new Map();
    for (const [name, bytes] of Object.entries(entries)) if (name.startsWith("web/git/")) git.set(name.slice(8), bytes);
    if (git.has("HEAD")) doc.web.gitFiles = git;
  }
  if (json.office && typeof json.office === "object") doc.office = OfficeProject.fromManifest(json.office, entries);
  dlState.version++;
  doc.history.clear();
  doc.saved = true;
  return doc;
}

async function loadPixels(doc, node, entries) {
  const data = entries[`pixels/${node.id}.png`];
  if (!data) return;
  doc.pixels.set(node.id, await bytesToCanvas(data));
}
