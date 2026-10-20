// Accessibility Checker: pure audit logic for design documents (layer trees) and website projects (HTML/CSS text),
// plus the API-driven runner. No imports except shared color math; `export` is stripped when packed.
import { parseColor, toHex, contrastRatio, suggestFix } from "../../_shared/color.js";

export const STRINGS = {
  title: "Accessibility Checker",
  clean: "No issues found.",
  summary: "{errors} errors, {warnings} warnings, {info} notes",
  fixed: "Fixed.",
  cannotFix: "This issue has no safe automatic fix.",
  noDoc: "Open a document first.",
  report: "Report saved.",
};

const SEV = { error: 0, warning: 1, info: 2 };
export const sortIssues = (list) => list.slice().sort((a, b) => SEV[a.severity] - SEV[b.severity] || String(a.where).localeCompare(String(b.where)));
export const summarize = (issues) => ({ errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, info: issues.filter((i) => i.severity === "info").length });

let counter = 0;
const issue = (o) => ({ id: `i${++counter}`, ...o });

// ===================================================================== design documents

/** Flattens a list_layers tree (front to back) into [{layer, order, depth}]. */
export function flattenLayers(layers, depth = 0, out = []) {
  for (const l of layers || []) {
    out.push({ layer: l, order: out.length, depth });
    if (l.children) flattenLayers(l.children, depth + 1, out);
  }
  return out;
}

const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && (weight || 400) >= 700);

/** Alpha-blends fg over bg. Both [r,g,b]. */
export function mix(fg, bg, alpha) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

const alphaOf = (paint) => {
  const m = /@([\d.]+)$/.exec(paint || "");
  return m ? Number(m[1]) : 1;
};
const centerOf = (l) => [(l.x ?? 0) + (l.w ?? 0) / 2, (l.y ?? 0) + (l.h ?? 0) / 2];
const contains = (a, [px, py]) => px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;

/** The color behind a text layer: the first layer below it with an opaque solid fill that covers its center, else the page. */
export function backgroundBehind(flat, textEntry, pageBg) {
  const c = centerOf(textEntry.layer);
  for (const e of flat) {
    const l = e.layer;
    if (e.order <= textEntry.order || l.visible === false || l.type === "text" || l.type === "group" || l.w == null) continue;
    if (!contains(l, c)) continue;
    if (l.type === "image" || l.type === "pixel") return { kind: "image", layer: l };
    if (typeof l.fill !== "string") continue;
    if (/gradient/.test(l.fill)) return { kind: "gradient", layer: l };
    if (alphaOf(l.fill) < 0.95) continue;
    const rgb = parseColor(l.fill);
    if (rgb) return { kind: "solid", rgb, layer: l };
  }
  const rgb = parseColor(pageBg || "") || [255, 255, 255];
  return { kind: "page", rgb, assumed: !pageBg };
}

/**
 * Audits a design page.
 * @param {{layers: object[], pageBg?: string|null, minFont?: number}} input  layers = list_layers().layers
 */
