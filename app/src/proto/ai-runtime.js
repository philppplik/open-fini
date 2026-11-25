// Proto Studio runtime of the assistant's tools (vibe/tools/proto.js, task T11): the parts the pure modules
// (proto/ai-ops.js, proto/ai-render.js, engine/proto/lint.js) cannot do: find the active design and commit operations
// as ONE undo step, paint images, decode attached pictures, sample their colors and read their text (OCR engine of
// the engine registry, local engines only). Loaded on the first Proto tool call.
//
//   protoTarget(app) → { doc, ws, info, model(), page, selection, run(ops, label) → result | null }
//       run applies the operations as one batch through the open workspace (app.protoUI ▸ run, the same path as the
//       editor's tools) or, while the design is not mounted, through the same undo step recipe on the document
//       history; the label is "Vibe: <label>". Throws the engine's OpError (nothing changes) on invalid input.
//   renderImage(target, id, { scale, maxSize, compare? }) → tool content (text + PNG), with a pixel difference to a
//       reference image when `compare` names an image layer or media id
//   readImage(file) → { bytes, mime, w, h }
//   imageHints(bytes, mime, { colors, ocr }) → { palette, text? }
import { isProto } from "./host.js";
import { ensureProto } from "./workspace.js";
import { opStep } from "./controller.js";
import { paintList, paintCanvas } from "./ai-render.js";
import { pageList } from "../engine/proto/tree.js";

/** The active design and its commit (see the header). */
export function protoTarget(app) {
  const doc = app.doc;
  if (!isProto(doc)) throw new Error("The active document is not a Proto design. Create one with proto_new, or switch to a design. (Proto Studio is a Labs preview: Settings ▸ Labs ▸ Proto Studio.)");
  const prj = doc.office;
  const info = ensureProto(prj);
  const ws = app.protoUI && app.protoUI.doc === doc ? app.protoUI : null;
  const firstPage = () => {
    const m = prj.model;
    const p = prj.view?.proto?.page;
    return p && m.pages[p] ? p : pageList(m)[0]?.id;
  };
  return {
    doc,
    ws,
    info,
    model: () => prj.model,
    get page() {
      return ws ? ws.page : firstPage();
    },
    get selection() {
      return ws ? ws.selection.slice() : [];
    },
    run(ops, label) {
      if (info.readOnly) throw new Error("This design is read-only (saved by a newer version or with problems); it cannot be changed.");
      const list = (Array.isArray(ops) ? ops : [ops]).filter(Boolean);
      if (!list.length) return null;
      const op = list.length === 1 ? list[0] : { op: "batch", ops: list };
      const name = `Vibe: ${label}`;
      if (ws) return ws.run(op, name);
      // the design is not mounted: the same undo step as the workspace's controller (proto/workspace.js ▸ commit)
      const step = opStep(prj.model, op);
      if (!step) return null;
      doc.tx(name, () =>
        doc._do({
          redo: () => prj.set(step.redo(prj.model), { origin: "redo", label: name }),
          undo: () => prj.set(step.undo(prj.model), { origin: "undo", label: name }),
          meta: true,
          bytes: 256,
        }),
      );
      return step.result;
    },
  };
}

// ---------------------------------------------------------------------------------------------- images

