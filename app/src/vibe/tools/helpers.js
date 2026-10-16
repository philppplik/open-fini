// Shared helpers of the OpenFini tool set the Vibe assistant calls.
import { solid, linearGradient, radialGradient, walk } from "../../core/nodes.js";
import { pageBounds } from "../../core/transform.js";
import { plainText } from "../../engine/layout/text-model.js";

const r1 = (n) => Math.round(n * 10) / 10;

/** A tool definition. `props` maps names to JSON-schema fragments; `required` lists names. */
export function tool(name, description, props, required, run, extra = {}) {
  return { name, description, inputSchema: { type: "object", properties: props, required: required || [], additionalProperties: false }, run, ...extra };
}

export const S = {
  str: (description, extra = {}) => ({ type: "string", description, ...extra }),
  num: (description, extra = {}) => ({ type: "number", description, ...extra }),
  bool: (description) => ({ type: "boolean", description }),
  ids: (description = "Layer ids from list_layers") => ({ type: "array", items: { type: "string" }, description, minItems: 1 }),
  color: (description = "CSS color such as #ff6b35, or a gradient object") => ({
    description,
    anyOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["linear", "radial"] },
          angle: { type: "number", description: "Degrees, 0 = left to right, 90 = top to bottom (linear only)" },
          stops: { type: "array", items: { type: "object", properties: { offset: { type: "number", minimum: 0, maximum: 1 }, color: { type: "string" }, alpha: { type: "number", minimum: 0, maximum: 1 } }, required: ["color"] }, minItems: 2 },
        },
        required: ["stops"],
      },
    ],
  }),
};

/** "#rrggbb" / gradient spec / null → OpenFini paint object (or null for "none"). */
export function toPaint(spec) {
  if (spec == null || spec === "none" || spec === "") return null;
  if (typeof spec === "string") return solid(spec.startsWith("#") ? spec : cssToHex(spec));
  const stops = (spec.stops || []).map((s, i, a) => ({ o: s.offset ?? i / Math.max(1, a.length - 1), color: s.color.startsWith("#") ? s.color : cssToHex(s.color), alpha: s.alpha ?? 1 }));
  if (spec.type === "radial") {
    const g = radialGradient();
    g.stops = stops;
    return g;
  }
  const g = linearGradient();
  g.stops = stops;
  const a = ((spec.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(a) / 2;
  const dy = Math.sin(a) / 2;
  Object.assign(g, { x0: 0.5 - dx, y0: 0.5 - dy, x1: 0.5 + dx, y1: 0.5 + dy });
  return g;
}

const NAMED = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080", grey: "#808080", transparent: "#00000000" };
export function cssToHex(c) {
  const s = String(c).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
  const h3 = /^#([0-9a-f]{3})$/.exec(s);
  if (h3) return `#${[...h3[1]].map((x) => x + x).join("")}`;
  return /^#[0-9a-f]{6,8}$/.test(s) ? s : "#000000";
}

export function paintSummary(p) {
  if (!p) return null;
  if (p.type === "solid") return p.alpha != null && p.alpha < 1 ? `${p.color} @${r1(p.alpha)}` : p.color;
  return `${p.type}-gradient(${(p.stops || []).map((s) => s.color).join(", ")})`;
}

export function nodeText(doc, n) {
  const entry = n.storyId && doc.stories[n.storyId];
  return entry ? plainText(entry.story) : "";
}

/** A compact description of a node for the model. */
export function nodeInfo(app, n, { depth = 0, maxDepth = 3 } = {}) {
  const doc = app.doc;
  let b = null;
  try {
    b = pageBounds(n);
  } catch {
    /* nodes without geometry */
  }
  const info = { id: n.id, type: n.type, name: n.name };
  if (b) Object.assign(info, { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) });
  if (!n.visible) info.visible = false;
  if (n.locked) info.locked = true;
  if (n.opacity != null && n.opacity < 1) info.opacity = r1(n.opacity);
  if (n.blend && n.blend !== "normal") info.blend = n.blend;
  if ("fill" in n && n.fill) info.fill = paintSummary(n.fill);
  if ("stroke" in n && n.stroke) info.stroke = `${paintSummary(n.stroke.fill)} ${n.stroke.width}px`;
  if (n.type === "text") info.text = nodeText(doc, n).slice(0, 300);
  if (n.type === "adjust") info.effect = `${n.effect?.group}/${n.effect?.id}`;
  if (n.children?.length) {
    info.childCount = n.children.length;
    if (depth < maxDepth) info.children = n.children.map((c) => nodeInfo(app, c, { depth: depth + 1, maxDepth }));
  }
  return info;
}

/** Resolves ids to nodes of the open document; throws a helpful error for unknown ids. */
export function nodesById(app, ids) {
  if (!app.doc) throw new Error("No document is open. Use new_document first.");
  const out = [];
  for (const id of ids || []) {
    const n = app.doc.find(id);
    if (!n) throw new Error(`There is no layer with id “${id}”. Call list_layers to see the current ids.`);
    out.push(n);
  }
  return out;
}

export function requireDoc(app) {
  if (!app.doc) throw new Error("No document is open. Use new_document first.");
  return app.doc;
}

export function countNodes(app) {
  let n = 0;
  app.doc?.walkAll(() => n++);
  return n;
}

export { walk };
