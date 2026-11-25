// Clipboard, drag and drop and file import of the Proto Studio (docs/proto-studio.md ▸ Importing, concept §11, task
// T8). Loaded on the first copy, paste, drop or import (proto/workspace.js and commands/proto.js import() it).
//
//   clipOf(model, ids) → { payload, json, html, text }       Proto layers for the system clipboard: an OpenFini MIME
//                                                             type, HTML carrying the same payload (other apps and
//                                                             browsers keep text/html), plain text (the layer names)
//   writeClipEvent(e, clip) / writeSystemClipboard(clip)      on a copy event / through the async Clipboard API
//   readTransfer(dataTransfer) / readSystemClipboard()        → item: { kind: "proto", payload } | { kind: "svg", text }
//                                                             | { kind: "html", text } | { kind: "files", files } |
//                                                             { kind: "text", text } | null
//   insertItem(ws, app, item, { at? }) → ids                  pastes or imports the item as ONE undo step: into the
//                                                             selected container (its flow when it has auto layout),
//                                                             else at `at` (world point) or the middle of the view
//   importFiles(ws, app, files, { at? }) / chooseAndImport(ws, app) / chooseImages(ws, app, { at? })
// Proto layers keep their media: the payload carries the bytes of the images its layers use (up to 16 MiB in all).
import { t } from "../i18n/index.js";
import { platform } from "../platform/index.js";
import { attachReport } from "../core/import-report.js";
import * as E from "./tools/edit.js";
import { isContainer, field } from "../engine/proto/schema.js";

export const PROTO_MIME = "application/x-openfini-proto+json";
const MARK = "data-openfini-proto";
const MEDIA_BUDGET = 16 * 1048576;
const engine = () => import("../engine/proto/import/index.js");

const b64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8b64 = (s) => b64(new TextEncoder().encode(s));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The clipboard forms of Proto layers. */
export function clipOf(model, ids) {
  const payload = E.copyNodes(model, ids);
  const media = {};
  let budget = MEDIA_BUDGET;
  for (const n of payload.nodes) for (const f of n.fills || []) {
    const m = f?.type === "image" ? model.media?.[f.media] : null;
    if (!m?.bytes || media[f.media] || m.bytes.length > budget) continue;
    budget -= m.bytes.length;
    media[f.media] = { mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), data: b64(m.bytes) };
  }
  const full = { ...payload, media };
  const json = JSON.stringify(full);
  const names = payload.roots.map((id) => payload.nodes.find((n) => n.id === id)?.name || "").filter(Boolean);
  return { payload: full, json, html: `<meta charset="utf-8"><div ${MARK}="${utf8b64(json)}">${esc(names.join(", "))}</div>`, text: names.join("\n") };
}

export function writeClipEvent(e, clip) {
  e.clipboardData.setData("text/plain", clip.text);
  e.clipboardData.setData("text/html", clip.html);
  try {
    e.clipboardData.setData(PROTO_MIME, clip.json);
  } catch {
    /* custom types are optional */
  }
}

export async function writeSystemClipboard(clip) {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([clip.html], { type: "text/html" }), "text/plain": new Blob([clip.text], { type: "text/plain" }) })]);
    return true;
  } catch {
    return false;
  }
}

/** The Proto payload inside clipboard HTML (null when the HTML did not come from Proto). */
export function payloadFromHtml(html) {
  const m = new RegExp(`${MARK}="([A-Za-z0-9+/=]+)"`).exec(String(html || ""));
  if (!m) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64(m[1])));
    return p?.kind === "openfini/proto-layers" ? p : null;
  } catch {
    return null;
  }
}

/** True when text starts with an <svg> element (after an XML declaration and comments). */
function looksSvg(text) {
  let s = String(text || "").trimStart();
  if (s.startsWith("<?xml")) s = s.slice(s.indexOf(">") + 1).trimStart();
  for (let i = 0; i < 32 && s.startsWith("<!--"); i++) {
    const end = s.indexOf("-->");
    if (end < 0) return false;
    s = s.slice(end + 3).trimStart();
  }
  return /^<svg[\s>]/i.test(s);
}

function classify({ proto, html, text, svg, files }) {
  if (proto) {
    try {
      const p = JSON.parse(proto);
      if (p?.kind === "openfini/proto-layers") return { kind: "proto", payload: p };
    } catch {
      /* fall through */
    }
  }
  const fromHtml = payloadFromHtml(html);
  if (fromHtml) return { kind: "proto", payload: fromHtml };
  if (svg && looksSvg(svg)) return { kind: "svg", text: svg };
  if (files?.length) return { kind: "files", files };
  if (text && looksSvg(text)) return { kind: "svg", text };
  if (html && html.trim()) {
    // design tools put SVG inside clipboard HTML
    const inner = /<svg[\s\S]*<\/svg>/i.exec(html);
    // only tags and whitespace around it: the clipboard holds just the SVG (a test, nothing is stripped)
    if (inner && /^(?:\s|<[^<>]*>)*$/.test(html.replace(inner[0], ""))) return { kind: "svg", text: inner[0] };
    return { kind: "html", text: html };
  }
  if (text && text.trim()) return { kind: "text", text };
  return null;
}

