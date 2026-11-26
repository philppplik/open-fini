// Lowering for the Proto code export (docs/concepts/proto-studio.md §10.1, task T7). Pure: no DOM.
//
// lower(model, opts) turns the resolved tree (resolve.js) into ONE intermediate representation that every emitter
// (html.js, react.js, tailwind.js, swiftui.js) prints. The CSS of every element is exactly what css.js produces for
// the canvas (variables as `var(--name, value)`, modes as `data-mode-*` attributes), so the export and the canvas
// cannot drift apart; lowering only chooses elements, names, components and assets.
//
// IR document
//   { screens, components, assets, vars, fonts, warnings, breakpoints }
//   screens     [{ id, name, file, root: IRNode, media: [{ query, width, pairs: [[baseNode, altNode]] }] }]
//               one per exported layer (a top-level frame is a screen); frames with the same name on one page are
//               breakpoint variants of one screen: the widest is the base, the others become @media differences
//   components  [{ id, name, file, axes, props, variants: [{ id, values, slug, root }], defaultVariant, shared, code }]
//               every main component (or component set) that is exported or used by an exported instance
//   assets      [{ id, file, url, mime, bytes, name }] media used by image fills (the URL css.js and <img> use)
//   vars        css.js ▸ varRules(model): custom properties of every variable (:root defaults, [data-mode-…] rules)
//   fonts       font families the export uses (sorted)
//   warnings    [{ code, key, message }] what the export could not express
// IRNode
//   { key, id, type, name, base, el, decls, attrs, text?, svg?, image?, children, box, r,
//     instance?, bind?, slot?, href? }
//   key/id/type/name  the resolved layer (key is unique in the tree, id the stored layer)
//   base        kebab-case class name base from the layer name (emitters make it unique per stylesheet)
//   el          the HTML element: the layer's `tag`, else inferred (text → h1/h2/h3/p, click → button or a, image →
//               img, vector → svg, names such as Button, Nav, Header → button, nav, header); phrasing-only parents
//               (buttons, links, headings, paragraphs) get spans
//   decls       [[property, value]] from css.js (plus `object-fit` for <img> and `overflow: visible` for <svg>)
//   attrs       { "aria-label", role, alt, type, "data-mode-…", "data-proto-id"? }
//   text        { runs: [{ text, decls }] }   svg  css.js presentation data plus { w, h }   image { asset, alt }
//   box         css.js ▸ boxModel (layout, sizes, padding; the SwiftUI emitter reads it)
//   instance    { comp, variant, props, swaps, slots, inline } for an instance of an exported component: emitters
//               with components print a usage; `inline` (overrides inside the instance) prints the expanded layers
//   bind        { text?, visible?, swap?, children? } property names bound in a component definition
//   slot        the slot property a slot layer of a component definition shows
//
// Options
//   ids         layers to export (frames, any layer, components or sets); default: every top-level layer of `page`
//   page        page id (default: every page)
//   modes       { collectionId: modeId } applied like the canvas's page modes
//   assetUrl    (file) → URL of an asset in the code (default "assets/<file>")
//   dataIds     true: elements carry data-proto-id="<key>" (round trips and live links)
//   collapse    false: keep wrappers that add nothing (default true)
import { createResolver } from "../resolve.js";
import { nodeCss, boxModel, textStyleOf, varRules } from "../css.js";
import { field } from "../schema.js";
import { indexOf, pageKey } from "../tree.js";
import { pickVariant, propsOfTarget, bindingsOf, setOf, slotTargets } from "../components.js";
import { isObj, kebab, pascal, uniquer, extOf, byStr } from "./util.js";

/** HTML elements an exported layer may become (the `tag` field is checked against it). */
export const ELEMENTS = new Set(
  "a abbr address article aside b blockquote button caption code dd details dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup i img label legend li main mark menu nav ol p picture pre q s search section small span strong sub summary sup table tbody td tfoot th thead time tr u ul".split(" "),
);
const VOID = new Set(["img", "input", "br", "hr"]);
/** Elements whose content must be phrasing content (spans, not divs). */
const PHRASING_ONLY = new Set(["a", "button", "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label", "strong", "em", "b", "i", "u", "s", "small", "code", "q", "mark", "sub", "sup", "time", "abbr", "legend", "summary", "dt", "caption"]);
/** Phrasing elements (allowed inside PHRASING_ONLY parents). */
const PHRASING = new Set(["a", "abbr", "b", "button", "code", "em", "i", "img", "label", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "svg", "time", "u"]);

