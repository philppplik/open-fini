// Vibe tools for the Code studio's view controls: the preview viewport (pixel-exact size, presets), measuring
// elements in the live preview, and the split layout. They drive the same PreviewPane / CodeWorkspace methods as the
// toolbar, so what the assistant does is visible (and undoable by hand) for the user.
import { tool, S } from "./helpers.js";
import { DEVICE_PRESETS, UNITS, LAYOUTS, describeBox, VIEWPORT_LIMITS } from "../../engine/web/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const LAYOUT_NAMES = { left: "codeLeft", right: "codeRight", top: "codeTop", bottom: "codeBottom", auto: "auto" };

export function webViewTools(app) {
  /** The built Code studio workspace of the active website document (opening the studio when needed). */
  async function workspace() {
    const doc = app.doc;
    if (!doc?.web) throw new Error("The active document has no website project. Use create_website first.");
    const home = app.studio;
    if (home !== "code" && !(app.codeUI?.built && app.codeUI.doc === doc)) app.setStudio("code");
    for (let i = 0; i < 100; i++) {
      const ws = app.codeUI;
      if (ws?.built && ws.doc === doc) {
        if (home === "vibe" && app.studio !== "vibe") app.setStudio("vibe");
        return ws;
      }
      await sleep(50);
    }
    if (home === "vibe") app.setStudio("vibe");
    throw new Error("The Code studio did not finish loading.");
  }
  const state = (ws) => {
    const v = ws.preview.viewport();
    return { width: v.width, height: v.height, heightAuto: v.heightAuto, zoom: ws.preview.zoomSetting === "fit" ? "fit" : r2(ws.preview.zoomSetting), scale: r2(v.scale), breakpoint: v.breakpoint, layout: ws.layout, layoutChoice: ws.layoutChoice };
  };

  return [
    tool("set_viewport", "Sets the size of the website preview in CSS pixels (width and/or height), or picks a device preset. The matching breakpoint follows the width, so style edits made afterwards go to that breakpoint's @media block. Use it to check a page at a specific width, e.g. 390x844.", {
      width: S.num(`Viewport width in CSS px (${VIEWPORT_LIMITS.min}-${VIEWPORT_LIMITS.max})`, { minimum: VIEWPORT_LIMITS.min, maximum: VIEWPORT_LIMITS.max }),
      height: S.num(`Viewport height in CSS px (${VIEWPORT_LIMITS.min}-${VIEWPORT_LIMITS.max})`, { minimum: VIEWPORT_LIMITS.min, maximum: VIEWPORT_LIMITS.max }),
      heightAuto: S.bool("true = let the preview fill the available height instead of a fixed height"),
      preset: S.str("Device preset id (sets width and height)", { enum: DEVICE_PRESETS.map((p) => p.id) }),
      rotate: S.bool("Swap width and height after applying the rest"),
    }, [], async (a) => {
      const ws = await workspace();
      const pv = ws.preview;
      if (ws.view === "code") ws.setView("split");
      if (a.preset) {
        const p = DEVICE_PRESETS.find((x) => x.id === a.preset);
        if (!p) throw new Error(`Unknown preset “${a.preset}”. Presets: ${DEVICE_PRESETS.map((x) => x.id).join(", ")}.`);
        pv.setSize(p.w, p.h);
      }
      if (a.width != null || a.height != null || a.heightAuto) pv.setSize(a.width ?? undefined, a.heightAuto ? null : a.height ?? undefined);
      if (a.rotate) pv.rotate();
      if (a.width == null && a.height == null && !a.preset && !a.rotate && !a.heightAuto) throw new Error("Pass width, height, heightAuto, preset or rotate.");
      await sleep(120); // let the frame re-layout so that inspect_element / measure_element see the new size
      return state(ws);
    }),

    tool("get_viewport", "Returns the preview viewport (width, height in CSS px, zoom), the active breakpoint (the one style edits write to), the split layout and the width presets and breakpoint markers of the project.", {}, [], async () => {
      const ws = await workspace();
      return { ...state(ws), presets: DEVICE_PRESETS.map((p) => ({ id: p.id, label: p.label, width: p.w, height: p.h })), markers: ws.preview.markers().map((m) => ({ width: m.px, kind: m.kind, label: m.label })) };
    }, { readOnly: true }),

    tool("measure_element", "Measures an element of the live preview (box model: size, margin, border, padding) at the current viewport, in px, mm, cm, in, pt, rem, em or % of the parent. Physical units use 96 dpi unless ppi is given.", {
      id: S.num("Element id (from get_page_outline)"),
      unit: S.str("Unit (default px)", { enum: UNITS }),
      ppi: S.num("Pixels per inch for mm/cm/in/pt (default 96, the CSS reference)", { minimum: 20, maximum: 1000 }),
    }, ["id"], async (a) => {
      const ws = await workspace();
      const box = await ws.preview.measureBox(a.id);
      if (!box) throw new Error("The element is not rendered in the preview (check the id with get_page_outline, or the preview is still loading).");
      const d = describeBox(box, a.unit || "px", { ppi: a.ppi, dpr: 1, dprAware: false });
      const sides = (s) => ({ top: r2(s.top), right: r2(s.right), bottom: r2(s.bottom), left: r2(s.left), text: s.text });
      return {
        tag: d.tag, unit: d.unit, viewport: ws.preview.viewport().width,
        size: { width: r2(d.size.w), height: r2(d.size.h), text: d.size.text },
        margin: sides(d.margin), border: sides(d.border), padding: sides(d.padding),
        px: { width: r2(d.px.w), height: r2(d.px.h), x: r2(d.px.x), y: r2(d.px.y) },
      };
    }, { readOnly: true }),

    tool("set_code_layout", "Chooses how the Code studio's Split view arranges the code editor and the live preview: code left / right of the preview, or above / below it (horizontal split), or auto (code left, stacked when the window is narrow).", {
      layout: S.str("left = code left, preview right; right = preview left, code right; top = code above, preview below; bottom = preview above, code below; auto", { enum: Object.keys(LAYOUT_NAMES) }),
    }, ["layout"], async (a) => {
      const ws = await workspace();
      const choice = LAYOUT_NAMES[a.layout];
      if (!choice || (choice !== "auto" && !LAYOUTS.includes(choice))) throw new Error("layout must be left, right, top, bottom or auto.");
      ws.setLayout(choice);
      return { layout: ws.layout, layoutChoice: ws.layoutChoice };
    }),
  ];
}