/** What a paste event or a drop carries. */
export async function readTransfer(dt) {
  if (!dt) return null;
  const get = (type) => {
    try {
      return dt.getData(type) || "";
    } catch {
      return "";
    }
  };
  // the strings first: a DataTransfer is only readable while its event runs (File objects stay readable)
  const parts = { proto: get(PROTO_MIME), html: get("text/html"), text: get("text/plain"), svg: get("image/svg+xml") };
  const list = [...(dt.files || [])];
  parts.files = [];
  for (const f of list) parts.files.push({ name: f.name || "Pasted", bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type });
  return classify(parts);
}

/** What the system clipboard holds (asks the browser; null when access is refused). */
export async function readSystemClipboard() {
  if (!navigator.clipboard?.read) {
    const text = await navigator.clipboard?.readText?.().catch(() => "");
    return classify({ text });
  }
  const parts = { files: [] };
  for (const item of await navigator.clipboard.read()) {
    for (const type of item.types) {
      const blob = await item.getType(type);
      if (type === "text/html") parts.html = await blob.text();
      else if (type === "text/plain") parts.text = await blob.text();
      else if (type === "image/svg+xml") parts.svg = await blob.text();
      else if (type.startsWith("image/")) parts.files.push({ name: "Pasted image", bytes: new Uint8Array(await blob.arrayBuffer()), mime: type });
      else if (type === PROTO_MIME || type === `web ${PROTO_MIME}`) parts.proto = await blob.text();
    }
  }
  return classify(parts);
}

// ------------------------------------------------------------------------------------------------ inserting

/** Where inserted layers go: the selected container, else the page at `at` (default: the middle of the view). */
function target(ws, at, size = { w: 0, h: 0 }) {
  const m = ws.model();
  const sel = ws.selection.map((id) => m.nodes[id]).filter(Boolean);
  if (sel.length === 1 && isContainer(sel[0].type) && sel[0].type !== "instance" && sel[0].type !== "componentSet" && !at) {
    const lt = field(sel[0], "layout")?.type;
    const flow = lt === "flex" || lt === "grid";
    const pb = ws.box(sel[0].id);
    return { page: sel[0].page, parent: sel[0].id, flow, at: flow ? null : [Math.max(0, Math.round((pb?.w || 0) / 2 - size.w / 2)), Math.max(0, Math.round((pb?.h || 0) / 2 - size.h / 2))], width: sel[0].w?.mode === "fixed" ? sel[0].w.value : null };
  }
  let point = at;
  if (!point) {
    const c = ws.toWorld(ws.view.size.w / 2, ws.view.size.h / 2);
    point = { x: c.x - size.w / 2, y: c.y - size.h / 2 };
  }
  // a drop onto a frame goes into that frame
  if (at) {
    const hit = ws.pickAt ? ws.pickAt(...stagePoint(ws, at), { deep: true }) : null;
    const hitNode = hit ? m.nodes[hit] : null;
    const box = hitNode ? ws.box(hitNode.id) : null;
    if (hitNode && isContainer(hitNode.type) && hitNode.type !== "instance" && hitNode.type !== "componentSet" && box) {
      const lt = field(hitNode, "layout")?.type;
      const flow = lt === "flex" || lt === "grid";
      return { page: hitNode.page, parent: hitNode.id, flow, at: flow ? null : [Math.round(at.x - box.x), Math.round(at.y - box.y)], width: hitNode.w?.mode === "fixed" ? hitNode.w.value : null };
    }
  }
  return { page: ws.page, parent: null, flow: false, at: [Math.round(point.x), Math.round(point.y)], width: null };
}
const stagePoint = (ws, w) => {
  const s = ws.toStage(w.x, w.y);
  return [s.x, s.y];
};

function announce(app, report) {
  if (!report) return;
  if (app.doc) attachReport(app.doc, report);
  if (report.attention) app.toast(t("Imported: {summary}.", { summary: report.summary() }), "primary", 6000, { label: t("Details"), run: () => app.run("file.importReport") });
}

/** Runs an import result as one undo step and selects what it created. */
async function commit(ws, app, result, where, label) {
  const { applyImport } = await engine();
  const ops = applyImport(result, { page: where.page, parent: where.parent, at: where.at, flow: where.flow });
  const out = ws.apply(ops.length === 1 ? ops[0] : { op: "batch", ops }, label);
  if (!out) return [];
  const top = result.roots.filter((id) => ws.model().nodes[id]?.page === ws.page);
  if (top.length) ws.select(top);
  else if (result.pages.length) ws.setPage(result.pages[0]);
  announce(app, result.report);
  return result.roots;
}

