// Opens a text or code file (Markdown, LaTeX, JSON, YAML, TypeScript, …) as a one-file project in the Code studio.
import { Doc } from "../../core/doc.js";
import { ensureWeb } from "../../core/web.js";
import { sanitizeFileName } from "../../engine/web/index.js";
import { decodeText, describeSource } from "../../core/source-format.js";

/** @param {import("../../core/app.js").App} app @param {{ name: string, bytes: Uint8Array, path?: string }} file */
export async function openTextDocument(app, file) {
  const head = file.bytes.subarray(0, 4000);
  if (head.includes(0)) throw new Error(`“${file.name}” looks like a binary file, not text.`);
  const name = sanitizeFileName(file.name) || "document.txt";
  const { text, bom, eol } = decodeText(file.bytes); // LF text for the editors; BOM and line ending are written back by File ▸ Save
  const isPage = /\.html?$/i.test(name);
  const doc = new Doc({ name: name.replace(/\.[^.]+$/, ""), width: 1280, height: 800, studio: "code" });
  ensureWeb(doc, { [name]: text }, { entry: name, settings: { kind: isPage ? "site" : "document", view: "split", openFiles: [name], activeFile: name, sourcePath: file.path || null } });
  doc.history.clear();
  doc.saved = true;
  // File ▸ Save writes this file again in its own format (core/source-format.js); `original` makes an untouched file round trip byte for byte
  const src = describeSource(file, doc);
  if (src) doc.source = { ...src, bom, eol, entry: name, original: file.bytes, snapshot: text };
  app.openDoc(doc);
  app.setStudio("code");
  return doc;
}