const canRender = () => typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
function canvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
async function toBase64(cv) {
  const blob = cv.convertToBlob ? await cv.convertToBlob({ type: "image/png" }) : await new Promise((r) => cv.toBlob(r, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const decode = (bytes, mime) => createImageBitmap(new Blob([bytes], { type: mime || "image/png" }));

/** Renders a layer to a PNG for the model (see the header). */
export async function renderImage(target, id, { scale = 1, maxSize = 1200, compare = null } = {}) {
  if (!canRender()) throw new Error("Rendering needs the app window.");
  const model = target.model();
  let measurer;
  try {
    measurer = (await import("../core/fonts.js")).measurer;
    await globalThis.document?.fonts?.ready;
  } catch {
    measurer = undefined;
  }
  const list = paintList(model, id, { measurer });
  const s = Math.max(0.05, Math.min(scale, maxSize / Math.max(list.w, list.h)));
  const W = Math.max(1, Math.round(list.w * s));
  const H = Math.max(1, Math.round(list.h * s));
  const images = new Map();
  for (const it of list.items)
    for (const f of it.fills || [])
      if (f.type === "image" && !images.has(f.media)) {
        const m = model.media?.[f.media];
        if (m?.bytes) images.set(f.media, await decode(m.bytes, m.mime).catch(() => null));
      }
  const node = model.nodes[id];
  const bg = node.parent == null && !(node.fills || []).length ? (typeof model.pages[node.page]?.bg === "string" ? model.pages[node.page].bg : "#ffffff") : null;
  let ref = null;
  if (compare) {
    const mediaId = model.media?.[compare] ? compare : (model.nodes[compare]?.fills || []).find((f) => f?.type === "image")?.media;
    const m = mediaId && model.media?.[mediaId];
    if (!m?.bytes) throw new Error(`“${compare}” is neither an image layer nor a media id of this design.`);
    ref = await decode(m.bytes, m.mime);
  }
  const cv = canvas(ref ? W * 2 + 16 : W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  paintCanvas(ctx, list, { scale: s, images, background: bg });
  const label = `${node.name || node.type} (${id}), ${Math.round(list.w)} × ${Math.round(list.h)} px at ${Math.round(s * 100)} %; approximate render of the layout solver (fonts and effects may differ slightly from the canvas)`;
  if (!ref) return [{ type: "text", text: label }, { type: "image", mime: "image/png", data: await toBase64(cv) }];
  ctx.drawImage(ref, W + 16, 0, W, H);
  // mean absolute difference of the two halves (the render is on the left, the reference on the right)
  const a = ctx.getImageData(0, 0, W, H).data;
  const b = ctx.getImageData(W + 16, 0, W, H).data;
  let sum = 0;
  let px = 0;
  for (let i = 0; i < a.length; i += 16) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    px++;
  }
  const diff = Math.round((sum / (px * 3 * 255)) * 1000) / 10;
  return [{ type: "text", text: `${label}. Left: the design; right: the reference. Mean pixel difference ${diff} % (lower is closer; compare layout, sizes and colors, not exact pixels).` }, { type: "image", mime: "image/png", data: await toBase64(cv) }];
}

/** Bytes, type and size of an attached picture. */
export async function readImage(f) {
  const file = f.file || f;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = (f.type || file.type || "").split(";")[0] || sniff(bytes);
  const dims = imageSize(bytes);
  return { bytes, mime, name: f.name || file.name || "image", ...dims };
}

const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x47 && b[1] === 0x49 ? "image/gif" : b[8] === 0x57 && b[9] === 0x45 ? "image/webp" : "");

/** Width and height from a PNG, JPEG or GIF header (pure), or {}. */
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0x47 && b[1] === 0x49 && b.length > 10) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return {};
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return {};
}

/** Dominant colors (and with `ocr`, recognized text) of a picture, as hints for rebuilding it. */
export async function imageHints(bytes, mime, { colors = 8, ocr = true } = {}) {
  if (!canRender()) return { palette: [], note: "Colors and text are read in the app window only." };
  const bmp = await decode(bytes, mime);
  const k = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const cv = canvas(w, h);
  const g = cv.getContext("2d");
  g.drawImage(bmp, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const { quantize } = await import("../engine/export/quantize.js");
  const q = quantize(data, w, h, { colors });
  const counts = new Map();
  for (let i = 0; i < q.indices.length; i++) counts.set(q.indices[i], (counts.get(q.indices[i]) || 0) + 1);
  const hex = (i) => `#${[0, 1, 2].map((c) => q.palette[i * 4 + c].toString(16).padStart(2, "0")).join("")}`;
  const palette = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([i, n]) => ({ color: hex(i), share: Math.round((n / q.indices.length) * 1000) / 10 }));
  const out = { palette };
  if (ocr) {
    try {
      const [{ engines }, { ensureBuiltinEngines }] = await Promise.all([import("../platform/engines.js"), import("../platform/builtin-engines.js")]);
      ensureBuiltinEngines(engines);
      const e = engines.pick("ocr", { local: true });
      if (e) {
        const full = canvas(bmp.width, bmp.height);
        const fg = full.getContext("2d");
        fg.drawImage(bmp, 0, 0);
        const img = fg.getImageData(0, 0, bmp.width, bmp.height);
        const r = await e.recognize({ width: img.width, height: img.height, data: img.data }, {});
        out.text = String(r?.text || "").slice(0, 4000);
        out.ocr = e.label || e.id;
      } else out.ocrNote = "No local text recognition engine is installed; read the text from the image yourself.";
    } catch (err) {
      out.ocrNote = `Text recognition failed: ${err?.message || err}`;
    }
  }
  return out;
}
