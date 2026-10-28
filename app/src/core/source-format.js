// "Save back to the original format": decides, per document, whether File ▸ Save can still write the file the
// document was opened from (a .txt stays a .txt, a .docx stays a .docx) or whether the document now holds more than
// that format can represent, in which case only .ofini keeps everything. Pure module (no DOM): the save flow lives in
// commands/save-source.js, the tests in tests/core/source-format.test.js.
//
// Public API
//   describeSource(file, doc)        -> source info recorded on `doc.source` when a document is created from a file
//   canSaveAsSource(doc, {enabled})  -> { ok, ask, reason, format, kind, name, label }
//   saveTarget(doc, {enabled})       -> { label: ".txt", name: "notes.txt", source: boolean } for tab, status bar, tooltips
//   decodeText(bytes) / encodeText(text, source) -> UTF-8 text round trip that keeps BOM and line endings
//   officeFidelityNotes(model, id)   -> what the Office writers cannot store (shown after saving)
//   sourceMeta(doc)                  -> { name, format } written to document.json ("source", display only)
//
// doc.source = { name, format, kind, path?, handle?, bom?, eol?, original?, snapshot?, officeId? }
//   kind "text"    one-file code project from a text file: written back while it is still exactly that one file
//   kind "office"  opened in the Office studio: written back through the Office writers (docx, odt, rtf, html, md, txt);
//                  other Office Suite kinds (`officeKind`: sheet, slides, board …) record their app's format id in
//                  `officeId` when they open the file (ui/office/open.js) and are written by that app's save()
//   kind "vector"  SVG: written back through the SVG exporter while the document is a pure single-page vector drawing
//   kind "image" | "foreign"  raster images, PSD, PDF, IDML ...: never written back silently (flattening would destroy
//                  layers or data); File ▸ Save keeps writing .ofini, Save As offers the original format as an export
// Invariants
//   * `source` is runtime state. It is never restored from an .ofini file (the file location is not part of the file);
//     only name and format are stored for display. The autosave session keeps the location fields.
//   * Unchanged text round trips byte for byte: `original` holds the bytes that were read and `snapshot` the text they
//     decoded to; encodeText returns `original` while the text still equals `snapshot`.
//   * `ask: true` means the document had a writable source and lost it through edits: the caller shows ONE dialog.

const TEXT_FORMATS = ["txt", "text", "md", "markdown", "mdx", "tex", "latex", "bib", "sty", "cls", "json", "jsonc", "yaml", "yml", "xml", "csv", "tsv", "toml", "ini", "conf", "properties", "log", "ts", "tsx", "jsx", "js", "mjs", "css", "html", "htm"];
const OFFICE_WRITE = { docx: "docx", odt: "odt", rtf: "rtf", html: "html", htm: "html", xhtml: "html", md: "md", markdown: "md", txt: "txt", text: "txt" };
const OFFICE_CANONICAL = { docx: "docx", odt: "odt", rtf: "rtf", html: "html", md: "md", txt: "txt" };
const IMAGE_FORMATS = ["png", "jpg", "jpeg", "jpe", "webp", "gif", "bmp", "avif", "tif", "tiff", "ico", "cur"];
const VECTOR_NODE_TYPES = new Set(["group", "rect", "ellipse", "polygon", "star", "path", "text", "image"]);

export const extOf = (name) => (/\.([^./\\]+)$/.exec(String(name || ""))?.[1] || "").toLowerCase();
export const baseOf = (name) => String(name || "").replace(/\.[^./\\]+$/, "");

/** Line ending of a text: "lf", "crlf", "cr", "mixed" or "none" (a single line). */
export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  const cr = (text.match(/\r/g) || []).length - crlf;
  const kinds = [crlf && "crlf", lf && "lf", cr && "cr"].filter(Boolean);
  return kinds.length === 0 ? "none" : kinds.length === 1 ? kinds[0] : "mixed";
}

/**
 * Decodes UTF-8 text: strips a BOM and converts every line ending to "\n" (the editors work on LF).
 * @returns {{ text: string, bom: boolean, eol: string }}
 */
export function decodeText(bytes) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text = new TextDecoder("utf-8").decode(bytes); // the decoder drops a leading BOM itself
  const eol = detectEol(text);
  return { text: eol === "lf" || eol === "none" ? text : text.replace(/\r\n?/g, "\n"), bom, eol };
}

