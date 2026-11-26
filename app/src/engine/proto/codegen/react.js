// React emitter of the Proto code export (docs/concepts/proto-studio.md §10.1, task T7). Pure: no DOM.
//
//   emitReact(ir, { styling: "modules" | "tailwind", ts = true, model }) → { files, entry }
// One component per main component (or component set): variant axes become union-typed props, text, number and
// bool properties become props, swap properties and slots become ReactNode props (one slot is `children`), and a
// `className` prop places the component where it is used. Variants that share one structure differ only in styles
// (CSS Modules: rules on `[data-variant="…"]`; Tailwind: a class table per variant); variants with different layers
// render one branch each. Screens are components that use the components. Instances with overrides inside them are
// written out as their layers. A component with a code link (`code.react.path`) is imported, not generated.
//
// Files: src/components/<Name>.tsx (+ .module.css), src/screens/<Name>.tsx (+ .module.css), src/tokens.css (CSS
// Modules: variables and the reset; Tailwind: src/styles.css), src/cx.ts, src/index.ts, public/assets/*.
import { classNamer, cssRule, declDiff, jsxText, jsxAttr, jsStr, uniquer, camel, isObj } from "./util.js";
import { svgMarkup, RESET_CSS, varsCss, assetFiles } from "./html.js";
import { twClasses, tailwindCss, mediaClasses } from "./tailwind.js";

const VOID = new Set(["img", "input", "br", "hr"]);

/** Variant slug for every combination of axis values (best match, like components.js ▸ pickVariant). */
function variantTable(rec) {
  const axes = rec.axes;
  if (!axes.length) return null;
  let combos = [[]];
  for (const a of axes) {
    const opts = a.options.length ? a.options : [a.default];
    const next = [];
    for (const c of combos) for (const o of opts) next.push([...c, o]);
    combos = next;
    if (combos.length > 256) break;
  }
  if (combos.length > 256) combos = rec.variants.map((v) => axes.map((a) => v.values[a.name]));
  const table = [];
  for (const c of combos) {
    let best = rec.variants[0];
    let score = -1;
    for (const v of rec.variants) {
      let s = 0;
      axes.forEach((a, i) => v.values[a.name] === c[i] && s++);
      if (s > score) (best = v), (score = s);
    }
    table.push([c.join("/"), best.slug]);
  }
  return table;
}

/** Pairs of corresponding nodes in variant trees that share one structure: [[defaultNode, …otherNodes]]. */
function zipVariants(roots) {
  const out = [];
  const walk = (list) => {
    out.push(list);
    list[0].children.forEach((_, i) => walk(list.map((n) => n.children[i])));
  };
  walk(roots);
  return out;
}

/** Declarations every variant shares, and the rest per variant. */
function splitDecls(list) {
  const keyed = list.map((n) => new Map(n.decls));
  const common = list[0].decls.filter(([p, v]) => keyed.every((m) => m.get(p) === v));
  const ck = new Set(common.map(([p]) => p));
  return { common, rest: list.map((n) => n.decls.filter(([p]) => !ck.has(p))) };
}