export function auditDesign({ layers, pageBg = null, minFont = 12 }) {
  const flat = flattenLayers(layers);
  const out = [];
  for (const e of flat) {
    const l = e.layer;
    if (l.visible === false) continue;
    const name = l.name || l.type;
    const where = `Layer “${name}”`;
    if (l.type === "text") {
      if (l.fontSize && l.fontSize < minFont) {
        out.push(issue({ rule: "min-font-size", severity: l.fontSize < 9 ? "error" : "warning", message: `Text is ${l.fontSize}px; keep body text at ${minFont}px or larger.`, where, layerId: l.id, fix: { label: `Set to ${minFont}px`, kind: "style", args: { ids: [l.id], fontSize: minFont } } }));
      }
      const fgRaw = typeof l.fill === "string" ? l.fill : null;
      if (!fgRaw || /gradient/.test(fgRaw)) {
        out.push(issue({ rule: "contrast-unknown", severity: "info", message: "Text with a gradient fill: check its contrast by eye.", where, layerId: l.id }));
      } else {
        const bg = backgroundBehind(flat, e, pageBg);
        if (bg.kind === "image" || bg.kind === "gradient") out.push(issue({ rule: "contrast-unknown", severity: "info", message: `Text sits on ${bg.kind === "image" ? "an image" : "a gradient"} (“${bg.layer.name || bg.layer.type}”): contrast cannot be measured automatically.`, where, layerId: l.id }));
        else {
          let fg = parseColor(fgRaw);
          if (fg) {
            const op = Math.min(alphaOf(fgRaw), l.opacity ?? 1);
            if (op < 1) fg = mix(fg, bg.rgb, op);
            const ratio = contrastRatio(fg, bg.rgb);
            const need = isLarge(l.fontSize || 16, l.fontWeight) ? 3 : 4.5;
            if (ratio < need) {
              const fix = op >= 1 ? suggestFix(fgRaw, toHex(bg.rgb), need)[0] : null;
              out.push(issue({ rule: "contrast", severity: ratio < 3 ? "error" : "warning", message: `Contrast ${ratio.toFixed(2)}:1 against ${toHex(bg.rgb)}${bg.assumed ? " (page color not set, white assumed)" : ""}; ${need}:1 is required${need === 3 ? " for large text" : ""}.`, where, layerId: l.id, fix: fix ? { label: `Use ${fix.color} (${fix.ratio}:1)`, kind: "style", args: { ids: [l.id], fill: fix.color } } : undefined }));
            }
          }
        }
      }
      if (!String(l.text || "").trim()) out.push(issue({ rule: "empty-text", severity: "info", message: "Empty text layer: screen readers and exports will skip it.", where, layerId: l.id }));
    }
    if ((l.type === "image" || l.type === "pixel") && !String(l.alt || "").trim()) {
      const placeholder = `Image: ${name}`;
      out.push(issue({ rule: "alt-text", severity: "warning", message: "Image has no alt text.", where, layerId: l.id, fix: { label: "Add a placeholder to edit", kind: "style", args: { ids: [l.id], alt: placeholder } } }));
    } else if (/^Image: /.test(l.alt || "")) {
      out.push(issue({ rule: "alt-placeholder", severity: "info", message: "The alt text is still the placeholder; describe what the image shows.", where, layerId: l.id }));
    }
    if ((l.type === "chart" || l.type === "table") && !String(l.alt || "").trim() && l.type === "chart") {
      out.push(issue({ rule: "alt-text", severity: "info", message: "Chart without alt text; a description is generated on export, but a short summary helps.", where, layerId: l.id }));
    }
  }
  out.push(...readingOrderIssues(flat));
  return sortIssues(out);
}

/** Text layers whose stacking order (back to front = reading order in exports) differs from the visual top-to-bottom, left-to-right order. */
export function readingOrderIssues(flat) {
  const texts = flat.filter((e) => e.layer.type === "text" && e.layer.visible !== false && String(e.layer.text || "").trim());
  if (texts.length < 2) return [];
  const stack = texts.slice().reverse(); // back to front
  const visual = texts.slice().sort((a, b) => {
    const ha = Math.max(a.layer.h || 0, 1);
    const dy = (a.layer.y ?? 0) - (b.layer.y ?? 0);
    return Math.abs(dy) > ha * 0.5 ? dy : (a.layer.x ?? 0) - (b.layer.x ?? 0);
  });
  const out = [];
  for (let i = 0; i < stack.length && out.length < 5; i++) {
    if (stack[i] !== visual[i]) {
      const cur = stack[i].layer;
      const should = visual[i].layer;
      out.push(issue({ rule: "reading-order", severity: "info", message: `Reading order: “${trunc(cur.text)}” comes before “${trunc(should.text)}” in the layer stack but appears after it on the page.`, where: `Layer “${cur.name || cur.type}”`, layerId: cur.id }));
      break;
    }
  }
  return out;
}

