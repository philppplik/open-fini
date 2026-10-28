// Studios: Vector, Pixel, Layout, Code and Vibe (more register themselves through registerStudio, see registry.js). A studio is a focused set of tools and panels over
// the same document — switching studios never changes or converts the document. Export is not a studio:
// it is a popup (ui/export-dialog.js) reachable from every studio.
import { MoveTool } from "./tools/move.js";
import { NodeTool } from "./tools/node.js";
import { PenTool, PencilTool } from "./tools/pen.js";
import { RectTool, EllipseTool, PolygonTool, StarTool, PresetShapeTool, LineTool } from "./tools/shapes.js";
import { HandTool, ZoomTool, EyedropperTool } from "./tools/nav.js";

// Additional tool sets register themselves here (pixel / layout / text / gradient ...).
import { TOOL_SETS } from "./tool-sets.js";
import { registerStudio } from "./registry.js";
import { OFFICE_STUDIO } from "./office.js";

export { STUDIOS, registerStudio, listStudios, studioIds, getStudio, hasStudio, onStudioRegistered } from "./registry.js";
import { STUDIOS } from "./registry.js";

export const CORE_TOOLS = [MoveTool, NodeTool, PenTool, PencilTool, RectTool, EllipseTool, PolygonTool, StarTool, PresetShapeTool, LineTool, HandTool, ZoomTool, EyedropperTool];

/** Toolbox layout per built-in studio. Nested arrays are flyout groups (first = default). */
const BUILTIN = {
  vector: {
    id: "vector",
    label: "Vector",
    icon: "vector",
    blurb: "Curves, shapes, type and effects",
    tools: ["move", "node", ["pen", "pencil"], ["rect", "ellipse", "polygon", "star", "shapes", "line"], "text", ["gradient", "fill"], "eyedropper", "crop", "slice", "hand", "zoom"],
    top: ["appearance", "transform", "color", "type"],
    bottom: ["layers", "history", "navigator"],
  },
  pixel: {
    id: "pixel",
    label: "Pixel",
    icon: "pixel",
    blurb: "Photo editing, painting and retouching",
    tools: [
      "move",
      ["marquee", "marquee-ellipse", "lasso", "poly-lasso", "wand", "color-range"],
      ["crop", "perspective-crop"],
      ["brush", "pixel-pencil"],
      ["eraser", "magic-eraser"],
      ["clone", "heal", "spot-heal", "redeye"],
      ["smudge", "blur", "sharpen"],
      ["dodge", "burn", "sponge"],
      ["fill", "gradient"],
      "text",
      "liquify",
      "eyedropper",
      "hand",
      "zoom",
    ],
    top: ["color", "brush", "adjustments", "transform"],
    bottom: ["layers", "history", "histogram", "info", "navigator"],
  },
  layout: {
    id: "layout",
    label: "Layout",
    icon: "layout",
    blurb: "Pages, text flow, styles and print",
    tools: ["move", "node", ["frame-text", "text"], ["rect", "ellipse", "polygon", "star", "shapes", "line"], "image-frame", "table", "chart", ["pen", "pencil"], "slice", "eyedropper", "hand", "zoom"],
    top: ["appearance", "transform", "type", "data", "color"],
    bottom: ["pages", "layers", "styles", "history"],
  },
  // The Code studio is a website workbench (code editor + visual designer). Its left sidebar, center stage and
  // bottom panel are owned by ui/code/; only the right dock uses the regular panel registry.
  code: {
    id: "code",
    label: "Code",
    icon: "code",
    blurb: "HTML, CSS and JavaScript with a visual designer",
    workspace: true,
    tools: [],
    top: ["style", "element"],
    bottom: [],
  },
  // Vibe Studio: an AI assistant that works inside the other studios. Its whole workspace is ui/vibe/.
  vibe: {
    id: "vibe",
    label: "Vibe",
    icon: "vibe",
    blurb: "Describe it — an AI builds it in your studios",
    workspace: true,
    tools: [],
    top: [],
    bottom: [],
  },
};

// Built-in studios, in header order. A studio registered later (extensions, Office, Video ...) is one more call.
const BUILTIN_META = {
  vector: { order: 10, document: true },
  pixel: { order: 20, document: true },
  layout: { order: 30, document: true },
  code: { order: 40, newDocument: (app) => import("../ui/code/start.js").then((m) => m.newWebsiteDialog(app)) },
  vibe: { order: 50 },
};
for (const [id, def] of Object.entries(BUILTIN)) registerStudio({ ...def, ...BUILTIN_META[id] });

// Office Studio (word processor): one registration call, see studios/office.js. Not in the default header five, so
// it starts in the "More" menu.
registerStudio(OFFICE_STUDIO);

export function registerAllTools(app) {
  for (const C of CORE_TOOLS) app.registerTool(C);
  for (const set of TOOL_SETS) for (const C of set) app.registerTool(C);
}

/** Tools of a studio flattened: [{id, group:[ids]|null}] preserving order. */
export function toolboxFor(studioId) {
  return STUDIOS[studioId].tools.map((t) => (Array.isArray(t) ? { id: t[0], group: t } : { id: t, group: null }));
}
