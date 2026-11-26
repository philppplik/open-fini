// HTML + CSS emitter of the Proto code export (docs/concepts/proto-studio.md §10.1, task T7). Pure: no DOM.
//
//   emitHtml(ir, opts?) → { files: [{ path, text } | { path, bytes, mime }], entry }
// One HTML file per screen (index.html for a single screen; several screens get their own files and an index.html
// that links them), one styles.css with the variables (custom properties and data-mode rules), a small reset, one
// rule per class and the @media differences of responsive screens, and the images in assets/.
// Components have no HTML equivalent: instances are written out as their layers (the IR's expanded children).
// Helpers shared with the Tailwind emitter: htmlMarkup, svgMarkup, RESET_CSS, varsCss.
import { classNamer, cssRule, declDiff, escHtml } from "./util.js";

/** Element defaults the design never has (margins, button chrome); box sizing comes from every rule. */
export const RESET_CSS = `*,
*::before,
*::after {
  box-sizing: border-box;
}
body,
h1, h2, h3, h4, h5, h6,
p, figure, blockquote, dl, dd, ul, ol {
  margin: 0;
}
ul, ol {
  padding: 0;
  list-style: none;
}
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  text-align: inherit;
  cursor: pointer;
}
a {
  color: inherit;
  text-decoration: none;
}
img,
svg {
  display: block;
}`;

/** The variable rules of the IR as CSS text. */
export const varsCss = (ir) => ir.vars.map((r) => cssRule(r.selector, r.decls)).filter(Boolean).join("\n");

const VOID = new Set(["img", "input", "br", "hr"]);

/** Inline SVG markup of a vector or line layer (JSX-compatible attribute names when `jsx`). */
export function svgMarkup(node, cls, { jsx = false, attrs = "" } = {}) {
  const s = node.svg;
  const a = (k) => (jsx ? k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : k);
  const clsAttr = cls ? ` ${jsx ? "className" : "class"}=${jsx && (cls.startsWith("{") || cls.startsWith('"')) ? cls : `"${escHtml(cls)}"`}` : "";
  const stroke = ` stroke="${escHtml(s.stroke)}" ${a("stroke-width")}="${escHtml(s.strokeWidth)}"${s.dash ? ` ${a("stroke-dasharray")}="${escHtml(s.dash)}"` : ""}`;
  const shape =
    s.kind === "line"
      ? `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"${stroke} />`
      : `<path d="${escHtml(s.d)}" fill="${escHtml(s.fill)}" ${a("fill-rule")}="${s.rule}"${stroke} />`;
  return `<svg${clsAttr}${attrs} xmlns="http://www.w3.org/2000/svg"${s.w ? ` width="${s.w}"` : ""}${s.h ? ` height="${s.h}"` : ""} aria-hidden="true">${shape}</svg>`;
}

/** A standalone SVG file of a vector or line layer (SwiftUI assets). */
export function svgFile(node) {
  const s = node.svg;
  const w = s.w || 24;
  const h = s.h || 24;
  const stroke = ` stroke="${escHtml(s.stroke)}" stroke-width="${escHtml(s.strokeWidth)}"${s.dash ? ` stroke-dasharray="${escHtml(s.dash)}"` : ""}`;
  const shape = s.kind === "line" ? `<line x1="0" y1="0" x2="${w}" y2="${h}"${stroke}/>` : `<path d="${escHtml(s.d)}" fill="${escHtml(s.fill.startsWith("var(") ? (/,\s*([^)]+)\)/.exec(s.fill)?.[1] || "#000000") : s.fill)}" fill-rule="${s.rule}"${stroke}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shape}</svg>\n`;
}

/**
 * HTML markup of an IR tree.
 * @param {object} root
 * @param {{ classOf: (n) => string, runClass: (n, i) => string|null, href: (n) => string|null }} o
 */