const trunc = (s, n = 28) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// ===================================================================== HTML / CSS

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * Scans HTML into elements: { tag, attrs, raw, start, line, nth, close?, inner? } (nth = index among elements of the
 * same tag inside <body>, outside <svg>; matches get_page_outline order). Also returns <style> blocks.
 */
export function scanHtml(src) {
  const elements = [];
  const styles = [];
  const re = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const stack = [];
  const counts = {};
  let inBody = false;
  let svg = 0;
  for (let m; (m = re.exec(src)); ) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      if (m[1].toLowerCase() === "style") styles.push({ css: m[3], line: lineOf(m.index + m[0].indexOf(">") + 1) });
      const el = { tag: m[1].toLowerCase(), attrs: parseAttrs(m[2]), raw: `<${m[1]}${m[2]}>`, start: m.index, line: lineOf(m.index), inBody, nth: -1, script: true };
      elements.push(el);
      continue;
    }
    const closing = m[4] === "/";
    const tag = m[5].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const el = stack[i];
          el.inner = src.slice(el.end, m.index);
          stack.length = i;
          break;
        }
      }
      if (tag === "svg") svg = Math.max(0, svg - 1);
      continue;
    }
    const attrs = parseAttrs(m[6]);
    if (tag === "body") inBody = true;
    const el = { tag, attrs, raw: m[0], start: m.index, end: m.index + m[0].length, line: lineOf(m.index), inBody, nth: -1, svg: svg > 0, parent: stack[stack.length - 1]?.tag };
    if (inBody && !svg) el.nth = counts[tag] = (counts[tag] ?? -1) + 1;
    elements.push(el);
    if (tag === "svg") svg++;
    if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) stack.push(el);
  }
  // occurrence = how many identical raw tags came before (for exact replacement later)
  const seen = {};
  for (const el of elements) el.occurrence = seen[el.raw] = (seen[el.raw] ?? -1) + 1;
  return { elements, styles };
}