export function emitReact(ir, { styling = "modules", ts = true, model } = {}) {
  const tw = styling === "tailwind";
  const ext = ts ? "tsx" : "jsx";
  const files = [];
  const compById = new Map(ir.components.map((c) => [c.id, c]));
  const screenRoute = new Map(ir.screens.map((s) => [s.id, `/${s.file}`]));

  // ---------------------------------------------------------------------------------------------- one file's styles
  function sheet() {
    const namer = classNamer();
    const names = uniquer("");
    const rules = [];
    const keyOf = new Map(); // css class → JS key
    let seq = 0;
    return {
      rules,
      /** CSS Modules: a class for decls; returns the JS key (styles.key). */
      cls(base, decls, { force = false } = {}) {
        const { cls, fresh } = namer(base, force ? [["--node", String(++seq)]] : decls);
        if (fresh) {
          keyOf.set(cls, names(camel(cls, "layer")));
          if (decls.length || force) rules.push(cssRule(`.${cls}`, decls));
        }
        return { cls, key: keyOf.get(cls) };
      },
      key: (cls) => keyOf.get(cls),
    };
  }
  const ref = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `styles.${key}` : `styles[${jsStr(key)}]`);

  // ---------------------------------------------------------------------------------------------- JSX
  /**
   * JSX lines of a node. o: { className(n) → expression | null, runClass(n, i) → expression | null, usage(n) → lines?,
   *   bindings: true inside a component definition, rootExtra: attribute text for the root }
   */
  function jsx(n, o, depth, isRoot = false) {
    const pad = "  ".repeat(depth);
    if (n.instance && !n.instance.inline && compById.has(n.instance.comp)) {
      const lines = usage(n, o, depth);
      return wrapVisible(n, lines, pad, o);
    }
    const attrs = [];
    const cn = o.className(n, isRoot);
    if (cn) attrs.push(`className=${cn.startsWith('"') ? cn : `{${cn}}`}`);
    if (n.el === "img") attrs.push(`src=${jsxAttr(n.image.asset.url)}`, `alt=${jsxAttr(n.image.alt)}`);
    if (n.el === "a") attrs.push(`href=${jsxAttr(typeof n.href === "string" ? n.href : screenRoute.get(n.href?.screen) || "#")}`);
    for (const k of Object.keys(n.attrs).sort()) attrs.push(`${k}=${jsxAttr(n.attrs[k])}`);
    if (isRoot && o.rootExtra) attrs.push(...o.rootExtra);
    const at = attrs.length ? ` ${attrs.join(" ")}` : "";
    let lines;
    if (n.svg) {
      lines = [pad + svgMarkup(n, cn ? (cn.startsWith('"') ? cn : `{${cn}}`) : "", { jsx: true, attrs: attrs.filter((a) => !a.startsWith("className=")).map((a) => ` ${a}`).join("") })];
    } else if (VOID.has(n.el)) lines = [`${pad}<${n.el}${at} />`];
    else {
      let inner = null;
      if (o.bindings && n.bind?.text) inner = [`{${o.propOf(n.bind.text)}}`];
      else if (o.bindings && (n.bind?.children || n.slot)) inner = [`{${o.propOf(n.bind?.children || n.slot)}}`];
      else if (n.text) {
        inner = [
          n.text.runs
            .map((run, i) => {
              const rc = o.runClass(n, i);
              const t = jsxText(run.text);
              return rc ? `<span className=${rc.startsWith('"') ? rc : `{${rc}}`}>${t}</span>` : t;
            })
            .join(""),
        ];
      }
      if (inner) lines = [`${pad}<${n.el}${at}>${inner.join("")}</${n.el}>`];
      else if (!n.children.length) lines = [`${pad}<${n.el}${at} />`];
      else {
        lines = [`${pad}<${n.el}${at}>`];
        for (const c of n.children) lines.push(...jsx(c, o, depth + 1));
        lines.push(`${pad}</${n.el}>`);
      }
    }
    return wrapVisible(n, lines, pad, o);
  }
  function wrapVisible(n, lines, pad, o) {
    if (!o.bindings) return lines;
    if (n.bind?.swap) {
      const p = o.propOf(n.bind.swap);
      lines = [`${pad}{${p}}`];
    }
    if (n.bind?.visible) {
      const p = o.propOf(n.bind.visible);
      if (lines.length === 1) return [`${pad}{${p} && ${lines[0].trim().replace(/^\{(.*)\}$/, "$1")}}`];
      return [`${pad}{${p} && (`, ...lines.map((l) => `  ${l}`), `${pad})}`];
    }
    return lines;
  }

  /** Usage of a component: <Button size="lg" label="Pay now" className={…} />. */
  function usage(n, o, depth) {
    const pad = "  ".repeat(depth);
    const rec = compById.get(n.instance.comp);
    const link = rec.code?.react;
    const map = isObj(link?.props) ? link.props : {};
    const name = (p) => map[p.name] || p.prop;
    const attrs = [];
    for (const a of rec.axes) if (n.instance.variant[a.name] !== undefined) attrs.push(`${map[a.name] || a.prop}=${jsxAttr(n.instance.variant[a.name])}`);
    for (const p of rec.props) {
      if (n.instance.props[p.name] !== undefined) {
        const v = n.instance.props[p.name];
        attrs.push(typeof v === "string" ? `${name(p)}=${jsxAttr(v)}` : v === true ? name(p) : `${name(p)}={${JSON.stringify(v)}}`);
      }
      if (n.instance.swaps[p.name]) attrs.push(`${name(p)}={<${compById.get(n.instance.swaps[p.name])?.name || "Fragment"} />}`);
    }
    const cn = o.usageClass ? o.usageClass(n) : null;
    if (cn) attrs.push(`className=${cn.startsWith('"') ? cn : `{${cn}}`}`);
    const slots = n.instance.slots || {};
    let kids = null;
    for (const p of rec.props.filter((x) => x.type === "slot")) {
      const list = slots[p.name];
      if (!list?.length) continue;
      if (p.prop === "children") kids = list;
      else {
        const inner = list.flatMap((c) => jsx(c, { ...o, bindings: false }, 0));
        attrs.push(inner.length === 1 ? `${p.prop}={${inner[0]}}` : `${p.prop}={<>${inner.join(" ")}</>}`);
      }
    }
    const at = attrs.length ? ` ${attrs.join(" ")}` : "";
    if (!kids) return [`${pad}<${rec.name}${at} />`];
    return [`${pad}<${rec.name}${at}>`, ...kids.flatMap((c) => jsx(c, { ...o, bindings: false }, depth + 1)), `${pad}</${rec.name}>`];
  }

  // ---------------------------------------------------------------------------------------------- shared styling helpers
  /** Class expression for a usage: the instance's differences from the component root. */
  function usageDiff(n) {
    const rec = compById.get(n.instance.comp);
    if (!rec) return [];
    const want = { ...Object.fromEntries(rec.axes.map((a) => [a.name, a.default])), ...n.instance.variant };
    const v = rec.variants.find((x) => rec.axes.every((a) => x.values[a.name] === want[a.name])) || rec.variants[0];
    return { diff: declDiff(v.root.decls, n.decls), root: v.root.decls };
  }

  /** Styling of a screen or a component body: returns { o, css } (CSS Modules) or { o } (Tailwind). */
  function plainStyling(roots, st, extra = new Map()) {
    const classOf = new Map();
    const runOf = new Map();
    const cssOf = new Map();
    const visit = (n) => {
      if (n.instance && !n.instance.inline && compById.has(n.instance.comp)) {
        const { diff, root } = usageDiff(n);
        if (diff.length) {
          if (tw) {
            const rootProps = new Set(root.map(([p]) => p));
            classOf.set(n, `"${twClasses(diff).map((c, i) => (rootProps.has(diff[i]?.[0]) ? `${c}!` : c)).join(" ")}"`);
          } else {
            const c = st.cls(n.base, diff);
            cssOf.set(n, c.cls);
            classOf.set(n, ref(c.key));
          }
        }
        for (const list of Object.values(n.instance.slots || {})) list.forEach(visit);
        return;
      }
      if (tw) {
        const c = [...twClasses(n.decls), ...(extra.get(n) || [])].join(" ");
        if (c) classOf.set(n, `"${c}"`);
        n.text?.runs.forEach((r, i) => r.decls.length && runOf.set(`${n.key}#${i}`, `"${twClasses(r.decls).join(" ")}"`));
      } else {
        const c = st.cls(n.base, n.decls);
        cssOf.set(n, c.cls);
        classOf.set(n, ref(c.key));
        n.text?.runs.forEach((r, i) => r.decls.length && runOf.set(`${n.key}#${i}`, ref(st.cls(`${n.base}-span`, r.decls).key)));
      }
      n.children.forEach(visit);
    };
    roots.forEach(visit);
    return { classOf, runOf, cssOf };
  }

  // ---------------------------------------------------------------------------------------------- components
  const imports = (body, self) => {
    const used = new Set();
    for (const m of body.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) if (m[1] !== self && compById.has([...compById.values()].find((c) => c.name === m[1])?.id)) used.add(m[1]);
    return [...used].sort();
  };
  const importLine = (name, from) => {
    const rec = [...compById.values()].find((c) => c.name === name);
    const link = rec?.code?.react;
    if (link?.path) return `import { ${link.export && link.export !== name ? `${link.export} as ${name}` : name} } from ${jsStr(link.path.replace(/\.(tsx?|jsx?)$/, ""))};`;
    return `import { ${name} } from "${from}${name}";`;
  };

  for (const rec of ir.components) {
    if (rec.code?.react?.path) continue; // linked to existing code
    const st = sheet();
    const props = rec.props;
    const propOf = (name) => props.find((p) => p.name === name)?.prop || camel(name);
    const roots = rec.variants.map((v) => v.root);
    const table = variantTable(rec);
    const defSlug = rec.variants[0].slug;
    const keyExpr = rec.axes.length === 1 ? rec.axes[0].prop : `\`${rec.axes.map((a) => `\${${a.prop}}`).join("/")}\``;
    const variantExpr = table ? `VARIANTS[${keyExpr}] ?? ${jsStr(defSlug)}` : null;
    const bodyLines = [];
    const top = [];
    const multi = rec.variants.length > 1;
    if (rec.shared || !multi) {
      // one structure: shared declarations on the layer's class, the rest per variant
      const zipped = zipVariants(roots);
      const classOf = new Map();
      const twVar = new Map(); // slug → { key: classes }
      const keys = uniquer("");
      for (const list of zipped) {
        const n = list[0];
        if (n.instance && !n.instance.inline && compById.has(n.instance.comp)) {
          const { diff } = usageDiff(n);
          if (diff.length) classOf.set(n, tw ? `"${twClasses(diff).join(" ")}"` : ref(st.cls(n.base, diff).key));
          continue;
        }
        const { common, rest } = multi ? splitDecls(list) : { common: n.decls, rest: [[]] };
        if (tw) {
          const k = keys(camel(n.base, "layer"));
          const base = twClasses(common).join(" ");
          let any = false;
          rec.variants.forEach((v, i) => {
            if (!rest[i].length) return;
            any = true;
            if (!twVar.has(v.slug)) twVar.set(v.slug, {});
            twVar.get(v.slug)[k] = twClasses(rest[i]).join(" ");
          });
          classOf.set(n, any ? `cx(${jsStr(base)}, v.${k}${n === roots[0] ? ", className" : ""})` : n === roots[0] ? `cx(${jsStr(base)}, className)` : `"${base}"`);
        } else {
          const { cls, key } = st.cls(n.base, common, { force: true });
          if (multi)
            rec.variants.forEach((v, i) => {
              if (!rest[i].length) return;
              const sel = n === roots[0] ? `.${cls}[data-variant="${v.slug}"]` : `.${classOf.get(roots[0])?.cls}[data-variant="${v.slug}"] .${cls}`;
              st.rules.push(cssRule(sel, rest[i]));
            });
          classOf.set(n, { cls, key });
        }
      }
      const runOf = new Map();
      for (const list of zipped) {
        const n = list[0];
        n.text?.runs.forEach((r, i) => r.decls.length && runOf.set(`${n.key}#${i}`, tw ? `"${twClasses(r.decls).join(" ")}"` : ref(st.cls(`${n.base}-span`, r.decls).key)));
      }
      const o = {
        bindings: true,
        propOf,
        className: (n, isRoot) => {
          const c = classOf.get(n);
          if (!c) return isRoot ? "className" : null;
          if (tw) return c;
          return isRoot ? `cx(${ref(c.key)}, className)` : ref(c.key);
        },
        runClass: (n, i) => runOf.get(`${n.key}#${i}`) || null,
        usageClass: (n) => (classOf.get(n) ? (tw ? classOf.get(n) : classOf.get(n)) : null),
        rootExtra: multi && !tw ? ["data-variant={variant}"] : multi ? ["data-variant={variant}"] : null,
      };
      if (tw && twVar.size) {
        top.push(`const VARIANT_CLASSES${ts ? ": Record<string, Record<string, string>>" : ""} = {`);
        for (const v of rec.variants) {
          const m = twVar.get(v.slug) || {};
          top.push(`  ${jsStr(v.slug)}: { ${Object.entries(m).map(([k, c]) => `${k}: ${jsStr(c)}`).join(", ")} },`);
        }
        top.push("};");
      }
      if (multi) bodyLines.push(`const variant = ${variantExpr};`);
      if (tw && twVar.size) bodyLines.push(`const v = VARIANT_CLASSES[variant] ?? {};`);
      bodyLines.push("return (", ...jsx(roots[0], o, 1, true), ");");
    } else {
      // different layers per variant: one branch each
      bodyLines.push(`const variant = ${variantExpr};`, "switch (variant) {");
      rec.variants.forEach((v, i) => {
        const { classOf, runOf } = plainStyling([v.root], st);
        const o = {
          bindings: true,
          propOf,
          className: (n, isRoot) => {
            const c = classOf.get(n);
            return isRoot ? (tw ? `cx(${c || '""'}, className)` : `cx(${c}, className)`) : c || null;
          },
          runClass: (n, j) => runOf.get(`${n.key}#${j}`) || null,
          usageClass: (n) => classOf.get(n) || null,
          rootExtra: ["data-variant={variant}"],
        };
        bodyLines.push(i === 0 ? "  default:" : `  case ${jsStr(v.slug)}:`, "    return (", ...jsx(v.root, o, 3, true), "    );");
      });
      // default first in the source reads oddly; move it to the end
      const start = bodyLines.indexOf("  default:");
      const firstCase = bodyLines.findIndex((l, k) => k > start && l.startsWith("  case "));
      if (firstCase > 0) {
        const def = bodyLines.splice(start, firstCase - start);
        bodyLines.splice(bodyLines.length, 0, ...def);
      }
      bodyLines.push("}");
    }
    if (table) top.unshift(`const VARIANTS${ts ? ": Record<string, string>" : ""} = {`, ...table.map(([k, s]) => `  ${jsStr(k)}: ${jsStr(s)},`), "};");
    // props and their defaults
    const types = [];
    const params = [];
    for (const a of rec.axes) {
      types.push(`  ${a.prop}?: ${a.options.map((x) => jsStr(x)).join(" | ") || "string"};`);
      params.push(`${a.prop} = ${jsStr(a.default)}`);
    }
    let needsNode = false;
    for (const p of props) {
      if (p.type === "text") types.push(`  ${p.prop}?: string;`), params.push(p.default !== undefined ? `${p.prop} = ${jsStr(p.default)}` : p.prop);
      else if (p.type === "number") types.push(`  ${p.prop}?: number;`), params.push(typeof p.default === "number" ? `${p.prop} = ${p.default}` : p.prop);
      else if (p.type === "bool") types.push(`  ${p.prop}?: boolean;`), params.push(`${p.prop} = ${p.default === true}`);
      else if (p.type === "swap") {
        needsNode = true;
        types.push(`  ${p.prop}?: ReactNode;`);
        const d = ir.components.find((c) => c.id === p.default || c.variants.some((v) => v.id === p.default)) || null;
        const swapNode = findBound(roots[0], "swap", p.name);
        const cls = swapNode && swapNode.instance && !tw ? (() => {
          const { diff } = usageDiff(swapNode);
          return diff.length ? ` className={${ref(st.cls(swapNode.base, diff).key)}}` : "";
        })() : "";
        params.push(d ? `${p.prop} = <${d.name}${cls} />` : p.prop);
      } else if (p.type === "slot") {
        needsNode = true;
        types.push(`  ${p.prop}?: ReactNode;`);
        params.push(p.prop);
      }
    }
    types.push("  className?: string;");
    params.push("className");
    const body = bodyLines.join("\n");
    const deps = imports(body + params.join(","), rec.name);
    const head = [];
    if (ts && needsNode) head.push(`import type { ReactNode } from "react";`);
    for (const d of deps) head.push(importLine(d, "./"));
    if (!tw) head.push(`import styles from "./${rec.name}.module.css";`);
    head.push(`import { cx } from "../cx";`);
    const sig = ts ? `{ ${params.join(", ")} }: ${rec.name}Props` : `{ ${params.join(", ")} }`;
    const text = [
      "// Generated by OpenFini Proto from the design's component. Edit the design and export again, or take it over.",
      ...head,
      "",
      ...(ts ? [`export interface ${rec.name}Props {`, ...types, "}", ""] : []),
      ...top,
      ...(top.length ? [""] : []),
      `export function ${rec.name}(${sig}) {`,
      ...body.split("\n").map((l) => `  ${l}`),
      "}",
      "",
    ].join("\n");
    files.push({ path: `src/components/${rec.name}.${ext}`, text });
    if (!tw) files.push({ path: `src/components/${rec.name}.module.css`, text: `${st.rules.filter(Boolean).join("\n\n")}\n` });
  }

  // ---------------------------------------------------------------------------------------------- screens
  for (const s of ir.screens) {
    const st = sheet();
    const extra = tw ? mediaClasses(s) : new Map();
    const { classOf, runOf, cssOf } = plainStyling([s.root], st, extra);
    const o = { bindings: false, className: (n) => classOf.get(n) || null, runClass: (n, i) => runOf.get(`${n.key}#${i}`) || null, usageClass: (n) => classOf.get(n) || null };
    const body = jsx(s.root, o, 2, true);
    if (!tw) {
      // responsive differences
      for (const m of s.media) {
        const inner = [];
        for (const [a, b] of m.pairs) {
          const d = declDiff(a.decls, b.decls);
          const c = cssOf.get(a);
          if (d.length && c) inner.push(cssRule(`.${c}`, d, "  "));
        }
        if (inner.length) st.rules.push(`@media ${m.query} {\n${inner.join("\n")}\n}`);
      }
    }
    const deps = imports(body.join("\n"), s.name);
    const text = [
      "// Generated by OpenFini Proto from the design. Edit the design and export again, or take it over.",
      ...deps.map((d) => importLine(d, "../components/")),
      ...(tw ? [] : [`import styles from "./${s.name}.module.css";`]),
      "",
      `export function ${s.name}() {`,
      "  return (",
      ...body,
      "  );",
      "}",
      "",
    ].join("\n");
    files.push({ path: `src/screens/${s.name}.${ext}`, text });
    if (!tw) files.push({ path: `src/screens/${s.name}.module.css`, text: `${st.rules.filter(Boolean).join("\n\n")}\n` });
  }
  // ---------------------------------------------------------------------------------------------- shared files
  const fonts = ir.fonts.length ? `/* Fonts: ${ir.fonts.join(", ")} (load them in your app; the design does not embed fonts). */\n` : "";
  if (tw) files.push({ path: "src/styles.css", text: tailwindCss(ir, model) });
  else files.push({ path: "src/tokens.css", text: `${fonts}/* Generated by OpenFini Proto: the design's variables and a small reset. */\n${[varsCss(ir), RESET_CSS].filter(Boolean).join("\n\n")}\n` });
  files.push({
    path: `src/cx.${ts ? "ts" : "js"}`,
    text: `/** Joins class names, skipping empty ones. */\nexport function cx(${ts ? "...names: (string | false | null | undefined)[]" : "...names"}) {\n  return names.filter(Boolean).join(" ");\n}\n`,
  });
  const index = [
    `import "./${tw ? "styles" : "tokens"}.css";`,
    ...ir.components.filter((c) => !c.code?.react?.path).map((c) => `export { ${c.name} } from "./components/${c.name}";`),
    ...ir.screens.map((s) => `export { ${s.name} } from "./screens/${s.name}";`),
    "",
  ].join("\n");
  files.push({ path: `src/index.${ts ? "ts" : "js"}`, text: index });
  files.push(...assetFiles(ir, "public/assets/"));
  return { files, entry: ir.screens.length ? `src/screens/${ir.screens[0].name}.${ext}` : ir.components.length ? `src/components/${ir.components[0].name}.${ext}` : `src/index.${ts ? "ts" : "js"}` };
}

function findBound(n, kind, prop) {
  if (!n) return null;
  if (n.bind?.[kind] === prop) return n;
  for (const c of n.children) {
    const f = findBound(c, kind, prop);
    if (f) return f;
  }
  return null;
}
