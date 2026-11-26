// SwiftUI emitter of the Proto code export (docs/concepts/proto-studio.md §10.1, task T7; best effort). Pure: no DOM.
//
//   emitSwiftUI(ir, { model }) → { files, entry }
// Flex layouts become HStack / VStack with spacing and alignment (space-between, center and end with Spacers), grids
// become Grid with GridRows, layers without auto layout and absolute layers become ZStack / overlays with offsets;
// padding, frame (fixed, fill as maxWidth / maxHeight .infinity, min and max), background (colors, linear and radial
// gradients, images), corner radius, inside strokes as overlays, drop shadows, opacity and rotation are modifiers;
// text layers are Text with font, weight, color, alignment, tracking, case, decoration and line limits. Variables
// become Color and CGFloat extensions in Tokens.swift (light and dark values where a collection has those modes).
// Components become structs with their properties (variant axes as enums, swap and slot properties as AnyView);
// vector layers and images are written to Assets/ and shown with Image("name"). What SwiftUI cannot express (blend
// modes, layer and background blur, conic gradients, inner shadows, wrapping flex, grid spans, sticky layers) is
// listed in a comment at the layer.
import { variableValue, modeIdsOf } from "../variables.js";
import { field } from "../schema.js";
import { textStyleOf, fmt } from "../css.js";
import { svgFile } from "./html.js";
import { isObj, pascal, camel, uniquer, kebab } from "./util.js";

const SWIFT_KEYWORDS = new Set("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try".split(" "));
const swiftCase = (s) => {
  const c = camel(String(s), "value");
  const id = c.replace(/Prop$/, "") || "value";
  return SWIFT_KEYWORDS.has(id) ? `\`${id}\`` : id;
};
const str = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
const n2 = (v) => fmt(typeof v === "number" && Number.isFinite(v) ? v : 0);

function hexParts(hex) {
  let h = String(hex).slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const r3 = (x) => Math.round(x * 1000) / 1000;
export function swiftColor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{3,8}$/i.test(hex)) return "Color.clear";
  const [r, g, b, a] = hexParts(hex);
  return `Color(red: ${r3(r)}, green: ${r3(g)}, blue: ${r3(b)}${a < 1 ? `, opacity: ${r3(a)}` : ""})`;
}