const TEXT_TAGS = /^(h[1-6]|p|span|label|strong|em|small|code|q|time|figcaption|legend|caption|li|dt|dd|blockquote|pre|a|button|summary|th|td)$/;

/** Collections named like a color scheme (for the optional prefers-color-scheme rule of the HTML export). */
export const SCHEME_NAME = /\b(theme|scheme|appearance|mode|color)\b/i;

export function lower(model, opts = {}) {
  const { ids = null, page = null, modes = null, assetUrl = (f) => `assets/${f}`, dataIds = false, collapse = true } = opts;
  const resolver = createResolver(model, modes ? { modes } : {});
  const warnings = [];
  const warn = (code, key, message) => {
    if (!warnings.some((w) => w.code === code && w.key === key)) warnings.push({ code, key, message });
  };
  const nodes = model.nodes || {};
  const ix = indexOf(model);
  const fonts = new Set();

  // ---------------------------------------------------------------------------------------------- assets
  const assets = new Map();
  const assetFiles = uniquer("-");
  function assetOf(mediaId) {
    if (assets.has(mediaId)) return assets.get(mediaId);
    const m = model.media?.[mediaId];
    if (!isObj(m)) {
      warn("missing-media", mediaId, `The image “${mediaId}” is not in the design.`);
      return null;
    }
    const name = String(m.name || mediaId).replace(/\.[A-Za-z0-9]+$/, "");
    const file = `${assetFiles(kebab(name, "image"))}.${extOf(m.mime)}`;
    const a = { id: mediaId, file, url: assetUrl(file), mime: m.mime || "application/octet-stream", bytes: m.bytes instanceof Uint8Array ? m.bytes : null, name: m.name || file };
    if (!a.bytes) warn("media-bytes", mediaId, `The bytes of the image “${a.name}” are not stored in the design; the export references ${file} without it.`);
    assets.set(mediaId, a);
    return a;
  }
  const mediaUrl = (id) => assetOf(id)?.url || "";

  // ---------------------------------------------------------------------------------------------- components
  const comps = new Map(); // record id (set or single component) → record (filled lazily)
  const compOrder = [];
  const compNames = uniquer("");
  /** The component record an instance target (set, component, variant) belongs to. */
  function compIdOf(target) {
    if (!isObj(target)) return null;
    if (target.type === "componentSet") return target.id;
    if (target.type === "component") return setOf(model, target)?.id || target.id;
    return null;
  }
  function useComponent(id) {
    if (!id || comps.has(id)) return comps.get(id) || null;
    const owner = nodes[id];
    if (!isObj(owner)) return null;
    const rec = { id, name: compNames(pascal(owner.name, "Component")), file: null, axes: [], props: [], variants: [], defaultVariant: null, shared: true, code: isObj(owner.code) ? owner.code : null, pending: true };
    rec.file = rec.name;
    comps.set(id, rec);
    compOrder.push(id);
    return rec;
  }

  // ---------------------------------------------------------------------------------------------- elements
  function textTag(n) {
    const st = isObj(n.style) && typeof n.style.text === "string" ? model.styles?.[n.style.text] : null;
    const sname = st?.name || "";
    const h = /\bh([1-6])\b/i.exec(sname);
    if (h) return `h${h[1]}`;
    if (/\b(heading|title|display|headline)\b/i.test(sname)) return "h2";
    const s = textStyleOf(n);
    const size = typeof s.size === "number" ? s.size : 16;
    const weight = typeof s.weight === "number" ? s.weight : 400;
    if (size >= 32) return "h1";
    if (size >= 24) return "h2";
    if (size >= 20 && weight >= 600) return "h3";
    return "p";
  }
  function clickTarget(n) {
    for (const it of Array.isArray(n.proto) ? n.proto : []) {
      if (!isObj(it) || it.on?.type !== "click") continue;
      for (const a of Array.isArray(it.do) ? it.do : []) {
        if (a?.act === "navigate" && typeof a.to === "string") return { kind: "navigate", to: a.to };
        if (a?.act === "openUrl" && typeof a.url === "string" && /^(https?:|mailto:|tel:)/i.test(a.url)) return { kind: "url", url: a.url };
      }
      return { kind: "action" };
    }
    return null;
  }
  function nameTag(r) {
    const n = r.node;
    const of = r.type === "instance" ? instFields(r).of : null;
    const name = `${n.name || ""} ${of ? nodes[of]?.name || "" : ""}`;
    if (/\b(button|btn|cta)\b/i.test(name)) return "button";
    if (/\b(nav|navigation|menu|tab ?bar)\b/i.test(name)) return "nav";
    if (/\b(header|top ?bar|app ?bar)\b/i.test(name)) return "header";
    if (/\bfooter\b/i.test(name)) return "footer";
    if (/\b(form|login|sign ?in|sign ?up)\b/i.test(name)) return "form";
    if (/\b(card|section)\b/i.test(name)) return "section";
    return null;
  }

  /** The element of a layer in its context: { phrasing, interactive }. */
  function elementOf(r, ctx) {
    const n = r.node;
    let tag = typeof n.tag === "string" ? n.tag.toLowerCase() : null;
    if (tag && !ELEMENTS.has(tag) && tag !== "input") {
      warn("tag", r.key, `“${n.tag}” is not an element the export knows; ${r.key} is exported as a div.`);
      tag = null;
    }
    let href = null;
    const click = r.type !== "text" ? clickTarget(n) : null;
    if (!tag) {
      if (r.type === "text") tag = textTag(n);
      else if (r.type === "vector" || r.type === "line") tag = "svg";
      else if (click?.kind === "navigate" || click?.kind === "url") tag = "a";
      else if (click) tag = "button";
      else tag = nameTag(r);
    }
    if (r.type === "vector" || r.type === "line") tag = "svg";
    if (tag === "a" && click?.kind === "url") href = click.url;
    if (tag === "a" && click?.kind === "navigate") href = { screen: click.to };
    if (VOID.has(tag) && (r.children.length || r.type === "text")) {
      if (tag !== "img") warn("void", r.key, `A <${tag}> cannot hold layers; ${r.key} is exported as a div.`);
      tag = null;
    }
    if (r.type === "text" && tag && !TEXT_TAGS.test(tag)) tag = "p";
    if (ctx.interactive && (tag === "a" || tag === "button")) tag = "span";
    if (ctx.phrasing && tag && !PHRASING.has(tag)) tag = "span";
    if (!tag) tag = ctx.phrasing ? "span" : r.type === "text" ? "p" : "div";
    return { tag, href };
  }

  // ---------------------------------------------------------------------------------------------- collapse
  const PLAIN = ["fills", "strokes", "effects", "style", "tag", "a11y", "modes", "cell", "sticky", "proto", "code"];
  /** A frame that hugs exactly one flow child and draws nothing: its child takes its place. */
  function collapsible(r, parent) {
    if (!collapse || !parent || r.type !== "frame" || r.children.length !== 1) return false;
    const n = r.node;
    const pl = parent.node?.layout;
    if (!isObj(pl) || pl.type !== "flex" || field(n, "pos") !== "flow") return false;
    if (field(n, "w").mode !== "hug" || field(n, "h").mode !== "hug" || field(n, "w").min != null || field(n, "w").max != null || field(n, "h").min != null || field(n, "h").max != null) return false;
    if (!isObj(n.layout) || n.layout.type !== "flex") return false;
    if (Array.isArray(n.layout.pad) && n.layout.pad.some((p) => p !== 0)) return false;
    if (field(n, "opacity") !== 1 || field(n, "blend") !== "normal" || field(n, "rot") !== 0 || field(n, "clip") || field(n, "scroll") !== "none" || field(n, "visible") === false) return false;
    for (const k of PLAIN) {
      const v = n[k];
      if (v == null) continue;
      if (Array.isArray(v) && !v.length) continue;
      if (isObj(v) && !Object.keys(v).length) continue;
      return false;
    }
    if (r.bound && Object.keys(r.bound).length) return false;
    const c = r.children[0];
    if (field(c.node, "pos") !== "flow" || field(c.node, "visible") === false) return false;
    const cw = field(c.node, "w").mode;
    const ch = field(c.node, "h").mode;
    if (cw === "fill" || ch === "fill" || cw === "rel" || ch === "rel") return false;
    return true;
  }

  // ---------------------------------------------------------------------------------------------- tree → IR
  /**
   * Lowers a resolved subtree. scope: { comp?: { binds, slots, defs }, inline: bool } for component definitions and
   * the inside of inlined instances.
   */
  function lowerTree(rootR, scope) {
    const visit = (r, parentR, index, count, ctx, ownerScope) => {
      // wrappers that add nothing
      const held = (x) => ownerScope.comp && x.key === x.id && (ownerScope.comp.binds.has(x.id) || ownerScope.comp.slots.has(x.id));
      while (!held(r) && collapsible(r, parentR)) r = { ...r.children[0], parent: parentR?.key ?? null };
      const bind = ownerScope.comp && r.key === r.id ? bindOf(ownerScope.comp, r.id) : null;
      if (field(r.node, "visible") === false && !bind?.visible) return null;
      const css = nodeCss(r, { parent: parentR, index, count, vars: "css", resolver, model, root: "none", scroll: true, mediaUrl });
      // every stylesheet of the export sets border-box for all elements (the reset, Tailwind's preflight)
      let decls = css.decls.filter(([p]) => p !== "box-sizing").map(([p, v]) => (BOX_SHORTHAND.has(p) ? [p, shortBox(v)] : [p, v]));
      if (bind?.visible) decls = decls.filter(([p, v]) => !(p === "display" && v === "none"));
      if (!parentR && !decls.some(([p]) => p === "position")) decls.unshift(["position", "relative"]);
      const { tag, href } = elementOf(r, ctx);
      const attrs = {};
      for (const [k, v] of Object.entries(css.attrs || {})) attrs[k] = v;
      const a11y = isObj(r.node.a11y) ? r.node.a11y : {};
      if (typeof a11y.label === "string" && a11y.label) attrs["aria-label"] = a11y.label;
      if (typeof a11y.role === "string" && a11y.role) attrs.role = a11y.role;
      if (tag === "button") attrs.type = "button";
      if (dataIds) attrs["data-proto-id"] = r.key;
      const ir = { key: r.key, id: r.id, type: r.type, name: r.node.name || "", base: kebab(r.node.name, r.type === "text" ? "text" : r.type), el: tag, decls, attrs, children: [], box: boxModel(r, parentR), r };
      if (href) ir.href = href;
      if (bind) ir.bind = bind;
      if (ownerScope.comp?.slots?.has(r.id) && r.key === r.id) ir.slot = ownerScope.comp.slots.get(r.id);
      if (css.text) {
        ir.text = css.text;
        const st = textStyleOf(r.node);
        fonts.add(String(st.font || "Inter"));
        for (const run of r.node.text?.runs || []) if (typeof run?.s?.font === "string") fonts.add(run.s.font);
      }
      if (css.svg) {
        const sz = (axis) => {
          const s = field(r.node, axis);
          return s.mode === "fixed" && typeof s.value === "number" ? s.value : null;
        };
        ir.svg = { ...css.svg, w: sz("w"), h: sz("h") };
        if (!decls.some(([p]) => p === "overflow")) decls.push(["overflow", "visible"]);
      }
      // a picture: <img> when the layer is only an image (fixed, fill or relative sizes keep the canvas geometry)
      const fills = Array.isArray(r.node.fills) ? r.node.fills.filter((f) => isObj(f) && f.visible !== false) : [];
      if (fills.length === 1 && fills[0].type === "image" && !r.children.length && r.type !== "text" && field(r.node, "w").mode !== "hug" && field(r.node, "h").mode !== "hug" && ["cover", "contain", "fill", undefined].includes(fills[0].fit) && !ctx.interactive) {
        const asset = assetOf(fills[0].media);
        if (asset) {
          const pos = Array.isArray(fills[0].pos) ? fills[0].pos : [0.5, 0.5];
          ir.el = "img";
          ir.image = { asset, alt: typeof r.node.alt === "string" ? r.node.alt : "" };
          ir.decls = decls.filter(([p]) => !p.startsWith("background-"));
          ir.decls.push(["object-fit", fills[0].fit || "cover"]);
          const op = `${Math.round(pos[0] * 1000) / 10}% ${Math.round(pos[1] * 1000) / 10}%`;
          if (op !== "50% 50%") ir.decls.push(["object-position", op]);
          if (!ir.decls.some(([p]) => p === "display")) ir.decls.push(["display", "block"]);
        }
      } else if (r.type === "image" && !attrs.role) {
        attrs.role = "img";
        if (typeof r.node.alt === "string" && r.node.alt && !attrs["aria-label"]) attrs["aria-label"] = r.node.alt;
      }
      if (ir.el === "span" && r.type !== "text" && !ir.decls.some(([p]) => p === "display")) ir.decls.push(["display", "block"]);
      // instances
      let inner = ownerScope;
      if (r.type === "instance") {
        const info = instanceInfo(r);
        if (info) {
          ir.instance = info;
          if (info.inline || ownerScope.inline) {
            info.inline = true;
            inner = { ...ownerScope, comp: null, inline: true };
          } else inner = { ...ownerScope, comp: null };
        } else inner = { ...ownerScope, comp: null };
      }
      const kidCtx = { phrasing: ctx.phrasing || PHRASING_ONLY.has(ir.el), interactive: ctx.interactive || ir.el === "a" || ir.el === "button" };
      const kids = r.children;
      kids.forEach((c, i) => {
        const k = visit(c, r, i, kids.length, kidCtx, inner);
        if (k) ir.children.push(k);
      });
      if (ir.instance && !ir.instance.inline) ir.instance.slots = slotsOf(ir);
      return ir;
    };
    return visit(rootR, null, 0, 1, { phrasing: false, interactive: false }, scope);
  }

  function bindOf(comp, layerId) {
    const list = comp.binds.get(layerId);
    if (!list) return null;
    const out = {};
    for (const [fieldName, prop] of list) {
      const d = comp.defs[prop];
      if (!isObj(d)) continue;
      if (fieldName === "text" && (d.type === "text" || d.type === "number")) out.text = prop;
      else if (fieldName === "visible" && d.type === "bool") out.visible = prop;
      else if (fieldName === "of" && d.type === "swap") out.swap = prop;
      else if (fieldName === "children" && d.type === "slot") out.children = prop;
    }
    return Object.keys(out).length ? out : null;
  }

  /** The stored-side fields of an instance (`of`, `variant`, `props`, `over` with properties applied). */
  const instFields = (r) => (isObj(r.src) && r.src.of !== undefined ? r.src : nodes[r.id] || r.node);
  function instanceInfo(r) {
    const n = instFields(r);
    const target = typeof n.of === "string" ? nodes[n.of] : null;
    const cid = compIdOf(target);
    if (!cid) {
      warn("missing-component", r.key, `The component of “${n.name || r.key}” is missing; its layers are exported as they look.`);
      return null;
    }
    const rec = useComponent(cid);
    const defs = propsOfTarget(model, cid) || {};
    const want = { ...(target.type === "component" && isObj(target.variant) ? target.variant : {}), ...(isObj(n.variant) ? n.variant : {}) };
    const variant = {};
    for (const [axis, d] of Object.entries(defs)) if (isObj(d) && d.type === "variant" && want[axis] !== undefined && want[axis] !== d.default) variant[axis] = want[axis];
    const props = {};
    const swaps = {};
    const mine = isObj(n.props) ? n.props : {};
    for (const [name, d] of Object.entries(defs)) {
      if (!isObj(d) || d.type === "variant" || d.type === "slot" || mine[name] === undefined) continue;
      if (JSON.stringify(mine[name]) === JSON.stringify(d.default)) continue;
      if (d.type === "swap") {
        const sid = compIdOf(nodes[mine[name]]);
        if (sid) {
          useComponent(sid);
          swaps[name] = sid;
        }
      } else props[name] = mine[name];
    }
    const over = isObj(n.over) ? Object.keys(n.over) : [];
    const inline = over.length > 0;
    if (inline) warn("overrides", r.key, `“${n.name || r.key}” overrides layers inside its component; the React and SwiftUI exports write its layers out instead of using the component.`);
    return { comp: rec.id, variant, props, swaps, slots: null, inline, instKey: r.key };
  }

  /** Slot content of a usage: { prop: [IRNode] } (children of the instance's slot layers that the instance provides). */
  function slotsOf(ir) {
    const rec = comps.get(ir.instance.comp);
    const out = {};
    if (!rec) return out;
    const owner = nodes[rec.id];
    const src = instFields(ir.r);
    const target = nodes[src.of];
    const comp = pickVariant(model, target, src.variant) || (owner.type === "component" ? owner : null);
    if (!comp) return out;
    const defs = propsOfTarget(model, rec.id) || {};
    const targets = slotTargets(model, comp, defs, bindingsOf(model, comp));
    const walk = (node) => {
      for (const c of node.children) {
        if (c.r.slot === ir.key) {
          const layer = c.r.parent ? c.r.parent.split("/").pop() : null;
          const prop = [...targets].find(([, l]) => l === layer)?.[0] || [...targets.keys()][0];
          if (prop) (out[prop] ||= []).push(c);
        } else walk(c);
      }
    };
    walk(ir);
    return out;
  }

  // ---------------------------------------------------------------------------------------------- screens
  const screenNames = uniquer("");
  const fileNames = uniquer("-");
  const screens = [];
  const roots = [];
  if (Array.isArray(ids) && ids.length) {
    for (const id of ids) if (isObj(nodes[id])) roots.push(id);
      else warn("missing-layer", id, `There is no layer “${id}”.`);
  } else {
    const pages = Object.values(model.pages || {})
      .filter((p) => isObj(p) && (!page || p.id === page))
      .sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : a.id < b.id ? -1 : 1));
    for (const p of pages) for (const id of ix.get(pageKey(p.id)) || []) roots.push(id);
  }
  for (const id of roots) {
    const n = nodes[id];
    if (n.type === "componentSet" || n.type === "component") {
      useComponent(compIdOf(n));
      continue;
    }
    if (field(n, "visible") === false) continue;
    const r = resolver.tree(id);
    if (!r) continue;
    const root = lowerTree(r, { comp: null, inline: false });
    if (!root) continue;
    // page modes apply to the screen (the canvas sets them on the page)
    const pm = n.parent == null ? model.pages?.[n.page]?.modes : null;
    if (isObj(pm)) {
      const css = nodeCss({ ...r, node: { ...r.node, modes: { ...pm, ...(isObj(r.node.modes) ? r.node.modes : {}) } } }, { resolver, model, root: "none" });
      Object.assign(root.attrs, css.attrs);
    }
    const name = screenNames(pascal(n.name, "Screen"));
    screens.push({ id, name, file: fileNames(kebab(n.name, "screen")), page: n.page, top: n.parent == null, root, media: [] });
  }
  mergeBreakpoints(model, screens, warn);

  // ---------------------------------------------------------------------------------------------- component definitions
  for (let i = 0; i < compOrder.length; i++) {
    const rec = comps.get(compOrder[i]);
    if (!rec.pending) continue;
    delete rec.pending;
    const owner = nodes[rec.id];
    const defs = propsOfTarget(model, rec.id) || {};
    const used = uniquer("");
    const propList = [];
    let slotCount = Object.values(defs).filter((d) => isObj(d) && d.type === "slot").length;
    for (const [name, d] of Object.entries(defs)) {
      if (!isObj(d)) continue;
      if (d.type === "variant") rec.axes.push({ name, prop: used(camelName(name)), options: (d.options || []).map(String), default: d.default != null ? String(d.default) : String((d.options || [])[0] ?? "") });
      else propList.push({ name, prop: d.type === "slot" && slotCount === 1 ? used("children") : used(camelName(name)), type: d.type, default: d.default, preferred: d.preferred });
    }
    rec.props = propList;
    if (owner.type === "componentSet") {
      const kids = (ix.get(owner.id) || []).filter((k) => nodes[k]?.type === "component");
      rec.defaultVariant = pickVariant(model, owner, {})?.id || kids[0] || null;
      const slugs = uniquer("-");
      for (const k of kids) {
        const c = nodes[k];
        const values = {};
        for (const ax of rec.axes) values[ax.name] = String(isObj(c.variant) && c.variant[ax.name] != null ? c.variant[ax.name] : ax.default);
        rec.variants.push({ id: k, values, slug: slugs(kebab(rec.axes.map((a) => values[a.name]).join(" "), "variant")), root: lowerComponent(c, defs) });
      }
    } else {
      rec.defaultVariant = owner.id;
      rec.variants.push({ id: owner.id, values: {}, slug: "default", root: lowerComponent(owner, defs) });
    }
    if (rec.variants.length && rec.defaultVariant) {
      const d = rec.variants.find((v) => v.id === rec.defaultVariant) || rec.variants[0];
      rec.variants = [d, ...rec.variants.filter((v) => v !== d)];
      rec.shared = rec.variants.every((v) => sameShape(d.root, v.root));
    }
  }
  function lowerComponent(comp, defs) {
    const r = resolver.tree(comp.id);
    if (!r) return null;
    const binds = bindingsOf(model, comp);
    const slots = new Map([...slotTargets(model, comp, defs, binds)].map(([prop, layer]) => [layer, prop]));
    const root = lowerTree(r, { comp: { binds, defs, slots }, inline: false });
    if (root) root.base = "root";
    return root;
  }

  const components = compOrder.map((id) => comps.get(id)).filter((c) => c.variants.some((v) => v.root));
  for (const w of resolver.warnings || []) warn(w.code, w.key, w.message);
  return {
    screens,
    components,
    assets: [...assets.values()].sort(byStr((a) => a.file)),
    vars: varRules(model),
    fonts: [...fonts].sort(),
    warnings,
    breakpoints: Array.isArray(model.breakpoints) ? model.breakpoints : [],
  };
}