/** Pastes or imports one clipboard or drop item. */
export async function insertItem(ws, app, item, { at = null } = {}) {
  if (!item || ws.readOnly) return [];
  const I = await engine();
  const model = ws.model();
  if (item.kind === "proto") {
    const p = item.payload;
    const media = [];
    for (const [id, m] of Object.entries(p.media || {})) if (!model.media?.[id] && m?.data) media.push({ op: "media.put", id, media: { mime: m.mime, name: m.name || "", ...(m.w ? { w: m.w, h: m.h } : {}), bytes: unb64(m.data) } });
    const where = target(ws, at);
    const src = p.nodes.filter((n) => p.roots.includes(n.id));
    const offset = where.parent && where.flow ? [0, 0] : [where.at[0] - Math.min(...src.map((n) => n.x ?? 0)), where.at[1] - Math.min(...src.map((n) => n.y ?? 0))];
    // layers of this design without a place to go: next to the originals, as before (proto/workspace.js)
    if (!at && !where.parent && p.roots.every((id) => model.nodes[id])) return ws.pasteLocal(p)?.ids || [];
    const res = E.pasteNodes(model, p, { parent: where.parent, page: where.page, offset });
    if (!res) return [];
    const out = ws.apply(media.length ? { op: "batch", ops: [...media, res.op] } : res.op, t("Paste"));
    if (out) ws.select(res.ids);
    return out ? res.ids : [];
  }
  if (item.kind === "files") return importFiles(ws, app, item.files, { at });
  if (item.kind === "text") {
    const where = target(ws, at, { w: 200, h: 24 });
    const res = { ops: [{ op: "node.create", type: "text", fields: { name: item.text.trim().slice(0, 40) || t("Text"), x: 0, y: 0, text: { runs: [{ t: item.text.slice(0, 100000), s: {} }], style: { font: "Inter", size: 16, weight: 400, lineHeight: { pct: 150 }, tracking: 0, align: "left", color: "#18181b" }, autoSize: "width", maxLines: null } } }], roots: [], pages: [], report: null };
    const { applyImport } = I;
    const ops = applyImport(res, where);
    const out = ws.apply(ops[0], t("Paste text"));
    if (out?.ids?.[0]) ws.select([out.ids[0]]);
    return out?.ids || [];
  }
  const where = target(ws, at);
  let result;
  try {
    if (item.kind === "svg") result = I.importInto(model, { name: t("Pasted SVG"), text: item.text, from: "svg" });
    else {
      const width = where.width || 1280;
      const { probeHtml } = await import("./html-probe.js");
      const probe = await probeHtml(item.text, { width });
      result = I.importInto(model, { name: t("Pasted HTML"), text: item.text, from: "html", probe, width });
      if (probe?.truncated) result.report.dropped(t("The page was too large; only its first 20 000 elements were imported."));
    }
  } catch (err) {
    app.toast(err.message, "danger", 6000);
    return [];
  }
  return commit(ws, app, result, target(ws, at, result.size), item.kind === "svg" ? t("Paste SVG") : t("Paste HTML"));
}

/** Imports files (drop, File ▸ Import into Proto): HTML, SVG, Sketch, Penpot, images. */
export async function importFiles(ws, app, files, { at = null } = {}) {
  const I = await engine();
  const ids = [];
  let k = 0;
  for (const f of files) {
    let result;
    try {
      const fmt = I.detectFormat(f.name, f.bytes);
      let probe = null;
      if (fmt === "html") {
        const { probeHtml } = await import("./html-probe.js");
        probe = await probeHtml(new TextDecoder().decode(f.bytes), { width: 1280 });
      }
      result = fmt === "image" ? I.importImage(ws.model(), { bytes: f.bytes, mime: f.mime, name: f.name }) : I.importInto(ws.model(), { name: f.name, bytes: f.bytes, probe });
    } catch (err) {
      app.toast(t("“{name}” could not be imported: {reason}", { name: f.name, reason: err.message }), "danger", 7000);
      continue;
    }
    const p = at ? { x: at.x + k * 24, y: at.y + k * 24 } : null;
    k++;
    ids.push(...(await commit(ws, app, result, target(ws, p, result.size), t("Import “{name}”", { name: f.name }))));
  }
  return ids;
}

const ACCEPT = [{ description: "Designs and images", extensions: ["html", "htm", "svg", "sketch", "penpot", "png", "jpg", "jpeg", "gif", "webp", "avif"] }];

/** File ▸ Import into Proto. */
export async function chooseAndImport(ws, app) {
  const files = await platform.openFiles({ accept: ACCEPT, multiple: true });
  if (files?.length) return importFiles(ws, app, files);
  return [];
}

/** The Image tool: choose pictures and place them (at a world point, or in the middle of the view). */
export async function chooseImages(ws, app, { at = null } = {}) {
  const files = await platform.openFiles({ accept: [{ description: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }], multiple: true });
  if (!files?.length) return [];
  return importFiles(ws, app, files.map((f) => ({ ...f, name: f.name })), { at });
}
