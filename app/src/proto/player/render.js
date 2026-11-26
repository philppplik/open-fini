// One screen of the Proto prototype player (docs/concepts/proto-studio.md §6.2, task T9): a top-level frame rendered
// as real DOM with the same CSS as the canvas (engine/proto/css.js through proto/patch.js), in its own shadow root,
// with scrolling turned on (`scroll` layers scroll, `sticky` layers stay) and literal variable values (the player's
// variables replace the design's). Each element carries its resolved key, so input maps back to layers.
//
//   renderScreen(doc, model, frameId, { vars, mediaUrl }) → screen
//     screen: { id, host, root (the frame element), els: Map<key, element>, tree, flat, w, h, inter: Map<key, list>,
//               keyOf(element) → key | null, chain(event) → [keys, innermost first], destroy() }
import { createResolver } from "../../engine/proto/resolve.js";
import { treeCss } from "../../engine/proto/css.js";
import { variableValue } from "../../engine/proto/variables.js";
import { interactionsOf, flatten } from "../../engine/proto/interactions.js";
import { field } from "../../engine/proto/schema.js";
import { entriesFor, planPatch } from "../patch.js";
import { applyPlan } from "../view.js";

const RESET = `:host{all:initial;position:absolute;left:0;top:0;display:block;overflow:visible}
div,span,svg{box-sizing:border-box;margin:0}
div{display:block}
span{white-space:inherit}
svg{display:block;overflow:visible;width:100%;height:100%}`;

/**
 * @param {Document} doc the document the screen will live in
 * @param {object} model the design (with the player's variants applied)
 * @param {string} frameId a top-level layer
 * @param {{ vars?: Record<string, unknown>, mediaUrl?: Function }} [o]
 */
export function renderScreen(doc, model, frameId, { vars = {}, mediaUrl } = {}) {
  const has = (id) => Object.prototype.hasOwnProperty.call(vars, id);
  const resolver = createResolver(model, { variableValue: (_ctx, id, modes) => (has(id) ? vars[id] : variableValue(model, id, modes)) });
  const tree = resolver.tree(frameId);
  const host = doc.createElement("div");
  host.className = "of-proto-player__screen";
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = RESET;
  const content = doc.createElement("div");
  content.style.display = "contents";
  shadow.append(style, content);
  const els = new Map();
  const inter = new Map();
  const nodes = new Map();
  if (tree) {
    const css = treeCss(tree, { resolver, model, vars: "value", root: "origin", scroll: true, mediaUrl });
    const entries = entriesFor(tree, css);
    const rec = { els, content };
    applyPlan(rec, planPatch(null, entries));
    rec.content.replaceChildren(els.get(tree.key));
    const visit = (r) => {
      nodes.set(r.key, r);
      const el = els.get(r.key);
      if (el) el.setAttribute("data-of-key", r.key);
      const list = interactionsOf(model, r);
      if (list.length) inter.set(r.key, list);
      for (const c of r.children || []) visit(c);
    };
    visit(tree);
  }
  const root = tree ? els.get(tree.key) : null;
  const size = (axis) => {
    const s = tree ? field(tree.node, axis) : null;
    return s?.mode === "fixed" && Number.isFinite(s.value) ? s.value : null;
  };
  const elKey = new WeakMap([...els].map(([k, el]) => [el, k]));
  return {
    id: frameId,
    host,
    root,
    els,
    tree,
    nodes,
    flat: tree ? flatten(tree) : [],
    inter,
    /** Design size of the frame (fixed sizes; hug and fill frames are measured by the player). */
    w: size("w"),
    h: size("h"),
    keyOf: (el) => elKey.get(el) ?? null,
    /** The layer keys under an event, innermost first. */
    chain(e) {
      const out = [];
      for (const n of e.composedPath?.() || []) {
        if (n === host) break;
        const k = elKey.get(n);
        if (k != null) out.push(k);
      }
      return out;
    },
    destroy() {
      host.remove();
    },
  };
}