/** Encodes text for writing back: original bytes while unchanged, otherwise UTF-8 with the original BOM and line ending. */
export function encodeText(text, source = {}) {
  if (source.original && source.snapshot === text) return source.original;
  const out = source.eol === "crlf" ? text.replace(/\n/g, "\r\n") : source.eol === "cr" ? text.replace(/\n/g, "\r") : text; // "mixed" is written as LF once edited
  const body = new TextEncoder().encode(out);
  if (!source.bom) return body;
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(body, 3);
  return withBom;
}

/**
 * The source info for a document that was just created from `file`. Returns null for files that are not a source
 * (.ofini documents, unknown content).
 * @param {{ name: string, path?: string, handle?: object, bytes?: Uint8Array }} file
 * @param {object} doc the document created from it (studio, office, web decide the kind)
 */
export function describeSource(file, doc) {
  const name = String(file?.name || "");
  const ext = extOf(name);
  if (!name || !doc || ext === "ofini") return null;
  const where = { name, ...(file.path ? { path: file.path } : {}), ...(file.handle ? { handle: file.handle } : {}) };
  if (doc.office && OFFICE_WRITE[ext]) return { ...where, format: OFFICE_WRITE[ext], kind: "office", officeId: OFFICE_WRITE[ext] };
  if (doc.office) return null;
  if (doc.web && TEXT_FORMATS.includes(ext)) return { ...where, format: ext, kind: "text" }; // traits are filled in by the opener (it decodes the bytes)
  if (ext === "svg" && doc.studio === "vector") return { ...where, format: "svg", kind: "vector" };
  if (IMAGE_FORMATS.includes(ext)) return { ...where, format: ext, kind: "image" };
  if (ext) return { ...where, format: ext, kind: "foreign" };
  return null;
}

/** Why a vector document cannot be written as SVG, or null when the exporter represents it faithfully. */
export function vectorBlocker(doc) {
  if (doc.pages.length !== 1) return "it has more than one page";
  if (doc.masters?.some((m) => m.root?.children?.length)) return "it uses master pages";
  let why = null;
  const visit = (n) => {
    if (why || n === doc.pages[0].root) return;
    if (!VECTOR_NODE_TYPES.has(n.type)) why = `it contains ${n.type === "pixel" ? "pixel layers" : n.type === "adjust" ? "adjustment layers" : `${n.type} objects`}`;
    else if (n.mask) why = "it uses masks";
    else if ((n.fx || []).some((f) => f.enabled !== false)) why = "it uses live effects";
    else if (n.blend && n.blend !== "normal") why = "it uses blend modes";
  };
  const walkTree = (node) => {
    for (const c of node.children || []) {
      visit(c);
      if (why) return;
      walkTree(c);
    }
  };
  walkTree(doc.pages[0].root);
  return why;
}

/** Why a code project is no longer the single text file it was opened as, or null. */
export function textBlocker(doc, source) {
  const web = doc.web;
  if (!web) return "the project is gone";
  const paths = [...web.files.keys()];
  if (paths.length !== 1) return "the project has more than one file";
  const f = web.files.get(paths[0]);
  if (typeof f?.text !== "string") return "the file is not text any more";
  if (source.entry && paths[0] !== source.entry) return "the file was renamed";
  if (doc.pages.length !== 1 || doc.pages[0].root.children?.length) return "it has design pages";
  if (Object.keys(doc.assets || {}).length) return "it has images attached";
  if (web.gitFiles) return "it has a Git repository";
  return null;
}

/**
 * Can File ▸ Save still write this document in the format it was opened from?
 * @param {object} doc
 * @param {{ enabled?: boolean }} [o] enabled = the "save opened files in their original format" setting (default on)
 * @returns {{ ok: boolean, ask: boolean, reason: string, format: string|null, kind: string|null, name: string|null, label: string }}
 */