export function htmlMarkup(root, o, depth = 0) {
  const lines = [];
  const attrText = (n) => {
    const out = [];
    const cls = o.classOf(n);
    if (cls) out.push(`class="${escHtml(cls)}"`);
    if (n.el === "img") {
      out.push(`src="${escHtml(n.image.asset.url)}"`);
      out.push(`alt="${escHtml(n.image.alt)}"`);
    }
    const href = n.el === "a" ? o.href(n) : null;
    if (n.el === "a") out.push(`href="${escHtml(href || "#")}"`);
    for (const k of Object.keys(n.attrs).sort()) out.push(`${k}="${escHtml(n.attrs[k])}"`);
    return out.length ? ` ${out.join(" ")}` : "";
  };
  const visit = (n, d) => {
    const pad = "  ".repeat(d);
    if (n.svg) {
      const extra = Object.keys(n.attrs)
        .sort()
        .map((k) => ` ${k}="${escHtml(n.attrs[k])}"`)
        .join("");
      lines.push(pad + svgMarkup(n, o.classOf(n), { attrs: extra }));
      return;
    }
    const open = `<${n.el}${attrText(n)}>`;
    if (VOID.has(n.el)) return lines.push(pad + open);
    if (n.text) {
      const inner = n.text.runs.map((run, i) => {
        const c = o.runClass(n, i);
        return c ? `<span class="${escHtml(c)}">${escHtml(run.text)}</span>` : escHtml(run.text);
      });
      const text = inner.join("");
      if (!text.includes("\n") && text.length + open.length + pad.length < 110) lines.push(`${pad}${open}${text}</${n.el}>`);
      else lines.push(`${pad}${open}${text}</${n.el}>`);
      return;
    }
    if (!n.children.length) return lines.push(`${pad}${open}</${n.el}>`);
    lines.push(pad + open);
    for (const c of n.children) visit(c, d + 1);
    lines.push(`${pad}</${n.el}>`);
  };
  visit(root, depth);
  return lines.join("\n");
}

/** An HTML page around body markup. */
export function page(title, body, { head = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
${head}</head>
<body>
${body}
</body>
</html>
`;
}

/** Screen files: index.html for one screen; one file per screen plus an index for several. */
export function screenFiles(ir) {
  const one = ir.screens.length === 1;
  const map = new Map(ir.screens.map((s) => [s.id, one ? "index.html" : `${s.file}.html`]));
  return map;
}

/** Link targets of navigate interactions: the file of the target screen, else "#". */
export const hrefOf = (files) => (n) => {
  if (typeof n.href === "string") return n.href;
  if (n.href?.screen) return files.get(n.href.screen) || "#";
  return null;
};

export function assetFiles(ir, dir = "assets/") {
  return ir.assets.filter((a) => a.bytes).map((a) => ({ path: `${dir}${a.file}`, bytes: a.bytes, mime: a.mime }));
}

export function emitHtml(ir, { title = "Design" } = {}) {
  const namer = classNamer();
  const classes = new Map();
  const runs = new Map();
  const rules = [];
  const assign = (n) => {
    const { cls, fresh } = namer(n.base, n.decls);
    classes.set(n, cls);
    if (fresh) rules.push(cssRule(`.${cls}`, n.decls));
    n.text?.runs.forEach((run, i) => {
      if (!run.decls.length) return;
      const r = namer(`${cls}-span`, run.decls);
      runs.set(`${n.key}#${i}`, r.cls);
      if (r.fresh) rules.push(cssRule(`.${r.cls}`, run.decls));
    });
    n.children.forEach(assign);
  };
  const media = [];
  for (const s of ir.screens) {
    assign(s.root);
    for (const m of s.media) {
      const inner = [];
      for (const [a, b] of m.pairs) {
        const d = declDiff(a.decls, b.decls);
        if (d.length) inner.push(cssRule(`.${classes.get(a)}`, d, "  "));
        a.text?.runs.forEach((run, i) => {
          const c = runs.get(`${a.key}#${i}`);
          const d2 = declDiff(run.decls, b.text.runs[i].decls);
          if (c && d2.length) inner.push(cssRule(`.${c}`, d2, "  "));
        });
      }
      if (inner.length) media.push(`@media ${m.query} {\n${inner.join("\n")}\n}`);
    }
  }
  const fonts = ir.fonts.length ? `/* Fonts: ${ir.fonts.join(", ")} (load them in your page; the design does not embed fonts). */\n` : "";
  const css = [`${fonts}/* Generated by OpenFini Proto. Variables first, then one rule per layer. */`, varsCss(ir), RESET_CSS, ...rules, ...media].filter(Boolean).join("\n\n") + "\n";
  const files = screenFiles(ir);
  const href = hrefOf(files);
  const out = [];
  const o = { classOf: (n) => classes.get(n), runClass: (n, i) => runs.get(`${n.key}#${i}`) || null, href };
  for (const s of ir.screens) {
    out.push({ path: files.get(s.id), text: page(s.name, htmlMarkup(s.root, o, 1), { head: `  <link rel="stylesheet" href="styles.css">\n` }) });
  }
  if (ir.screens.length > 1) {
    const list = ir.screens.map((s) => `    <li><a href="${escHtml(files.get(s.id))}">${escHtml(s.name)}</a></li>`).join("\n");
    out.push({ path: "index.html", text: page(title, `  <ul>\n${list}\n  </ul>`) });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  out.push({ path: "styles.css", text: css });
  out.push(...assetFiles(ir));
  return { files: out, entry: ir.screens.length ? "index.html" : "styles.css" };
}
