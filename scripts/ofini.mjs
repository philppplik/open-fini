#!/usr/bin/env node
// Minimal headless `ofini` command (ADR 0024, first slice): inspects .ofini documents without starting the app.
//
//   node scripts/ofini.mjs info <file.ofini> [--json]       pages, layers by type, assets, website and Office parts
//   node scripts/ofini.mjs validate <file.ofini> [--json]   container, content and asset checks; exit code 1 on errors
//   node scripts/ofini.mjs --help | --version
//
// Read-only and offline: it never writes the file and never opens a network connection. Dependency-free apart from
// the vendored fflate and the format migration table the app itself uses (app/src/core/ofini-migrate.js).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "../app/vendor/fflate/fflate.js";
import { migrateDocumentJson, FORMAT_VERSION } from "../app/src/core/ofini-migrate.js";

const MIME = "application/vnd.openfini+zip";
const USAGE = `ofini - inspect OpenFini documents (read-only)

Usage:
  ofini info <file.ofini> [--json]
  ofini validate <file.ofini> [--json]

Options:
  --json         Machine-readable output
  -h, --help     Print this help
  -V, --version  Print the version
`;

/** Counts layers by type in the page trees (any object with a string type and an id below a page). */
function countLayers(pages) {
  const byType = {};
  let total = 0;
  const visit = (n, depth) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((x) => visit(x, depth));
    if (depth > 0 && typeof n.type === "string" && n.id != null) {
      byType[n.type] = (byType[n.type] || 0) + 1;
      total++;
    }
    for (const [k, v] of Object.entries(n)) if (v && typeof v === "object" && k !== "style" && k !== "mask") visit(v, depth + 1);
  };
  for (const p of pages || []) for (const [k, v] of Object.entries(p)) if (v && typeof v === "object" && k !== "bg") visit(v, 1);
  return { total, byType };
}

/** Reads and checks a document. Returns { info, errors, warnings } and never throws for bad input. */
export function inspect(bytes, name = "document.ofini") {
  const errors = [];
  const warnings = [];
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { info: { name }, errors: ["Not a valid OpenFini document (the ZIP container cannot be read)."], warnings };
  }
  const mime = entries.mimetype ? strFromU8(entries.mimetype) : "";
  if (mime !== MIME) warnings.push(mime ? `Unexpected mimetype “${mime}”.` : "The mimetype entry is missing.");
  if (!entries["document.json"]) return { info: { name }, errors: ["The document content (document.json) is missing."], warnings };
  let json;
  try {
    json = JSON.parse(strFromU8(entries["document.json"]));
  } catch {
    return { info: { name }, errors: ["document.json is damaged and cannot be parsed."], warnings };
  }
  if (json.format !== "openfini") errors.push("document.json does not declare format “openfini”.");
  let mig = { json, notes: [], newer: false };
  try {
    mig = migrateDocumentJson(structuredClone(json));
  } catch (e) {
    errors.push(`The format upgrade failed: ${e.message}`);
  }
  if (mig.newer) warnings.push(`Written by a newer OpenFini (format ${json.version}); this tool knows format ${FORMAT_VERSION}.`);
  const doc = mig.json || json;
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  if (!pages.length) errors.push("The document has no pages.");
  const assets = Object.values(doc.assets || {});
  const files = Object.keys(entries);
  for (const a of assets) if (a?.id && !files.some((f) => f.startsWith(`assets/${a.id}.`)) && !a.url) warnings.push(`Asset ${a.id} (${a.name || a.mime || "unnamed"}) has no stored bytes.`);
  const layers = countLayers(pages);
  const info = {
    name,
    title: doc.name || "",
    format: json.version ?? null,
    studio: doc.studio || "",
    unit: doc.unit || "",
    pages: pages.map((p) => ({ name: p.name || "", width: p.w, height: p.h })),
    layers,
    assets: assets.length,
    pixelLayers: files.filter((f) => f.startsWith("pixels/")).length,
    websiteFiles: files.filter((f) => f.startsWith("web/")).length,
    office: doc.office?.kind || null,
    thumbnail: !!entries["thumbnail.png"],
    upgradeNotes: mig.notes || [],
  };
  return { info, errors, warnings };
}

function printInfo({ info, errors, warnings }) {
  const lines = [`${info.name}${info.title ? ` — “${info.title}”` : ""}`];
  if (info.pages) {
    lines.push(`  format ${info.format ?? "?"}, studio ${info.studio || "?"}, unit ${info.unit || "?"}`);
    lines.push(`  ${info.pages.length} page(s): ${info.pages.slice(0, 8).map((p) => `${p.width}×${p.height}`).join(", ")}${info.pages.length > 8 ? ", …" : ""}`);
    lines.push(`  ${info.layers.total} layer(s)${info.layers.total ? `: ${Object.entries(info.layers.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}`);
    lines.push(`  ${info.assets} asset(s), ${info.pixelLayers} pixel image(s)${info.websiteFiles ? `, ${info.websiteFiles} website file(s)` : ""}${info.office ? `, Office ${info.office}` : ""}`);
  }
  for (const w of warnings) lines.push(`  warning: ${w}`);
  for (const e of errors) lines.push(`  error: ${e}`);
  return lines.join("\n");
}

/** Runs the command; returns { code, out } (exported for tests). */
export function run(argv, { readFile = readFileSync, version = "" } = {}) {
  const args = argv.filter((a) => a !== "--json");
  const json = argv.includes("--json");
  const [cmd, file] = args;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") return { code: cmd ? 0 : 2, out: USAGE };
  if (cmd === "-V" || cmd === "--version") return { code: 0, out: `ofini ${version}` };
  if (cmd !== "info" && cmd !== "validate") return { code: 2, out: `Unknown command “${cmd}”.\n\n${USAGE}` };
  if (!file) return { code: 2, out: `Missing file.\n\n${USAGE}` };
  let bytes;
  try {
    bytes = new Uint8Array(readFile(file));
  } catch (e) {
    return { code: 1, out: `Cannot read ${file}: ${e.code || e.message}` };
  }
  const r = inspect(bytes, basename(file));
  const code = r.errors.length ? 1 : 0;
  if (json) return { code, out: JSON.stringify(cmd === "validate" ? { ok: !code, errors: r.errors, warnings: r.warnings } : r, null, 2) };
  if (cmd === "validate") return { code, out: code ? printInfo({ info: { name: r.info.name }, errors: r.errors, warnings: r.warnings }) : `${r.info.name}: ok${r.warnings.length ? ` (${r.warnings.length} warning(s))\n${r.warnings.map((w) => `  warning: ${w}`).join("\n")}` : ""}` };
  return { code, out: printInfo(r) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const r = run(process.argv.slice(2), { version: pkg.version });
  (r.code === 0 ? process.stdout : process.stderr).write(`${r.out}\n`);
  process.exitCode = r.code;
}