export function canSaveAsSource(doc, { enabled = true } = {}) {
  const s = doc?.source;
  const none = (reason) => ({ ok: false, ask: false, reason, format: s?.format || null, kind: s?.kind || null, name: s?.name || null, label: ".ofini" });
  if (!s) return none("The document was not opened from a file or is already an OpenFini document.");
  if (!enabled) return none("Saving in the original format is turned off in Settings.");
  const yes = (name = s.name) => ({ ok: true, ask: false, reason: "", format: s.format, kind: s.kind, name, label: `.${extOf(name) || s.format}` });
  const lost = (why) => ({ ok: false, ask: true, reason: `${why}`, format: s.format, kind: s.kind, name: s.name, label: ".ofini" });
  switch (s.kind) {
    case "text": {
      const why = textBlocker(doc, s);
      return why ? lost(why) : yes();
    }
    case "office": {
      if (s.officeKind && s.officeKind !== "document") return doc.office?.model && (doc.office.kind || "document") === s.officeKind ? yes() : lost("the document changed its kind");
      if (!doc.office?.model) return lost("the document is no longer a word-processing document");
      const canon = OFFICE_CANONICAL[s.officeId];
      if (!canon) return none("This format cannot be written.");
      // spelling variants (.htm, .markdown, .text) keep their name; anything else would be written under the canonical name
      const keepName = OFFICE_WRITE[extOf(s.name)] === canon && ["docx", "odt", "rtf", "html", "htm", "md", "markdown", "txt", "text"].includes(extOf(s.name));
      return yes(keepName ? s.name : `${baseOf(s.name)}.${canon}`);
    }
    case "vector": {
      const why = vectorBlocker(doc);
      return why ? lost(why) : yes();
    }
    case "image":
    case "foreign":
      return none(`Saving over a .${s.format} file would flatten the document and lose layers or data, so it is saved as .ofini. Use Save As to export a copy as .${s.format}.`);
    default:
      return none("Unknown source format.");
  }
}

/** What Save would write: label for the badge (".txt"), file name, and whether it is the source format. */
export function saveTarget(doc, o = {}) {
  if (!doc) return { label: "", name: "", source: false };
  const d = canSaveAsSource(doc, o);
  if (d.ok) return { label: d.label, name: d.name, source: true };
  return { label: ".ofini", name: `${doc.name}.ofini`, source: false };
}

/** The name a tab shows: the original file name (with extension) while Save writes it, the document name otherwise. */
export function displayName(doc, o = {}) {
  const s = doc?.source;
  return s && o.enabled !== false && s.kind !== "image" && s.kind !== "foreign" ? s.name : doc?.name || "";
}

/** Display-only metadata stored in document.json. */
export function sourceMeta(doc) {
  return doc?.source ? { name: doc.source.name, format: doc.source.format } : undefined;
}

/** The serializable part of a source (autosave sessions): no bytes, no handles. */
export function sourceSnapshot(source) {
  if (!source) return null;
  const { name, path, format, kind, bom, eol, officeId, officeKind, entry } = source;
  return { name, path, format, kind, bom, eol, officeId, officeKind, entry };
}

/**
 * Things the Office writers cannot store in a given format (the model has more than the format can hold).
 * @returns {string[]} short sentences; empty when nothing is lost
 */
export function officeFidelityNotes(model, id) {
  const notes = [];
  if (!model) return notes;
  const blocks = model.blocks || [];
  const inl = (fn) => blocks.some((b) => b.type === "paragraph" && (b.runs || []).some(fn));
  const hasImages = inl((r) => r.type === "image");
  const hasTables = blocks.some((b) => b.type === "table");
  const hasNotes = Object.keys(model.footnotes || {}).length > 0;
  const hasHf = (model.header || []).length > 0 || (model.footer || []).length > 0;
  const styled = inl((r) => r.b || r.i || r.u || r.color || r.font || r.size || r.link) || blocks.some((b) => b.type === "paragraph" && /^Heading|Title|Subtitle|Quote/.test(b.style || ""));
  if (id === "txt") {
    if (styled) notes.push("Formatting is not stored in plain text.");
    if (hasImages) notes.push("Images are left out of plain text.");
    if (hasTables) notes.push("Tables are written as tab-separated rows.");
    if (hasHf) notes.push("Headers and footers are left out of plain text.");
  } else if (id === "md") {
    if (inl((r) => r.color || r.font || r.size || r.highlight)) notes.push("Colors, fonts and sizes are not stored in Markdown.");
    if (hasHf) notes.push("Headers and footers are left out of Markdown.");
    if (hasImages) notes.push("Images are embedded as data URIs in the Markdown text.");
  } else if (id === "rtf" || id === "html") {
    if (hasNotes && id === "html") notes.push("Footnotes are written as end notes.");
    if (hasHf && id === "html") notes.push("Headers and footers are not part of a web page.");
  }
  return notes;
}
