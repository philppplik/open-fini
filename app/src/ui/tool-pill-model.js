// Tool pill model: decides what the floating "context pill" at the bottom of the canvas says and offers. Pure (no DOM),
// unit-tested in tests/ui/tool-pill.test.js. The DOM side is ui/tool-pill.js. See docs/studios.md ▸ Tool pill.
//
// Input snapshot (all optional):
//   enabled        pref "Show the tool pill"
//   studio         "pixel" | "vector" | "layout" | ...
//   hasDoc         a document is open
//   tool           { id, label, pill }  where pill = the tool's `pillState()` result or null:
//                  { text, actions: [{ id, label, command?, key?, primary? }] }  (an in-progress, modal-like state)
//   mask           { width, height, bounds: { x, y, width, height } } | null   pixel selection
//   selectionCount number of selected layers/objects
//   activeName     name of the single selected layer (optional)
// Output: null (hide) or { kind: "tool"|"pixel-selection"|"layers", text, actions }.
// Action: { id, label, command?, key?, primary?, icon? }. `command` ids run through app.run; tool actions are run by the
// owner through `id` (see tool-pill.js).

/** Pixel-selection actions: reuse the existing commands (select.none, select.invert, select.feather, select.toMask, fill). */
export const PIXEL_SELECTION_ACTIONS = [
  { id: "deselect", label: "Deselect", command: "select.none", key: "Mod+D", primary: true },
  { id: "invert", label: "Invert", command: "select.invert", key: "Mod+Shift+I" },
  { id: "feather", label: "Feather…", command: "select.feather" },
  { id: "tomask", label: "To layer mask", command: "select.toMask" },
  { id: "fill", label: "Fill", command: "pixel.fillForeground", key: "Alt+Backspace" },
];

const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** @param {object} snap @returns {null | {kind: string, text: string, actions: object[]}} */
export function buildPillModel(snap = {}) {
  if (!snap.enabled || !snap.hasDoc) return null;
  // 1. a tool in a modal-like state (transform, crop, liquify, a path being drawn, text editing)
  const p = snap.tool?.pill;
  if (p && Array.isArray(p.actions) && p.actions.length) return { kind: "tool", ...(p.key ? msg(p.key, p.params) : { key: p.text || snap.tool.label || "", params: {}, text: p.text || snap.tool.label || "" }), actions: p.actions };
  // 2. an active pixel selection (marquee, lasso, wand, color range)
  const b = snap.mask?.bounds;
  if (snap.studio === "pixel" && snap.mask && b && b.width > 0 && b.height > 0) {
    return { kind: "pixel-selection", ...msg("Selection active · {w} × {h} px", { w: fmt(b.width), h: fmt(b.height) }), actions: PIXEL_SELECTION_ACTIONS };
  }
  // 3. a layer / object selection
  const n = snap.selectionCount | 0;
  if (n > 0 && ["pixel", "vector", "layout"].includes(snap.studio)) {
    const m = n === 1 ? (snap.activeName ? msg("{name} selected", { name: snap.activeName }) : msg("1 object selected")) : msg("{n} objects selected", { n });
    return { kind: "layers", ...m, actions: [{ id: "deselect", label: "Deselect", command: "edit.deselect", key: "Mod+D", primary: true }] };
  }
  return null;
}

/** An i18n message: `key` + `params` for t(), and the interpolated English `text` (tests, Vibe, aria fallbacks). */
function msg(key, params = {}) {
  return { key, params, text: key.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) };
}

/** Stable string for change detection (avoids re-rendering the pill on every overlay request). */
export const pillSignature = (m) => (m ? `${m.kind}|${m.text}|${m.actions.map((a) => a.id).join(",")}` : "");
