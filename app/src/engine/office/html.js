// HTML import (sanitized) and export (clean semantic HTML with embedded CSS and data-URI images) for the office
// document model. Pure: parses with the Code studio's source parser (engine/web/html.js), never with the DOM.
import { parseHtml, decodeEntities, getAttr as rawAttr, elementText } from "../web/html.js";

const getAttr = (el, name) => {
  const v = rawAttr(el, name);
  return v == null ? null : decodeEntities(v);
};
const MAX_DEPTH = 120;
import { createDocument, normalizeDoc, mergeRuns, tableGrid, resolveStyle, headingLevel, normColor, safeHref, isText, paraText } from "./model.js";
import { parseDataUri, dataUri, addMedia, fitSize } from "./media.js";
import { createReport, plural } from "./report.js";

const escT = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escA = (s) => escT(s).replace(/"/g, "&quot;");
const cssFont = (f) => `"${String(f).replace(/["\\<>]/g, "")}", ${/mono|courier|consol/i.test(f) ? "monospace" : /times|georgia|serif|cambria|garamond/i.test(f) && !/sans/i.test(f) ? "serif" : "sans-serif"}`;
const r2 = (n) => Math.round(n * 100) / 100;

function paraCss(p) {
  const a = [];
  if (!p) return "";
  if (p.align) a.push(`text-align:${p.align}`);
  if (p.spaceBefore !== undefined) a.push(`margin-top:${r2(p.spaceBefore)}pt`);
  if (p.spaceAfter !== undefined) a.push(`margin-bottom:${r2(p.spaceAfter)}pt`);
  if (p.indentLeft !== undefined) a.push(`margin-left:${r2(p.indentLeft)}pt`);
  if (p.indentRight !== undefined) a.push(`margin-right:${r2(p.indentRight)}pt`);
  if (p.indentFirst !== undefined) a.push(`text-indent:${r2(p.indentFirst)}pt`);
  if (p.lineHeight !== undefined) a.push(`line-height:${r2(p.lineHeight)}`);
  if (p.keepWithNext) a.push("break-after:avoid");
  if (p.pageBreakBefore) a.push("break-before:page");
  return a.join(";");
}
function runCss(m) {
  const a = [];
  if (m.color) a.push(`color:${m.color}`);
  if (m.highlight) a.push(`background-color:${m.highlight}`);
  if (m.font) a.push(`font-family:${cssFont(m.font)}`);
  if (m.size) a.push(`font-size:${r2(m.size)}pt`);
  if (m.b !== undefined) a.push(`font-weight:${m.b ? 700 : 400}`);
  if (m.i !== undefined) a.push(`font-style:${m.i ? "italic" : "normal"}`);
  return a.join(";");
}

/**
 * Writes a document as HTML.
 * @param {object} input office document model
 * @param {{ standalone?: boolean, fragment?: boolean, title?: string }} [o] `fragment` returns only the body content
 *   (for the clipboard)
 * @returns {string}
 */
export function writeHtml(input, o = {}) {
  const doc = normalizeDoc(input);
  const fnOrder = new Map();
  const inline = (runs, noNotes = false) => {
    let x = "";
    for (const r of runs) {
      if (isText(r)) {
        let t = escT(r.text).replace(/\t/g, '<span class="tab">\t</span>');
        const css = runCss({ color: r.color, highlight: r.highlight, font: r.font, size: r.size });
        if (css) t = `<span style="${escA(css)}">${t}</span>`;
        if (r.va) t = `<${r.va === "sub" ? "sub" : "sup"}>${t}</${r.va === "sub" ? "sub" : "sup"}>`;
        if (r.s) t = `<s>${t}</s>`;
        if (r.u && !r.link) t = `<u>${t}</u>`;
        if (r.i) t = `<em>${t}</em>`;
        if (r.b) t = `<strong>${t}</strong>`;
        if (r.link) t = `<a href="${escA(r.link)}"${r.u ? "" : ' class="nu"'}>${t}</a>`;
        x += t;
      } else if (r.type === "break") x += "<br>";
      else if (r.type === "image") {
        const m = doc.media[r.media];
        if (m?.bytes) x += `<img src="${dataUri(m.mime, m.bytes)}" alt="${escA(r.alt || "")}" width="${Math.round(r.width / 0.75)}" height="${Math.round(r.height / 0.75)}" style="width:${r2(r.width)}pt;height:${r2(r.height)}pt">`;
      } else if (r.type === "field") x += `<span class="field" data-field="${r.field}">${r.field === "date" ? new Date().toISOString().slice(0, 10) : "1"}</span>`;
      else if (r.type === "footnote" && !noNotes) {
        if (!fnOrder.has(r.id)) fnOrder.set(r.id, fnOrder.size + 1);
        const n = fnOrder.get(r.id);
        x += `<sup class="fnref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
      }
    }
    return x;
  };
  const cls = (p) => (p.style && p.style !== "Normal" ? ` class="s-${escA(p.style)}"` : "");
  const pTag = (p, tag = null) => {
    const lvl = headingLevel(doc, p);
    const t = tag || (lvl ? `h${Math.min(6, lvl)}` : "p");
    const css = paraCss(p.props);
    const content = inline(p.runs) || (t === "p" ? "<br>" : "");
    return `<${t}${cls(p)}${css ? ` style="${escA(css)}"` : ""}>${content}</${t}>`;
  };
  const listHtml = (items) => {
    let x = "";
    const open = []; // stack of tags
    for (const p of items) {
      const L = Math.min(8, p.list.level || 0);
      const tag = p.list.kind === "number" ? "ol" : "ul";
      while (open.length > L + 1) x += `</li></${open.pop()}>`;
      if (open.length === L + 1) x += open[L] !== tag ? `</li></${open.pop()}>` : "</li>";
      // the <li> of the parent level stays open while deeper lists are written
      while (open.length < L + 1) {
        const t = open.length === L ? tag : "ul";
        x += `<${t}>`;
        open.push(t);
        if (open.length < L + 1) x += '<li class="nested">';
      }
      const css = paraCss(p.props);
      x += `<li${cls(p)}${css ? ` style="${escA(css)}"` : ""}>${inline(p.runs) || "<br>"}`;
    }
    while (open.length) x += `</li></${open.pop()}>`;
    return x;
  };
  const tableHtml = (t) => {
    const grid = tableGrid(t);
    const total = t.cols.reduce((a, c) => a + c, 0);
    let x = `<table class="${t.borders.style === "none" ? "nb" : "b"}" style="width:${r2(total)}pt${t.borders.style === "none" ? "" : `;--bc:${t.borders.color};--bw:${r2(t.borders.width)}pt`}"><colgroup>${t.cols.map((c) => `<col style="width:${r2(c)}pt">`).join("")}</colgroup>`;
    const head = t.rows.findIndex((r) => !r.header);
    t.rows.forEach((row, r) => {
      if (r === 0 && head > 0) x += "<thead>";
      if (r === Math.max(0, head) && head !== -1) x += "<tbody>";
      if (head === -1 && r === 0) x += "<thead>";
      x += "<tr>";
      for (let c = 0; c < t.cols.length; c++) {
        const g = grid[r][c];
        if (!g || !g.origin) {
          if (!g) x += "<td></td>";
          continue;
        }
        const cell = row.cells[g.ci];
        const tag = row.header ? "th" : "td";
        const st = [cell.shading ? `background:${cell.shading}` : "", cell.vAlign ? `vertical-align:${cell.vAlign}` : ""].filter(Boolean).join(";");
        x += `<${tag}${g.colspan > 1 ? ` colspan="${g.colspan}"` : ""}${g.rowspan > 1 ? ` rowspan="${g.rowspan}"` : ""}${st ? ` style="${st}"` : ""}>${cell.blocks.map((p) => pTag(p)).join("")}</${tag}>`;
      }
      x += "</tr>";
      if (r === head - 1) x += "</thead>";
    });
    x += head === -1 ? "</thead>" : "</tbody>";
    return `${x}</table>`;
  };
  let body = "";
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "paragraph" && b.list) {
      const group = [];
      while (i < blocks.length && blocks[i].type === "paragraph" && blocks[i].list) group.push(blocks[i++]);
      i--;
      body += `${listHtml(group)}\n`;
    } else if (b.type === "paragraph" && b.style === "Code") {
      const group = [];
      while (i < blocks.length && blocks[i].type === "paragraph" && blocks[i].style === "Code" && !blocks[i].list) group.push(blocks[i++]);
      i--;
      body += `<pre class="s-Code"><code>${group.map((p) => inline(p.runs.map((r) => (isText(r) ? { text: r.text, b: r.b, i: r.i, link: r.link } : r)))).join("\n")}</code></pre>\n`;
    } else if (b.type === "paragraph" && b.style === "Quote") {
      const group = [];
      while (i < blocks.length && blocks[i].type === "paragraph" && blocks[i].style === "Quote" && !blocks[i].list) group.push(blocks[i++]);
      i--;
      body += `<blockquote>${group.map((p) => pTag({ ...p, style: "Normal" })).join("")}</blockquote>\n`;
    } else if (b.type === "paragraph") body += `${pTag(b)}\n`;
    else if (b.type === "table") body += `${tableHtml(b)}\n`;
    else if (b.type === "pageBreak") body += '<div class="page-break" style="break-after:page"></div>\n';
    else if (b.type === "rule") body += "<hr>\n";
  }
  if (fnOrder.size) {
    body += '<section class="footnotes" role="doc-endnotes"><hr><ol>';
    for (const [id, n] of fnOrder) body += `<li id="fn-${n}">${(doc.footnotes[id] || []).map((p) => inline(p.runs, true)).join("<br>")} <a href="#fnref-${n}" class="footnote-backref" aria-label="Back to reference ${n}">↩</a></li>`;
    body += "</ol></section>\n";
  }
  if (o.fragment) return body;
  const title = o.title || doc.meta.title || paraText(doc.blocks.find((b) => headingLevel(doc, b)) || { runs: [] }).replace(/\uFFFC/g, "") || "Document";
  const pg = doc.page;
  let css = `@page{size:${r2(pg.width)}pt ${r2(pg.height)}pt;margin:${r2(pg.margins.top)}pt ${r2(pg.margins.right)}pt ${r2(pg.margins.bottom)}pt ${r2(pg.margins.left)}pt}\nbody{max-width:${r2(pg.width - pg.margins.left - pg.margins.right)}pt;margin:2rem auto;padding:0 1rem;color:#000;background:#fff}\np,h1,h2,h3,h4,h5,h6,li{margin:0}\ntable{border-collapse:collapse;margin:6pt 0}td,th{padding:2pt 5pt;vertical-align:top;text-align:left}table.b td,table.b th{border:var(--bw) solid var(--bc)}\nimg{max-width:100%;vertical-align:baseline}a.nu{text-decoration:none}\nblockquote{margin:0}pre{margin:0;white-space:pre-wrap}\n.footnotes{font-size:.85em;margin-top:2em}\n@media print{body{max-width:none;margin:0;padding:0}.page-break{break-after:page}}\n`;
  for (const [id, s] of Object.entries(doc.styles)) {
    const st = resolveStyle(doc, id);
    const decl = [runCss(st.run), paraCss(st.para)].filter(Boolean).join(";");
    const sel = id === "Normal" ? "body" : `.s-${id}`;
    if (decl) css += `${sel}{${decl}}\n`;
    if (st.outline) css += `h${Math.min(6, st.outline)}:not([class]){${decl}}\n`;
    void s;
  }
  css += "h1,h2,h3,h4,h5,h6{font-weight:inherit}\n";
  const meta = doc.meta;
  return `<!doctype html>\n<html lang="${escA(meta.lang || "en-US")}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="OpenFini">\n${meta.author ? `<meta name="author" content="${escA(meta.author)}">\n` : ""}${meta.subject ? `<meta name="description" content="${escA(meta.subject)}">\n` : ""}<title>${escT(title)}</title>\n<style>\n${css}</style>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}

// =============================================================================================== import

const DROP = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "canvas", "video", "audio", "form", "input", "button", "select", "textarea", "head", "title", "meta", "link", "base", "frame", "frameset", "applet", "dialog", "map", "picture>source", "nav"]);
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "blockquote", "pre", "hr", "section", "article", "header", "footer", "main", "aside", "figure", "figcaption", "dl", "dt", "dd", "address", "center", "details", "summary", "body", "html", "tbody", "thead", "tfoot", "tr", "td", "th", "caption"]);

function parseCss(style) {
  const out = {};
  for (const decl of String(style || "").split(";")) {
    const k = decl.indexOf(":");
    if (k > 0) out[decl.slice(0, k).trim().toLowerCase()] = decl.slice(k + 1).trim();
  }
  return out;
}
function cssLengthPt(v, base = 11) {
  const m = /^(-?[\d.]+)\s*(pt|px|em|rem|cm|mm|in|%)?$/i.exec(String(v || "").trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch ((m[2] || "px").toLowerCase()) {
    case "pt":
      return n;
    case "px":
      return n * 0.75;
    case "em":
    case "rem":
      return n * base;
    case "%":
      return (n / 100) * base;
    case "cm":
      return (n * 72) / 2.54;
    case "mm":
      return (n * 72) / 25.4;
    case "in":
      return n * 72;
  }
  return undefined;
}
const FONT_SIZES = { "xx-small": 7, "x-small": 7.5, small: 10, medium: 12, large: 13.5, "x-large": 18, "xx-large": 24 };

function marksFromCss(css, base) {
  const m = { ...base };
  if (css.color) {
    const c = normColor(css.color);
    if (c) m.color = c;
  }
  const bg = css["background-color"] || css.background;
  if (bg) {
    const c = normColor(bg.split(/\s+/)[0]);
    if (c && c !== "#ffffff") m.highlight = c;
  }
  const fw = css["font-weight"];
  if (fw) m.b = /bold|[6-9]00/.test(fw) || undefined;
  if (css["font-style"]) m.i = /italic|oblique/.test(css["font-style"]) || undefined;
  const td = css["text-decoration"] || css["text-decoration-line"];
  if (td) {
    if (/underline/.test(td)) m.u = true;
    if (/line-through/.test(td)) m.s = true;
  }
  if (css["font-family"]) m.font = css["font-family"].split(",")[0].replace(/["']/g, "").trim();
  if (css["font-size"]) {
    const s = FONT_SIZES[css["font-size"]] || cssLengthPt(css["font-size"]);
    if (s) m.size = s;
  }
  const va = css["vertical-align"];
  if (va === "super") m.va = "super";
  if (va === "sub") m.va = "sub";
  return m;
}

/**
 * Reads HTML into a document. Scripts, styles, frames, forms and event handlers are dropped; only http(s)/mailto
 * links and data: images are kept (remote images are not downloaded).
 * @param {string} html
 * @param {{report?: object, name?: string, format?: string}} [o]
 */
export function readHtml(html, o = {}) {
  const report = o.report || createReport(o.format || "HTML", o.name);
  const src = String(html ?? "").slice(0, 50 * 1024 * 1024);
  const parsed = parseHtml(src);
  const model = createDocument();
  const ctx = { report, model, counts: { images: 0, tables: 0, lists: 0, links: 0, remote: 0, dropped: new Set() }, footnoteIds: new Map(), listSeq: 0, srcOf: (c) => src.slice(c.start, c.end), parsed };
  const titleEl = parsed.elements.find((e) => e.tag === "title");
  if (titleEl) model.meta.title = decodeEntities(titleEl.children.map((c) => (c.type === "text" ? c.text : "")).join("")).trim().slice(0, 500);
  // footnotes sections (Markdown renderer, OpenFini export, Pandoc)
  for (const el of parsed.elements) {
    if (el.tag !== "section" && el.tag !== "div" && el.tag !== "aside") continue;
    if (!/(^|\s)footnotes(\s|$)/.test(getAttr(el, "class") || "") && getAttr(el, "role") !== "doc-endnotes") continue;
    el._footnotes = true;
    for (const li of findTag(el, "li")) {
      const id = getAttr(li, "id");
      if (!id) continue;
      const fid = `fn${ctx.footnoteIds.size + 1}`;
      ctx.footnoteIds.set(id, fid);
      const sub = { ...ctx, out: [] };
      const runs = [];
      walkInline(li, sub, {}, runs, { inFootnote: true });
      model.footnotes[fid] = [{ type: "paragraph", style: "Normal", runs: trimRuns(mergeRuns(runs)) }];
    }
  }
  const body = parsed.elements.find((e) => e.tag === "body") || { children: parsed.children };
  const out = [];
  walkBlocks(body, ctx, out, { style: "Normal", list: null });
  model.blocks = out;
  // keep only footnotes that are referenced
  const used = new Set();
  for (const b of out) if (b.type === "paragraph") for (const r of b.runs) if (r.type === "footnote") used.add(r.id);
  for (const id of Object.keys(model.footnotes)) if (!used.has(id)) delete model.footnotes[id];
  const c = ctx.counts;
  report.kept(`${plural(out.filter((b) => b.type === "paragraph").length, "paragraph")} with headings and text formatting.`);
  if (c.lists) report.kept(`${plural(c.lists, "list item")}.`);
  if (c.tables) report.kept(`${plural(c.tables, "table")}.`);
  if (c.images) report.kept(`${plural(c.images, "embedded image")}.`);
  if (c.remote) report.dropped(`${plural(c.remote, "linked image")} (remote images are not downloaded; insert them with Insert ▸ Image).`);
  if (c.dropped.size) report.dropped(`Scripts, styles, forms and embedded content (${[...c.dropped].slice(0, 6).join(", ")}) were removed for safety.`);
  if (used.size) report.kept(`${plural(used.size, "footnote")}.`);
  return { doc: normalizeDoc(model), report };
}

function findTag(el, tag, out = []) {
  for (const c of el.children || []) {
    if (c.type !== "element") continue;
    if (c.tag === tag) out.push(c);
    findTag(c, tag, out);
  }
  return out;
}

function hasBlockChild(el) {
  return (el.children || []).some((c) => c.type === "element" && BLOCK.has(c.tag));
}

function trimRuns(runs) {
  // collapse leading/trailing white space of a paragraph
  const r = runs.slice();
  while (r.length && isText(r[0]) && !r[0].text.trim()) r.shift();
  while (r.length && isText(r[r.length - 1]) && !r[r.length - 1].text.trim()) r.pop();
  if (r.length && isText(r[0])) r[0] = { ...r[0], text: r[0].text.replace(/^\s+/, "") };
  if (r.length && isText(r[r.length - 1])) r[r.length - 1] = { ...r[r.length - 1], text: r[r.length - 1].text.replace(/\s+$/, "") };
  return r;
}

function blockProps(el) {
  const css = parseCss(getAttr(el, "style"));
  const p = {};
  const al = css["text-align"] || getAttr(el, "align");
  if (["left", "center", "right", "justify"].includes(al)) p.align = al;
  const mt = cssLengthPt(css["margin-top"]);
  const mb = cssLengthPt(css["margin-bottom"]);
  const ml = cssLengthPt(css["margin-left"] || css["padding-left"]);
  const ti = cssLengthPt(css["text-indent"]);
  if (mt !== undefined) p.spaceBefore = Math.max(0, mt);
  if (mb !== undefined) p.spaceAfter = Math.max(0, mb);
  if (ml !== undefined && ml > 0) p.indentLeft = ml;
  if (ti !== undefined) p.indentFirst = ti;
  const lh = parseFloat(css["line-height"]);
  if (lh > 0 && lh < 5 && /^[\d.]+$/.test(String(css["line-height"]).trim())) p.lineHeight = lh;
  if (/page/.test(css["page-break-before"] || css["break-before"] || "")) p.pageBreakBefore = true;
  return p;
}

function classStyle(el, model) {
  for (const c of (getAttr(el, "class") || "").split(/\s+/)) {
    const m = /^s-([\w-]+)$/.exec(c);
    if (m && model.styles[m[1]]) return m[1];
  }
  return null;
}

function walkBlocks(el, ctx, out, inh) {
  let runs = [];
  const flush = () => {
    const t = trimRuns(mergeRuns(runs));
    runs = [];
    if (!t.length) return;
    const p = { type: "paragraph", style: inh.style, runs: t };
    if (inh.list) {
      p.list = { ...inh.list };
      ctx.counts.lists++;
    }
    out.push(p);
  };
  for (const c of el.children || []) {
    if (c.type === "comment") {
      if (/pagebreak|page-break/i.test(ctx.srcOf?.(c) || "")) out.push({ type: "pageBreak" });
      continue;
    }
    if (c.type !== "element") {
      if (c.type === "text") walkInline({ children: [c] }, ctx, {}, runs, {});
      continue;
    }
    const tag = c.tag;
    if (DROP.has(tag)) {
      ctx.counts.dropped.add(tag);
      continue;
    }
    if (c._footnotes) continue;
    if (c.depth > MAX_DEPTH) {
      runs.push({ text: elementText(ctx.parsed, c).replace(/\s+/g, " ") });
      continue;
    }
    if (!BLOCK.has(tag)) {
      walkInline({ children: [c] }, ctx, {}, runs, {});
      continue;
    }
    flush();
    const css = parseCss(getAttr(c, "style"));
    if (/page/.test(css["page-break-before"] || css["break-before"] || "") && out.length) out.push({ type: "pageBreak" });
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const style = classStyle(c, ctx.model) || `Heading${tag[1]}`;
        const r = [];
        walkInline(c, ctx, blockMarks(c), r, {});
        const props = blockProps(c);
        out.push({ type: "paragraph", style, runs: trimRuns(mergeRuns(r)), ...(Object.keys(props).length ? { props } : {}) });
        break;
      }
      case "p":
      case "dt":
      case "dd":
      case "figcaption":
      case "summary":
      case "caption":
      case "address": {
        if (hasBlockChild(c)) {
          walkBlocks(c, ctx, out, inh);
          break;
        }
        const r = [];
        walkInline(c, ctx, blockMarks(c), r, {});
        const props = blockProps(c);
        const p = { type: "paragraph", style: classStyle(c, ctx.model) || inh.style, runs: trimRuns(mergeRuns(r)) };
        if (Object.keys(props).length) p.props = props;
        if (inh.list) p.list = { ...inh.list };
        out.push(p);
        break;
      }
      case "ul":
      case "ol": {
        const level = inh.list ? Math.min(8, inh.list.level + 1) : 0;
        const id = inh.list ? inh.list.id : `h${++ctx.listSeq}`;
        const kind = tag === "ol" ? "number" : "bullet";
        for (const li of c.children) {
          if (li.type !== "element") continue;
          if (li.tag === "ul" || li.tag === "ol") {
            walkBlocks({ children: [li] }, ctx, out, { style: "List", list: { kind, level, id } });
            continue;
          }
          walkListItem(li, ctx, out, { kind, level, id: kind === "number" ? id : id });
        }
        break;
      }
      case "li":
        walkListItem(c, ctx, out, inh.list || { kind: "bullet", level: 0, id: `h${++ctx.listSeq}` });
        break;
      case "blockquote":
        walkBlocks(c, ctx, out, { ...inh, style: "Quote" });
        break;
      case "pre": {
        const r = [];
        walkInline(c, ctx, { font: undefined }, r, { pre: true });
        // split at newlines into Code paragraphs
        let cur = [];
        const lines = [];
        for (const run of mergeRuns(r)) {
          if (!isText(run)) {
            cur.push(run);
            continue;
          }
          const parts = run.text.split("\n");
          parts.forEach((t, k) => {
            if (k) {
              lines.push(cur);
              cur = [];
            }
            if (t) cur.push({ ...run, text: t });
          });
        }
        lines.push(cur);
        while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
        for (const l of lines) out.push({ type: "paragraph", style: "Code", runs: mergeRuns(l) });
        break;
      }
      case "hr":
        out.push({ type: "rule" });
        break;
      case "table":
        if (inh.inTable) {
          ctx.report.flattened("Nested tables were converted to paragraphs.");
          walkBlocks(c, ctx, out, { ...inh, inTable: false });
        } else readTable(c, ctx, out);
        break;
      case "tr":
      case "td":
      case "th":
      case "tbody":
      case "thead":
      case "tfoot":
        walkBlocks(c, ctx, out, inh);
        break;
      default:
        if (/(^|\s)page-break(\s|$)/.test(getAttr(c, "class") || "") || /page/.test(css["break-after"] || css["page-break-after"] || "")) {
          walkBlocks(c, ctx, out, inh);
          out.push({ type: "pageBreak" });
        } else walkBlocks(c, ctx, out, { ...inh, style: classStyle(c, ctx.model) || inh.style });
    }
  }
  flush();
}

function blockMarks(el) {
  const m = marksFromCss(parseCss(getAttr(el, "style")), {});
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

function walkListItem(li, ctx, out, list) {
  // text before a nested list is the item's paragraph; nested lists go one level deeper
  let runs = [];
  let emitted = false;
  const flush = (force) => {
    const t = trimRuns(mergeRuns(runs));
    runs = [];
    if (!t.length && !force) return;
    out.push({ type: "paragraph", style: "List", runs: t, list: { ...list } });
    ctx.counts.lists++;
    emitted = true;
  };
  for (const c of li.children || []) {
    if (c.type === "element" && (c.tag === "ul" || c.tag === "ol")) {
      if (!emitted) flush(true);
      walkBlocks({ children: [c] }, ctx, out, { style: "List", list });
    } else if (c.type === "element" && (c.tag === "p" || c.tag === "div")) {
      walkInline(c, ctx, {}, runs, {});
      runs.push({ type: "break" });
    } else if (c.type === "element" && BLOCK.has(c.tag) && c.tag !== "li") {
      flush(!emitted);
      walkBlocks({ children: [c] }, ctx, out, { style: "Normal", list: null });
    } else walkInline({ children: [c] }, ctx, {}, runs, {});
  }
  while (runs.length && runs[runs.length - 1].type === "break") runs.pop();
  if (runs.length || !emitted) flush(!emitted);
}

function readTable(el, ctx, out) {
  ctx.counts.tables++;
  const rows = [];
  const visit = (e, header) => {
    for (const c of e.children || []) {
      if (c.type !== "element") continue;
      if (c.tag === "thead") visit(c, true);
      else if (c.tag === "tbody" || c.tag === "tfoot") visit(c, false);
      else if (c.tag === "tr" && rows.length < 2000) {
        const row = { cells: [] };
        let allTh = true;
        for (const td of c.children) {
          if (td.type !== "element" || (td.tag !== "td" && td.tag !== "th")) continue;
          if (td.tag !== "th") allTh = false;
          const blocks = [];
          walkBlocks(td, ctx, blocks, { style: "Normal", list: null, inTable: true });
          const cell = { blocks: blocks.filter((b) => b.type === "paragraph") };
          if (!cell.blocks.length) cell.blocks.push({ type: "paragraph", style: "Normal", runs: [] });
          const cs = parseInt(getAttr(td, "colspan") || "1", 10);
          const rs = parseInt(getAttr(td, "rowspan") || "1", 10);
          if (cs > 1) cell.colspan = Math.min(64, cs);
          if (rs > 1) cell.rowspan = Math.min(2000, rs);
          const css = parseCss(getAttr(td, "style"));
          const bg = normColor(css["background-color"] || css.background || getAttr(td, "bgcolor"));
          if (bg) cell.shading = bg;
          if (["middle", "bottom"].includes(css["vertical-align"])) cell.vAlign = css["vertical-align"];
          row.cells.push(cell);
        }
        if (header || (allTh && row.cells.length && rows.length === 0)) row.header = true;
        if (row.cells.length) rows.push(row);
      } else if (c.tag !== "caption" && c.tag !== "colgroup") visit(c, header);
    }
  };
  visit(el, false);
  if (!rows.length) return;
  const ncols = Math.max(1, ...rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan || 1), 0)));
  const css = parseCss(getAttr(el, "style"));
  const tw = cssLengthPt(css.width) || 450;
  const cols = Array.from({ length: ncols }, () => Math.round((Math.min(tw, 1000) / ncols) * 100) / 100);
  const border = getAttr(el, "border");
  const bordered = /\bb\b/.test(getAttr(el, "class") || "") || (border && border !== "0") || !/\bnb\b/.test(getAttr(el, "class") || "");
  const caption = (el.children || []).find((c) => c.type === "element" && c.tag === "caption");
  if (caption) {
    const r = [];
    walkInline(caption, ctx, {}, r, {});
    out.push({ type: "paragraph", style: "Normal", runs: trimRuns(mergeRuns(r)) });
  }
  out.push({ type: "table", cols, rows, borders: bordered ? { style: "single", width: 0.5, color: normColor(css["--bc"]) || "#808080" } : { style: "none", width: 0.5, color: "#808080" } });
}

function walkInline(el, ctx, marks, runs, opt) {
  for (const c of el.children || []) {
    if (c.type === "text") {
      let t = decodeEntities(c.text);
      if (!opt.pre) t = t.replace(/[ \t\r\n\f]+/g, " ");
      if (t) runs.push({ text: t, ...marks });
      continue;
    }
    if (c.type !== "element") continue;
    const tag = c.tag;
    if (DROP.has(tag)) {
      ctx.counts.dropped.add(tag);
      continue;
    }
    if (c.depth > MAX_DEPTH) {
      runs.push({ text: elementText(ctx.parsed, c).replace(/\s+/g, " "), ...marks });
      continue;
    }
    let m = { ...marks };
    const css = parseCss(getAttr(c, "style"));
    switch (tag) {
      case "br":
        runs.push(opt.pre ? { text: "\n", ...marks } : { type: "break" });
        continue;
      case "img": {
        const srcAttr = getAttr(c, "src") || "";
        const data = srcAttr.startsWith("data:") ? parseDataUri(srcAttr) : null;
        if (!data) {
          if (srcAttr) ctx.counts.remote++;
          const alt = getAttr(c, "alt");
          if (alt) runs.push({ text: `[${alt}]`, ...marks });
          continue;
        }
        const id = addMedia(ctx.model, { bytes: data.bytes, mime: data.mime, name: "image" });
        const size = ctx.model.media[id];
        let { width, height } = fitSize(size);
        const w = cssLengthPt(css.width) || (getAttr(c, "width") ? parseFloat(getAttr(c, "width")) * 0.75 : 0);
        const h = cssLengthPt(css.height) || (getAttr(c, "height") ? parseFloat(getAttr(c, "height")) * 0.75 : 0);
        if (w > 0 && h > 0) [width, height] = [w, h];
        else if (w > 0) [width, height] = [w, (w * height) / width];
        ctx.counts.images++;
        const alt = getAttr(c, "alt");
        runs.push({ type: "image", media: id, width, height, ...(alt ? { alt } : {}) });
        continue;
      }
      case "a": {
        const href = getAttr(c, "href") || "";
        const fn = href.startsWith("#") ? ctx.footnoteIds.get(href.slice(1)) : null;
        if (fn && !opt.inFootnote) {
          runs.push({ type: "footnote", id: fn });
          continue;
        }
        if (opt.inFootnote && /footnote-backref|backref/.test(getAttr(c, "class") || "")) continue;
        const safe = safeHref(href);
        if (safe && !/^#/.test(safe)) {
          m.link = safe;
          ctx.counts.links++;
        }
        break;
      }
      case "b":
      case "strong":
        m.b = true;
        break;
      case "i":
      case "em":
      case "cite":
      case "dfn":
      case "var":
        m.i = true;
        break;
      case "u":
      case "ins":
        m.u = true;
        break;
      case "s":
      case "strike":
      case "del":
        m.s = true;
        break;
      case "sub":
        m.va = "sub";
        break;
      case "sup":
        if ((c.children || []).length === 1 && c.children[0].type === "element" && c.children[0].tag === "a" && ctx.footnoteIds.get((getAttr(c.children[0], "href") || "").slice(1))) {
          walkInline(c, ctx, marks, runs, opt);
          continue;
        }
        m.va = "super";
        break;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        m.font = "Consolas";
        break;
      case "mark":
        m.highlight = "#ffff00";
        break;
      case "font": {
        const col = normColor(getAttr(c, "color"));
        if (col) m.color = col;
        if (getAttr(c, "face")) m.font = getAttr(c, "face").split(",")[0].trim();
        break;
      }
      case "small":
        m.size = (marks.size || 11) * 0.85;
        break;
      case "big":
        m.size = (marks.size || 11) * 1.2;
        break;
    }
    m = marksFromCss(css, m);
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    walkInline(c, ctx, m, runs, opt);
  }
}

export { escT as escapeHtmlText };