export function parseAttrs(s) {
  const attrs = {};
  for (const m of String(s).matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

const textOf = (html) => String(html || "").replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const GENERIC_LINK = /^(click here|here|read more|more|learn more|link|this|details|continue|go)$/i;

/**
 * Audits one HTML file. Issues carry { file, line, tag, nth } and, where safe, a `replace` fix on the exact tag text.
 */
export function auditHtml(file, src) {
  const { elements, styles } = scanHtml(src);
  const out = [];
  const html = elements.find((e) => e.tag === "html");
  const at = (el) => `${file}:${el.line}`;
  const base = (el) => ({ file, line: el.line, tag: el.tag, nth: el.nth, where: at(el) });
  const addAttr = (el, name, value) => ({ kind: "replace", file, find: el.raw, occurrence: el.occurrence, replace: el.raw.replace(/\s*\/?>$/, (e) => ` ${name}="${value}"${e}`) });
  const isDoc = !!html || elements.some((e) => e.tag === "head");
  if (isDoc) {
    if (html && !html.attrs.lang) out.push(issue({ rule: "html-lang", severity: "error", message: "The <html> element has no lang attribute.", ...base(html), fix: { label: 'Add lang="en"', ...addAttr(html, "lang", "en") } }));
    if (!elements.some((e) => e.tag === "title" && textOf(e.inner))) out.push(issue({ rule: "doc-title", severity: "warning", message: "The page has no <title>.", file, line: 1, where: `${file}:1` }));
    if (!elements.some((e) => e.tag === "main" || e.attrs.role === "main")) out.push(issue({ rule: "landmark-main", severity: "warning", message: "No <main> landmark: assistive technology cannot jump to the main content.", file, line: 1, where: `${file}:1` }));
    const vp = elements.find((e) => e.tag === "meta" && e.attrs.name === "viewport");
    if (vp && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(vp.attrs.content || "")) out.push(issue({ rule: "viewport-zoom", severity: "error", message: "The viewport meta tag disables zooming.", ...base(vp) }));
  }
  const labelFor = new Set(elements.filter((e) => e.tag === "label" && e.attrs.for).map((e) => e.attrs.for));
  const ids = {};
  let lastHeading = 0;
  let h1s = 0;
  for (const el of elements) {
    if (el.script || el.svg) continue;
    const a = el.attrs;
    if (a.id) (ids[a.id] ||= []).push(el);
    if (el.tag === "img" && !("alt" in a)) out.push(issue({ rule: "img-alt", severity: "error", message: "Image has no alt attribute.", ...base(el), fix: { label: "Add alt placeholder", ...addAttr(el, "alt", "TODO describe this image") } }));
    else if (el.tag === "img" && /^TODO/i.test(a.alt || "")) out.push(issue({ rule: "alt-placeholder", severity: "warning", message: "The alt text is still a placeholder.", ...base(el) }));
    if (el.tag === "input" && !["hidden", "submit", "button", "reset", "image"].includes((a.type || "text").toLowerCase())) {
      const wrapped = elements.some((l) => l.tag === "label" && l.start < el.start && l.end <= el.start && l.inner != null && el.start < l.end + (l.inner?.length ?? 0) + 8);
      if (!a["aria-label"] && !a["aria-labelledby"] && !a.title && !(a.id && labelFor.has(a.id)) && !wrapped) {
        const hint = a.placeholder || a.name;
        out.push(issue({ rule: "form-label", severity: "error", message: "Form field has no label.", ...base(el), fix: hint ? { label: `Add aria-label="${hint}"`, ...addAttr(el, "aria-label", hint) } : undefined }));
      }
    }
    if ((el.tag === "select" || el.tag === "textarea") && !a["aria-label"] && !a["aria-labelledby"] && !(a.id && labelFor.has(a.id))) out.push(issue({ rule: "form-label", severity: "error", message: `${el.tag} has no label.`, ...base(el) }));
    if (el.tag === "button" && !textOf(el.inner) && !a["aria-label"] && !a["aria-labelledby"] && !a.title) out.push(issue({ rule: "button-name", severity: "error", message: "Button has no accessible name.", ...base(el) }));
    if (el.tag === "a" && a.href !== undefined) {
      const text = textOf(el.inner);
      if (!text && !a["aria-label"] && !a["aria-labelledby"] && !a.title) out.push(issue({ rule: "link-name", severity: "error", message: "Link has no text.", ...base(el) }));
      else if (GENERIC_LINK.test(text) && !a["aria-label"]) out.push(issue({ rule: "link-text", severity: "warning", message: `Link text “${text}” does not say where the link goes.`, ...base(el) }));
    }
    if (/^h[1-6]$/.test(el.tag)) {
      const level = Number(el.tag[1]);
      if (level === 1) h1s++;
      if (level > lastHeading + 1) out.push(issue({ rule: "heading-order", severity: "warning", message: lastHeading ? `Heading level jumps from h${lastHeading} to h${level}.` : `The first heading is h${level}; start with h1.`, ...base(el) }));
      lastHeading = level;
      if (!textOf(el.inner)) out.push(issue({ rule: "heading-empty", severity: "warning", message: "Empty heading.", ...base(el) }));
    }
    if ("tabindex" in a && Number(a.tabindex) > 0) out.push(issue({ rule: "tabindex", severity: "warning", message: `tabindex="${a.tabindex}" changes the natural focus order; use 0 or -1.`, ...base(el), fix: { label: "Remove tabindex", kind: "replace", file, find: el.raw, occurrence: el.occurrence, replace: el.raw.replace(/\s+tabindex\s*=\s*("[^"]*"|'[^']*'|\S+)/i, "") } }));
    if (el.tag === "iframe" && !a.title) out.push(issue({ rule: "iframe-title", severity: "warning", message: "iframe has no title.", ...base(el) }));
    if (el.tag === "video" && !elements.some((t) => t.tag === "track" && t.start > el.start && t.start < (el.end ?? el.start) + (el.inner?.length ?? 0) + 1)) out.push(issue({ rule: "video-captions", severity: "info", message: "Video without a <track> for captions.", ...base(el) }));
    if (a.onclick !== undefined && !["a", "button", "input", "select", "textarea", "summary"].includes(el.tag) && !a.role && a.tabindex === undefined) out.push(issue({ rule: "click-keyboard", severity: "warning", message: `<${el.tag}> has a click handler but is not keyboard accessible (use a button or add role and tabindex).`, ...base(el) }));
  }
  if (h1s > 1) out.push(issue({ rule: "multiple-h1", severity: "info", message: `The page has ${h1s} h1 headings.`, file, line: 1, where: `${file}:1` }));
  for (const [id, list] of Object.entries(ids)) if (list.length > 1) out.push(issue({ rule: "duplicate-id", severity: "error", message: `The id “${id}” is used ${list.length} times.`, ...base(list[1]) }));
  for (const s of styles) out.push(...auditCss(file, s.css, s.line));
  return out;
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:black|white|red|green|blue|yellow|orange|purple|gray|grey)\b/;

/** Audits CSS text: color pairs inside one rule, removed focus outlines. */
export function auditCss(file, css, lineOffset = 1) {
  const out = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel.startsWith("@")) continue;
    const body = m[2];
    const line = lineOffset + (stripped.slice(0, m.index + (m[1].length - m[1].trimStart().length)).match(/\n/g)?.length ?? 0);
    const decl = (re) => re.exec(body)?.[1]?.trim();
    const fg = decl(/(?:^|[;\s])color\s*:\s*([^;]+)/i);
    const bgRaw = decl(/(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/i);
    const bgColor = bgRaw && !/gradient|url\(|var\(/.test(bgRaw) ? COLOR_TOKEN.exec(bgRaw)?.[0] : null;
    const fgColor = fg && !/var\(/.test(fg) ? COLOR_TOKEN.exec(fg)?.[0] : null;
    if (fgColor && bgColor) {
      const ratio = contrastRatio(fgColor, bgColor);
      const size = Number(/font-size\s*:\s*([\d.]+)px/i.exec(body)?.[1] || 0);
      const need = size >= 24 ? 3 : 4.5;
      if (ratio != null && ratio < need) out.push(issue({ rule: "css-contrast", severity: ratio < 3 ? "error" : "warning", message: `“${sel}”: ${fgColor} on ${bgColor} has contrast ${ratio.toFixed(2)}:1 (${need}:1 needed).`, file, line, where: `${file}:${line}` }));
    }
    if (/:focus/.test(sel) && /outline\s*:\s*(none|0)\b/i.test(body) && !/box-shadow|border/.test(body)) out.push(issue({ rule: "focus-outline", severity: "warning", message: `“${sel}” removes the focus outline without a replacement.`, file, line, where: `${file}:${line}` }));
  }
  return out;
}

// ===================================================================== report

/** Markdown report of an audit. */
export function toMarkdown({ title = "Accessibility report", target = "", issues, date = "" }) {
  const s = summarize(issues);
  const lines = [`# ${title}`, ""];
  if (target) lines.push(`**Checked:** ${target}  `);
  if (date) lines.push(`**Date:** ${date}  `);
  lines.push(`**Result:** ${s.errors} errors, ${s.warnings} warnings, ${s.info} notes`, "");
  if (!issues.length) lines.push("No issues found by the automatic checks. Manual review is still needed (screen reader walkthrough, keyboard use, meaning of alt texts).", "");
  for (const sev of ["error", "warning", "info"]) {
    const list = issues.filter((i) => i.severity === sev);
    if (!list.length) continue;
    lines.push(`## ${{ error: "Errors", warning: "Warnings", info: "Notes" }[sev]} (${list.length})`, "");
    for (const i of list) lines.push(`- **${i.rule}** at ${i.where}: ${i.message}${i.fix ? ` _Fix: ${i.fix.label}._` : ""}`);
    lines.push("");
  }
  lines.push("---", "Generated by the OpenFini Accessibility Checker. Automatic checks cover a subset of WCAG 2.2; they cannot judge meaning, cognitive load or real assistive technology behavior.");
  return `${lines.join("\n")}\n`;
}

// ===================================================================== API-driven operations

/** Runs the audit that fits the current studio. Resolves { kind, issues, target }. */
export async function runAudit(api) {
  counter = 0;
  const studio = await api.studio.current();
  if (studio === "code") return auditProject(api);
  const info = await api.document.info();
  const doc = info.activeDocument;
  if (!doc) throw new Error(STRINGS.noDoc);
  const page = doc.pages.find((p) => p.active) || doc.pages[0];
  const { layers } = await api.document.readLayers({ depth: 8 });
  return { kind: "design", target: `${doc.name}, page “${page.name}”`, issues: auditDesign({ layers, pageBg: page.background }) };
}

export async function auditProject(api) {
  const list = await api.document.callTool("list_files", {});
  const issues = [];
  for (const f of list.files) {
    const ext = f.path.split(".").pop().toLowerCase();
    if (!["html", "htm", "css"].includes(ext)) continue;
    const text = await readFile(api, f.path);
    issues.push(...(ext === "css" ? auditCss(f.path, text) : auditHtml(f.path, text)));
  }
  try {
    const res = await api.document.callTool("check_problems", {});
    for (const p of res.problems || []) {
      const m = /^(\w+) ([^:]+): (.*)$/.exec(p);
      if (m) issues.push(issue({ rule: "project-check", severity: m[1] === "error" ? "warning" : "info", message: m[3], file: m[2], where: m[2] }));
    }
  } catch { /* the problem engine is optional */ }
  return { kind: "code", target: `website project (${list.files.length} files)`, issues: sortIssues(issues) };
}

async function readFile(api, path) {
  const out = await api.document.callTool("read_file", { path });
  return String(out).split("\n").slice(1).map((l) => l.replace(/^\d+\t/, "")).join("\n");
}

/** Applies the fix of an issue. Throws when there is none. */
export async function applyFix(api, i) {
  if (!i.fix) throw new Error(STRINGS.cannotFix);
  if (i.fix.kind === "style") return api.document.callTool("set_style", i.fix.args);
  if (i.fix.kind === "replace") {
    const text = await readFile(api, i.fix.file);
    let from = -1;
    for (let n = 0; n <= i.fix.occurrence; n++) {
      from = text.indexOf(i.fix.find, from + 1);
      if (from < 0) throw new Error("The code changed since the audit; run it again.");
    }
    return api.document.callTool("write_file", { path: i.fix.file, content: text.slice(0, from) + i.fix.replace + text.slice(from + i.fix.find.length) });
  }
  throw new Error(STRINGS.cannotFix);
}

/** Selects the layer or element of an issue. Returns false when it could not be located. */
export async function selectIssue(api, i) {
  if (i.layerId) {
    await api.document.callTool("select_layers", { ids: [i.layerId] });
    return true;
  }
  if (i.tag && i.nth >= 0 && /\.html?$/.test(i.file || "")) {
    const outline = String(await api.document.callTool("get_page_outline", { page: i.file, maxDepth: 40 }));
    const hits = [...outline.matchAll(/^\s*\[(\d+)\] ([\w-]+)/gm)].filter((m) => m[2] === i.tag);
    const hit = hits[i.nth];
    if (hit) {
      await api.document.callTool("select_element", { id: Number(hit[1]) });
      return true;
    }
  }
  return false;
}
