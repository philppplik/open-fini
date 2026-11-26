// The tools of the Proto Studio (docs/concepts/proto-studio.md §5.2) and the toolbar at the bottom of the canvas.
// The workspace (proto/workspace.js) routes pointer input to the current tool: down({ e, stage, world }) → false lets
// the workspace ignore the press; move / up / hover / key(e) / draw(ctx, overlayState) / deactivate(). Single-key
// shortcuts select tools through commands (commands/proto.js), so they show in menus and are customizable.
//
//   createTools(ws) → { el, current, set(id), get(id), list }
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { iconButton } from "../../ui/controls.js";
import { createMoveTool } from "./select.js";
import { createShapeTool, createLineTool, createZoomTool } from "./draw.js";
import { createPenTool } from "./pen.js";
import { createTextTool } from "./text.js";
import { createImageTool } from "./image.js";
import { createConnectTool } from "./connect.js";
import { FRAME_PRESETS } from "./presets.js";
import { createCommentTool } from "../comments.js";

/** Tools in toolbar order: id, icon, label, shortcut. */
export const TOOLS = Object.freeze([
  { id: "move", icon: "cursor", label: N_("Move"), key: "V" },
  { id: "frame", icon: "hash", label: N_("Frame"), key: "F" },
  { id: "rect", icon: "square", label: N_("Rectangle"), key: "R" },
  { id: "ellipse", icon: "circle", label: N_("Ellipse"), key: "O" },
  { id: "line", icon: "slash-lg", label: N_("Line"), key: "L" },
  { id: "pen", icon: "vector-pen", label: N_("Pen"), key: "P" },
  { id: "text", icon: "fonts", label: N_("Text"), key: "T" },
  { id: "image", icon: "image", label: N_("Image"), key: "Shift+Mod+K" },
  { id: "hand", icon: "hand-index", label: N_("Hand"), key: "H" },
  { id: "zoom", icon: "zoom-in", label: N_("Zoom"), key: "Z" },
  { id: "comment", icon: "chat-quote", label: N_("Comment"), key: "C" },
]);

export function createTools(ws) {
  const tools = {
    move: createMoveTool(ws),
    frame: createShapeTool(ws, "frame"),
    rect: createShapeTool(ws, "rect"),
    ellipse: createShapeTool(ws, "ellipse"),
    line: createLineTool(ws),
    pen: createPenTool(ws),
    text: createTextTool(ws),
    image: createImageTool(ws),
    hand: { id: "hand", cursor: "grab", down: () => false },
    zoom: createZoomTool(ws),
    comment: createCommentTool(ws),
  };
  // Prototype mode (T9): the Move tool with the connection handle (no toolbar button; the mode selects it)
  tools.connect = createConnectTool(ws, tools.move);
  let current = tools.move;
  let switching = false;

  const buttons = new Map();
  const bar = h("div.of-proto-toolbar", { role: "toolbar", "aria-label": t("Tools") });
  for (const d of TOOLS) {
    const b = iconButton({ icon: d.icon, label: d.label, shortcut: d.key, onClick: () => api.set(d.id) });
    b.setAttribute("aria-pressed", String(d.id === "move"));
    buttons.set(d.id, b);
    bar.append(b);
    if (d.id === "frame") bar.append(presetMenu());
  }

  /** The frame presets next to the Frame tool (Insert ▸ Frame offers the same). */
  function presetMenu() {
    const trigger = h("button.of-ibtn.of-proto-toolbar__more", { type: "button", slot: "trigger", "aria-label": t("Frame presets"), "data-tip": t("Frame presets") }, h("sl-icon", { name: "chevron-down" }));
    const menu = h("sl-menu");
    for (const [id, p] of Object.entries(FRAME_PRESETS)) menu.append(h("sl-menu-item", { value: id }, `${t(p.name)}  ${p.w} × ${p.h}`));
    menu.addEventListener("sl-select", (e) => ws.addFrame(e.detail.item.value));
    return h("sl-dropdown", { placement: "top", distance: 6, hoist: true }, trigger, menu);
  }

  const api = {
    el: bar,
    list: TOOLS,
    get current() {
      return current;
    },
    get: (id) => tools[id] || null,
    /** Makes `id` the current tool (the Move tool for unknown ids). */
    set(id) {
      if (id === "move" && ws.mode === "prototype") id = "connect";
      if (id === "connect" && ws.mode !== "prototype") id = "move";
      const next = tools[id] || tools.move;
      if (next === current || switching) return;
      switching = true;
      try {
        current.deactivate?.();
        current.cancel?.();
      } finally {
        switching = false;
      }
      current = next;
      for (const [k, b] of buttons) {
        const on = k === next.id || (k === "move" && next.id === "connect");
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("active", on);
      }
      ws.setTool(next);
      ws.setHover(null);
      ws.requestDraw();
      ws.emitTool(next.id);
    },
  };
  buttons.get("move").classList.add("active");
  return api;
}