const BOX_SHORTHAND = new Set(["padding", "border-radius", "border-width"]);
/** "8px 8px 8px 8px" → "8px", "8px 4px 8px 4px" → "8px 4px" (values with spaces inside parentheses stay whole). */
export function shortBox(v) {
  const p = String(v).split(/\s+(?![^(]*\))/);
  if (p.length !== 4) return v;
  const [t, r, b, l] = p;
  if (r === l) return t === b ? (t === r ? t : `${t} ${r}`) : `${t} ${r} ${b}`;
  return v;
}

const camelName = (s) => {
  const p = pascal(s, "");
  return p ? p[0].toLowerCase() + p.slice(1) : "prop";
};

/** Same element structure (types, elements, children, bindings) in two IR trees. */
export function sameShape(a, b) {
  if (!a || !b) return a === b;
  if (a.type !== b.type || a.el !== b.el || a.children.length !== b.children.length) return false;
  if (JSON.stringify(a.bind || null) !== JSON.stringify(b.bind || null) || (a.slot || null) !== (b.slot || null)) return false;
  if (!!a.instance !== !!b.instance || (a.instance && (a.instance.comp !== b.instance.comp || !!a.instance.inline !== !!b.instance.inline))) return false;
  if (!!a.text !== !!b.text || (a.text && (a.text.runs.length !== b.text.runs.length || (!a.bind?.text && a.text.runs.some((r, i) => r.text !== b.text.runs[i].text))))) return false;
  if (a.svg && JSON.stringify({ ...a.svg, w: 0, h: 0 }) !== JSON.stringify({ ...b.svg, w: 0, h: 0 })) return false;
  if ((a.image?.asset?.id || null) !== (b.image?.asset?.id || null)) return false;
  return a.children.every((c, i) => sameShape(c, b.children[i]));
}