export function emitSwiftUI(ir, { model } = {}) {
  const files = [];
  const items = model?.vars?.items || {};
  const colls = model?.vars?.collections || {};
  const tokenNames = new Map();
  const tokenUnique = uniquer("");
  for (const id of Object.keys(items).sort()) tokenNames.set(id, tokenUnique(camel(items[id].name || id, "token").replace(/Prop$/, "")));
  const compById = new Map(ir.components.map((c) => [c.id, c]));
  const viewName = (rec) => (rec.name.endsWith("View") ? rec.name : `${rec.name}View`);
  const assetNames = uniquer("-");
  const vectorAssets = new Map();

  // ---------------------------------------------------------------------------------------------- values
  const colorOf = (n, path, literal, opacity = 1) => {
    const v = n.r.bound?.[path];
    const base = v && items[v]?.type === "color" ? `Color.${tokenNames.get(v)}` : swiftColor(literal);
    return opacity < 1 ? `${base}.opacity(${r3(opacity)})` : base;
  };
  const numOf = (n, path, literal) => {
    const v = n.r.bound?.[path];
    return v && items[v]?.type === "number" ? `.${tokenNames.get(v)}` : n2(literal);
  };

  // ---------------------------------------------------------------------------------------------- views
  /** Lines of a view expression with its modifiers. o: { bindings, propOf } */
  function view(n, o, depth) {
    const pad = "  ".repeat(depth);
    const node = n.r.node;
    const notes = [];
    let lines;
    if (n.instance && !n.instance.inline && compById.has(n.instance.comp)) {
      const rec = compById.get(n.instance.comp);
      const args = [];
      for (const a of rec.axes) if (n.instance.variant[a.name] !== undefined) args.push(`${a.prop}: .${swiftCase(n.instance.variant[a.name])}`);
      for (const p of rec.props) {
        const v = n.instance.props[p.name];
        if (v !== undefined) args.push(`${p.prop}: ${typeof v === "string" ? str(v) : JSON.stringify(v)}`);
        if (n.instance.swaps[p.name] && compById.has(n.instance.swaps[p.name])) args.push(`${p.prop}: AnyView(${viewName(compById.get(n.instance.swaps[p.name]))}())`);
      }
      for (const p of rec.props.filter((x) => x.type === "slot")) {
        const list = n.instance.slots?.[p.name];
        const one = (c) => view(c, { ...o, bindings: false }, 0).map((l) => l.trim()).filter((l) => !l.startsWith("//")).join("");
        if (list?.length) args.push(`${p.prop === "children" ? "content" : p.prop}: AnyView(${list.length === 1 ? one(list[0]) : `Group { ${list.map(one).join("; ")} }`})`);
      }
      lines = [`${pad}${viewName(rec)}(${args.join(", ")})`];
      lines.push(...placement(n, pad));
      return wrap(n, lines, o, pad);
    }
    if (o.bindings && n.bind?.swap) return wrap(n, [`${pad}${o.propOf(n.bind.swap)}`], o, pad);
    if (o.bindings && (n.slot || n.bind?.children)) {
      lines = [`${pad}${o.propOf(n.slot || n.bind.children)}`];
      return wrap(n, [...lines, ...frameMods(n, pad, notes)], o, pad);
    }
    if (n.type === "text") lines = textView(n, o, pad);
    else if (n.svg) {
      let a = vectorAssets.get(n.key);
      if (!a) {
        a = assetNames(kebab(n.name, "vector"));
        vectorAssets.set(n.key, a);
        files.push({ path: `Assets/${a}.svg`, text: svgFile(n) });
      }
      lines = [`${pad}Image(${str(a)})`, `${pad}  .resizable()`];
    } else if (n.image) lines = [`${pad}Image(${str(n.image.asset.file.replace(/\.[a-z0-9]+$/, ""))})`, `${pad}  .resizable()`, `${pad}  .aspectRatio(contentMode: ${n.decls.some(([p, v]) => p === "object-fit" && v === "contain") ? ".fit" : ".fill"})`];
    else if (n.type === "ellipse") lines = [`${pad}Ellipse()`, `${pad}  .fill(${fillStyle(n, notes) || "Color.clear"})`];
    else lines = container(n, o, pad, notes);
    if (n.type !== "ellipse") lines.push(...boxMods(n, pad, notes));
    else lines.push(...frameMods(n, pad, notes), ...effectMods(n, pad, notes));
    if (node.a11y?.label) lines.push(`${pad}  .accessibilityLabel(${str(node.a11y.label)})`);
    if (n.image?.alt) lines.push(`${pad}  .accessibilityLabel(${str(n.image.alt)})`);
    if (n.svg) lines.push(`${pad}  .accessibilityHidden(true)`);
    if (notes.length) lines.unshift(`${pad}// Not mapped: ${[...new Set(notes)].join(", ")}`);
    return wrap(n, lines, o, pad);
  }
  function wrap(n, lines, o, pad) {
    if (o.bindings && n.bind?.visible) return [`${pad}if ${o.propOf(n.bind.visible)} {`, ...lines.map((l) => `  ${l}`), `${pad}}`];
    return lines;
  }

  function textView(n, o, pad) {
    const st = textStyleOf(n.r.node);
    const runs = n.r.node.text?.runs || [];
    let expr;
    if (o.bindings && n.bind?.text) expr = `Text(${o.propOf(n.bind.text)})`;
    else
      expr =
        runs
          .map((run) => {
            let t = `Text(${str(run?.t ?? "")})`;
            const s = isObj(run?.s) ? run.s : {};
            if (s.weight && s.weight !== st.weight) t += `.fontWeight(${weight(s.weight)})`;
            if (s.italic) t += ".italic()";
            if (s.color && s.color !== st.color && typeof s.color === "string") t += `.foregroundColor(${swiftColor(s.color)})`;
            if (s.size && s.size !== st.size) t += `.font(.system(size: ${n2(s.size)}))`;
            return t;
          })
          .join(" + ") || 'Text("")';
    if (runs.length > 1 && !(o.bindings && n.bind?.text)) expr = `(${expr})`;
    const lines = [pad + expr];
    const fam = String(st.font || "Inter");
    const size = numOf(n, "text.style.size", st.size);
    lines.push(/^(system-ui|sans-serif)$/i.test(fam) ? `${pad}  .font(.system(size: ${size}))` : `${pad}  .font(.custom(${str(fam)}, size: ${size}))`);
    if (st.weight && st.weight !== 400) lines.push(`${pad}  .fontWeight(${weight(st.weight)})`);
    if (st.italic) lines.push(`${pad}  .italic()`);
    if (typeof st.color === "string") lines.push(`${pad}  .foregroundStyle(${colorOf(n, "text.style.color", st.color)})`);
    if (st.align && st.align !== "left") lines.push(`${pad}  .multilineTextAlignment(${{ center: ".center", right: ".trailing", justify: ".leading" }[st.align] || ".leading"})`);
    if (st.tracking) lines.push(`${pad}  .kerning(${n2(st.tracking)})`);
    if (st.case === "upper") lines.push(`${pad}  .textCase(.uppercase)`);
    if (st.case === "lower") lines.push(`${pad}  .textCase(.lowercase)`);
    if (st.decoration === "underline") lines.push(`${pad}  .underline()`);
    if (st.decoration === "strike") lines.push(`${pad}  .strikethrough()`);
    const lh = st.lineHeight;
    if (isObj(lh) && typeof lh.pct === "number" && typeof st.size === "number") {
      const extra = (st.size * lh.pct) / 100 - st.size * 1.2;
      if (Math.abs(extra) >= 0.5) lines.push(`${pad}  .lineSpacing(${n2(Math.round(extra * 10) / 10)})`);
    }
    const max = n.r.node.text?.maxLines;
    if (typeof max === "number") lines.push(`${pad}  .lineLimit(${Math.round(max)})`);
    if ((n.r.node.text?.autoSize || "width") === "width") lines.push(`${pad}  .fixedSize()`);
    return lines;
  }

  function container(n, o, pad, notes) {
    const L = n.box.layout;
    const kids = n.children;
    const flow = kids.filter((c) => c.box.pos === "flow");
    const abs = kids.filter((c) => c.box.pos !== "flow");
    if (!kids.length) return [`${pad}Color.clear`];
    const body = [];
    const stack = (c) => body.push(...view(c, o, pad.length / 2 + 1));
    let head;
    if (L.type === "flex") {
      const row = L.dir === "row";
      if (L.wrap) notes.push("wrapping");
      const al = row ? { start: ".top", center: ".center", end: ".bottom", baseline: ".firstTextBaseline", stretch: ".top" }[L.align] : { start: ".leading", center: ".center", end: ".trailing", stretch: ".leading", baseline: ".leading" }[L.align];
      const def = row ? ".center" : ".center";
      head = `${row ? "HStack" : "VStack"}(${al && al !== def ? `alignment: ${al}, ` : ""}spacing: ${numOf(n, "layout.gap", L.gap)})`;
      const sp = `${pad}  Spacer(minLength: 0)`;
      if (L.justify === "end" || L.justify === "center") body.push(sp);
      flow.forEach((c, i) => {
        if (i && (L.justify === "space-between" || L.justify === "space-around" || L.justify === "space-evenly")) body.push(sp);
        stack(c);
      });
      if (L.justify === "start" || L.justify === "center") body.push(sp);
    } else if (L.type === "grid") {
      head = `Grid(horizontalSpacing: ${numOf(n, "layout.gap", L.gap)}, verticalSpacing: ${n2(L.rowGap)})`;
      const cols = Math.max(1, L.grid.cols.length);
      if (flow.some((c) => c.r.node.cell)) notes.push("grid placement");
      for (let i = 0; i < flow.length; i += cols) {
        body.push(`${pad}  GridRow {`);
        for (const c of flow.slice(i, i + cols)) body.push(...view(c, o, pad.length / 2 + 2));
        body.push(`${pad}  }`);
      }
    } else {
      head = "ZStack(alignment: .topLeading)";
      kids.forEach(stack);
    }
    const lines = [`${pad}${head} {`, ...body, `${pad}}`];
    if (L.type !== "none" && abs.length) {
      lines.push(`${pad}.overlay(alignment: .topLeading) {`);
      lines.push(`${pad}  ZStack(alignment: .topLeading) {`);
      for (const c of abs) lines.push(...view(c, o, pad.length / 2 + 2));
      lines.push(`${pad}  }`, `${pad}}`);
    }
    return lines;
  }

  function placement(n, pad) {
    const out = [];
    if (n.box.pos === "abs") {
      // the design-time position (constraints other than left/top are not mapped)
      const ox = field(n.r.node, "x");
      const oy = field(n.r.node, "y");
      if (ox || oy) out.push(`${pad}  .offset(x: ${n2(ox)}, y: ${n2(oy)})`);
    }
    return out;
  }

  function frameMods(n, pad, notes) {
    const out = [];
    const { w, h } = n.box;
    const parts = [];
    const ax = (s, dim) => {
      if (s.mode === "fixed") parts.push(`${dim}: ${n2(s.value)}`);
      else if (s.mode === "fill") parts.push(`max${dim[0].toUpperCase()}${dim.slice(1)}: .infinity`);
      else if (s.mode === "rel") notes.push("relative size");
      if (s.min != null) parts.push(`min${dim[0].toUpperCase()}${dim.slice(1)}: ${n2(s.min)}`);
      if (s.max != null && s.mode !== "fill") parts.push(`max${dim[0].toUpperCase()}${dim.slice(1)}: ${n2(s.max)}`);
    };
    if (n.type !== "text" || n.r.node.text?.autoSize === "fixed" || n.r.node.text?.autoSize === "height") ax(w, "width");
    if (n.type !== "text" || n.r.node.text?.autoSize === "fixed") ax(h, "height");
    const order = (p) => ["minWidth", "width", "maxWidth", "minHeight", "height", "maxHeight"].indexOf(p.split(":")[0]);
    parts.sort((a, b) => order(a) - order(b));
    const fixedOnly = parts.every((p) => /^(width|height):/.test(p));
    if (parts.length) out.push(`${pad}  .frame(${parts.join(", ")}${fixedOnly ? "" : ", alignment: .topLeading"})`);
    return out;
  }

  function fillStyle(n, notes) {
    const fills = (Array.isArray(n.r.node.fills) ? n.r.node.fills : []).map((f, i) => [f, i]).filter(([f]) => isObj(f) && f.visible !== false);
    if (!fills.length) return null;
    if (fills.length > 1) notes.push("several fills (the top one is used)");
    const [f, i] = fills[fills.length - 1];
    const op = typeof f.opacity === "number" ? f.opacity : 1;
    if (f.type === "solid") return colorOf(n, `fills.${i}.color`, f.color, op);
    const stops = (f.stops || []).map((s, j) => `.init(color: ${colorOf(n, `fills.${i}.stops.${j}.color`, s.color, op)}, location: ${n2(s.at)})`).join(", ");
    if (f.type === "linear") {
      const a = (((typeof f.angle === "number" ? f.angle : 180) % 360) + 360) % 360;
      const rad = (a * Math.PI) / 180;
      const dx = r3(Math.sin(rad) / 2);
      const dy = r3(-Math.cos(rad) / 2);
      return `LinearGradient(stops: [${stops}], startPoint: UnitPoint(x: ${r3(0.5 - dx)}, y: ${r3(0.5 - dy)}), endPoint: UnitPoint(x: ${r3(0.5 + dx)}, y: ${r3(0.5 + dy)}))`;
    }
    if (f.type === "radial") return `RadialGradient(stops: [${stops}], center: .center, startRadius: 0, endRadius: 200)`;
    if (f.type === "conic") {
      notes.push("conic gradient (angular)");
      return `AngularGradient(stops: [${stops}], center: .center)`;
    }
    return null;
  }

  function effectMods(n, pad, notes) {
    const out = [];
    const node = n.r.node;
    for (const [e, i] of (Array.isArray(node.effects) ? node.effects : []).map((e, i) => [e, i])) {
      if (!isObj(e) || e.visible === false) continue;
      if (e.type === "shadow" && !e.inset) out.push(`${pad}  .shadow(color: ${colorOf(n, `effects.${i}.color`, e.color)}, radius: ${n2((e.blur || 0) / 2)}, x: ${n2(e.x)}, y: ${n2(e.y)})`);
      else if (e.type === "shadow") notes.push("inner shadow");
      else if (e.type === "blur") out.push(`${pad}  .blur(radius: ${n2((e.radius || 0) / 2)})`);
      else notes.push("background blur");
    }
    const op = field(node, "opacity");
    if (op < 1) out.push(`${pad}  .opacity(${numOf(n, "opacity", op)})`);
    if (field(node, "rot")) out.push(`${pad}  .rotationEffect(.degrees(${n2(node.rot)}))`);
    if (field(node, "blend") !== "normal") notes.push("blend mode");
    if (node.sticky) notes.push("sticky");
    return out;
  }

  function boxMods(n, pad, notes) {
    const out = [];
    const node = n.r.node;
    const L = n.box.layout;
    if (n.type !== "text" && L.pad.some((p) => p > 0)) {
      const [t, r, b, l] = L.pad;
      if (t === r && r === b && b === l) out.push(`${pad}  .padding(${numOf(n, "layout.pad.0", t)})`);
      else out.push(`${pad}  .padding(EdgeInsets(top: ${numOf(n, "layout.pad.0", t)}, leading: ${numOf(n, "layout.pad.3", l)}, bottom: ${numOf(n, "layout.pad.2", b)}, trailing: ${numOf(n, "layout.pad.1", r)}))`);
    }
    out.push(...frameMods(n, pad, notes));
    const rad = Array.isArray(node.radius) ? node.radius : typeof node.radius === "number" ? [node.radius, node.radius, node.radius, node.radius] : [0, 0, 0, 0];
    const uniform = rad.every((x) => x === rad[0]);
    const shape = rad.some((x) => x > 0) ? (uniform ? `RoundedRectangle(cornerRadius: ${numOf(n, "radius", rad[0])})` : `UnevenRoundedRectangle(topLeadingRadius: ${n2(rad[0])}, bottomLeadingRadius: ${n2(rad[3])}, bottomTrailingRadius: ${n2(rad[2])}, topTrailingRadius: ${n2(rad[1])})`) : null;
    if (!n.svg && !n.image && n.type !== "text") {
      const fill = fillStyle(n, notes);
      const img = (node.fills || []).find((f) => isObj(f) && f.type === "image" && f.visible !== false);
      if (img && !n.image) out.push(`${pad}  .background(Image(${str(kebab(model?.media?.[img.media]?.name?.replace(/\.[a-z0-9]+$/i, "") || img.media, "image"))}).resizable().scaledToFill())`);
      else if (fill) out.push(`${pad}  .background(${fill})`);
    }
    const strokes = (Array.isArray(node.strokes) ? node.strokes : []).map((s, i) => [s, i]).filter(([s]) => isObj(s) && s.visible !== false && s.w > 0);
    if (strokes.length && n.type !== "text" && !n.svg) {
      const [s, i] = strokes[0];
      out.push(`${pad}  .overlay(${shape || "Rectangle()"}.${s.align === "outside" ? "stroke" : "strokeBorder"}(${colorOf(n, `strokes.${i}.color`, s.color)}, lineWidth: ${numOf(n, `strokes.${i}.w`, s.w)}))`);
      if (strokes.length > 1) notes.push("several strokes");
    }
    if (shape && !n.svg) out.push(`${pad}  .clipShape(${shape})`);
    else if (field(node, "clip")) out.push(`${pad}  .clipped()`);
    out.push(...effectMods(n, pad, notes));
    if (field(node, "scroll") !== "none") notes.push("scrolling (wrap the view in a ScrollView)");
    out.push(...placement(n, pad));
    return out;
  }

  const weight = (w) => `.${{ 100: "ultraLight", 200: "thin", 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "heavy", 900: "black" }[Math.round(w / 100) * 100] || "regular"}`;

  // ---------------------------------------------------------------------------------------------- components
  for (const rec of ir.components) {
    const name = viewName(rec);
    const lines = ["// Generated by OpenFini Proto from the design's component (best effort; see the notes).", "import SwiftUI", "", `struct ${name}: View {`];
    for (const a of rec.axes) {
      lines.push(`  enum ${pascal(a.name, "Variant")}: String, CaseIterable {`);
      lines.push(`    case ${a.options.map(swiftCase).join(", ")}`);
      lines.push("  }");
    }
    for (const a of rec.axes) lines.push(`  var ${a.prop}: ${pascal(a.name, "Variant")} = .${swiftCase(a.default)}`);
    for (const p of rec.props) {
      if (p.type === "text") lines.push(`  var ${p.prop}: String = ${str(p.default ?? "")}`);
      else if (p.type === "number") lines.push(`  var ${p.prop}: Double = ${n2(p.default)}`);
      else if (p.type === "bool") lines.push(`  var ${p.prop}: Bool = ${p.default === true}`);
      else if (p.type === "swap") {
        const d = ir.components.find((c) => c.id === p.default || c.variants.some((v) => v.id === p.default));
        lines.push(`  var ${p.prop}: AnyView = AnyView(${d ? `${viewName(d)}()` : "EmptyView()"})`);
      } else if (p.type === "slot") lines.push(`  var ${p.prop === "children" ? "content" : p.prop}: AnyView = AnyView(EmptyView())`);
    }
    const propOf = (nm) => {
      const p = rec.props.find((x) => x.name === nm);
      return p ? (p.type === "slot" && p.prop === "children" ? "content" : p.prop) : camel(nm);
    };
    const o = { bindings: true, propOf };
    lines.push("", "  var body: some View {");
    if (rec.variants.length > 1 && rec.axes.length) {
      lines.push(`    switch (${rec.axes.map((a) => a.prop).join(", ")}) {`);
      for (const v of rec.variants.slice(1)) {
        lines.push(`    case (${rec.axes.map((a) => `.${swiftCase(v.values[a.name])}`).join(", ")}):`);
        lines.push(...view(v.root, o, 3));
      }
      lines.push("    default:", ...view(rec.variants[0].root, o, 3), "    }");
    } else lines.push(...view(rec.variants[0].root, o, 2));
    lines.push("  }", "}", "", "#Preview {", `  ${name}()`, "}", "");
    files.push({ path: `Components/${name}.swift`, text: lines.join("\n") });
  }

  // ---------------------------------------------------------------------------------------------- screens
  for (const s of ir.screens) {
    const name = s.name.endsWith("View") ? s.name : `${s.name}View`;
    const lines = ["// Generated by OpenFini Proto from the design (best effort; see the notes).", "import SwiftUI", "", `struct ${name}: View {`, "  var body: some View {"];
    lines.push(...view(s.root, { bindings: false }, 2));
    if (s.media.length) lines.splice(4, 0, `  // Breakpoint variants of this screen are not exported to SwiftUI: ${s.media.map((m) => m.query).join(", ")}`);
    lines.push("  }", "}", "", "#Preview {", `  ${name}()`, "}", "");
    files.push({ path: `Screens/${name}.swift`, text: lines.join("\n") });
  }

  // ---------------------------------------------------------------------------------------------- tokens
  const tok = ["// Generated by OpenFini Proto from the design's variables. Do not edit by hand.", "import SwiftUI", ""];
  const colorIds = Object.keys(items).filter((id) => items[id].type === "color" && colls[items[id].coll]).sort((a, b) => (tokenNames.get(a) < tokenNames.get(b) ? -1 : 1));
  const numIds = Object.keys(items).filter((id) => items[id].type === "number" && colls[items[id].coll]).sort((a, b) => (tokenNames.get(a) < tokenNames.get(b) ? -1 : 1));
  if (colorIds.length) {
    tok.push("extension Color {");
    tok.push("  /// A color with a light and a dark value (follows the system appearance).");
    tok.push("  init(light: Color, dark: Color) {");
    tok.push("    #if canImport(UIKit)");
    tok.push("    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })");
    tok.push("    #else");
    tok.push("    self = light");
    tok.push("    #endif");
    tok.push("  }", "");
    for (const id of colorIds) {
      const c = items[id].coll;
      const modes = modeIdsOf(colls, c);
      const names = (colls[c].modes || []).map((m) => String(m?.name || m?.id || "").toLowerCase());
      const li = names.findIndex((x) => /light/.test(x));
      const di = names.findIndex((x) => /dark/.test(x));
      const def = swiftColor(variableValue(model, id, {}));
      if (li >= 0 && di >= 0) tok.push(`  static let ${tokenNames.get(id)} = Color(light: ${swiftColor(variableValue(model, id, { [c]: modes[li] }))}, dark: ${swiftColor(variableValue(model, id, { [c]: modes[di] }))})`);
      else tok.push(`  static let ${tokenNames.get(id)} = ${def}`);
    }
    tok.push("}", "");
  }
  if (numIds.length) {
    tok.push("extension CGFloat {");
    for (const id of numIds) tok.push(`  static let ${tokenNames.get(id)}: CGFloat = ${n2(variableValue(model, id, {}))}`);
    tok.push("}", "");
  }
  files.push({ path: "Tokens.swift", text: tok.join("\n") });
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const a of ir.assets) if (a.bytes) files.push({ path: `Assets/${a.file}`, bytes: a.bytes, mime: a.mime });
  return { files, entry: ir.screens.length ? `Screens/${ir.screens[0].name.endsWith("View") ? ir.screens[0].name : `${ir.screens[0].name}View`}.swift` : "Tokens.swift" };
}