/**
 * Responsive screens: top-level frames with the same name on one page whose layers match one to one become one
 * screen; the widest is the base and the narrower ones add `@media (max-width: …)` differences (desktop first, with the
 * design's breakpoints).
 */
function mergeBreakpoints(model, screens, warn) {
  const bps = (Array.isArray(model.breakpoints) ? model.breakpoints : []).filter((b) => isObj(b) && typeof b.w === "number").sort((a, b) => a.w - b.w);
  const groups = new Map();
  for (const s of screens) {
    const n = model.nodes[s.id];
    const w = field(n, "w");
    if (!s.top || n.type !== "frame" || w.mode !== "fixed") continue;
    const k = `${s.page}\n${(n.name || "").trim().toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ s, w: w.value });
  }
  const drop = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.w - a.w);
    const base = list[0];
    for (const alt of list.slice(1)) {
      if (alt.w === base.w || !sameShape(base.s.root, alt.s.root)) {
        warn("breakpoint", alt.s.id, `“${model.nodes[alt.s.id].name}” has the name of another frame but different layers; it is exported as its own screen.`);
        continue;
      }
      const bp = bps.find((b) => b.w >= alt.w && b.w < base.w);
      const width = bp ? bp.w : alt.w;
      const pairs = [];
      const pair = (a, b) => {
        pairs.push([a, b]);
        a.children.forEach((c, i) => pair(c, b.children[i]));
      };
      pair(base.s.root, alt.s.root);
      base.s.media.push({ query: `(max-width: ${width}px)`, width, id: alt.s.id, pairs });
      drop.add(alt.s);
    }
    base.s.media.sort((a, b) => b.width - a.width);
  }
  for (let i = screens.length - 1; i >= 0; i--) if (drop.has(screens[i])) screens.splice(i, 1);
}
