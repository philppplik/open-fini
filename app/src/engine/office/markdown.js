// Markdown import (through the Code studio's CommonMark/GFM renderer and the sanitized HTML reader) and a Markdown
// serializer for the office document model, plus plain text import/export. Pure.
import { renderMarkdown } from "../web/markdown.js";
import { readHtml } from "./html.js";
import { normalizeDoc, createDocument, headingLevel, tableGrid, isText, paraText, para } from "./model.js";
import { dataUri } from "./media.js";
import { createReport, plural } from "./report.js";

export function readMarkdown(source, o = {}) {
  const report = o.report || createReport("Markdown", o.name);
  const { html, meta } = renderMarkdown(String(source ?? "").slice(0, 20 * 1024 * 1024), { idPrefix: "md-" });
  const { doc } = readHtml(html, { report, format: "Markdown" });
  if (typeof meta?.title === "string") doc.meta.title = meta.title;
  if (typeof meta?.author === "string") doc.meta.author = meta.author;
  report.note("Markdown has no page setup, fonts or colors; the document uses the default styles.");
  return { doc, report };
}

const escMd = (s) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\]<>|~])/g, "\\$1")
    .replace(/^(\s*)([#+-]|\d+[.)])(\s)/, "$1\\$2$3");

function inlineMd(doc, runs, notes) {
  let x = "";
  for (const r of runs) {
    if (isText(r)) {
      const code = r.font && /mono|consol|courier|code/i.test(r.font);
      let t = code ? `\`${r.text.replace(/`/g, "'")}\`` : escMd(r.text);
      const lead = t.match(/^\s*/)[0];
      const trail = t.match(/\s*$/)[0];
      let core = t.trim();
      if (core) {
        if (r.va === "sub") core = `<sub>${core}</sub>`;
        if (r.va === "super") core = `<sup>${core}</sup>`;
        if (r.highlight) core = `<mark>${core}</mark>`;
        if (r.u && !r.link) core = `<u>${core}</u>`;
        if (r.s) core = `~~${core}~~`;
        if (r.i) core = `*${core}*`;
        if (r.b) core = `**${core}**`;
        if (r.link) core = `[${core}](${r.link.replace(/[()\s]/g, encodeURIComponent)})`;
      }
      x += lead + core + (core ? trail : "");
    } else if (r.type === "break") x += "\\\n";
    else if (r.type === "image") {
      const m = doc.media[r.media];
      if (m?.bytes) x += `![${escMd(r.alt || "")}](${dataUri(m.mime, m.bytes)})`;
    } else if (r.type === "footnote") {
      if (!notes.has(r.id)) notes.set(r.id, notes.size + 1);
      x += `[^${notes.get(r.id)}]`;
    } else if (r.type === "field") x += r.field === "date" ? new Date().toISOString().slice(0, 10) : "";
  }
  return x;
}

/**
 * Writes Markdown (GitHub flavored: tables, strikethrough, footnotes). Merged table cells are repeated empty, colors
 * and fonts are dropped, underline/highlight/sub/superscript use inline HTML.
 */
export function writeMarkdown(input) {
  const doc = normalizeDoc(input);
  const notes = new Map();
  const out = [];
  const counters = [];
  let prevList = false;
  for (const b of doc.blocks) {
    if (b.type === "paragraph") {
      const text = inlineMd(doc, b.runs, notes);
      if (b.list) {
        const L = b.list.level || 0;
        const key = `${b.list.id}:${b.list.kind}`;
        if (L === 0 && prevList && prevList !== key) {
          out.push("");
          counters.length = 0;
        }
        counters.length = L + 1;
        counters[L] = (counters[L] || 0) + 1;
        const indent = "   ".repeat(L);
        out.push(`${indent}${b.list.kind === "number" ? `${counters[L]}.` : "-"} ${text}`);
        if (L === 0 || !prevList) prevList = key;
        continue;
      }
      if (prevList) out.push("");
      prevList = false;
      counters.length = 0;
      const lvl = headingLevel(doc, b);
      if (lvl) out.push(`${"#".repeat(Math.min(6, lvl))} ${text}`, "");
      else if (b.style === "Title") out.push(`# ${text}`, "");
      else if (b.style === "Code") out.push("```", paraText(b).replace(/\uFFFC/g, ""), "```", "");
      else if (b.style === "Quote") out.push(`> ${text}`, "");
      else out.push(text || "&nbsp;", "");
    } else {
      if (prevList) out.push("");
      prevList = false;
      counters.length = 0;
      if (b.type === "rule") out.push("---", "");
      else if (b.type === "pageBreak") out.push('<div style="break-after: page"></div>', "");
      else if (b.type === "table") {
        const grid = tableGrid(b);
        const rows = b.rows.map((row, r) => b.cols.map((_, c) => {
          const g = grid[r][c];
          if (!g || !g.origin) return "";
          return row.cells[g.ci].blocks.map((p) => inlineMd(doc, p.runs, notes)).join("<br>").replace(/\|/g, "\\|").replace(/\n/g, " ");
        }));
        const line = (cells) => `| ${cells.join(" | ")} |`;
        out.push(line(rows[0]), line(b.cols.map(() => "---")), ...rows.slice(1).map(line), "");
      }
    }
  }
  // merge consecutive code fences and quotes
  let md = out.join("\n").replace(/```\n\n```\n/g, "").replace(/\n{3,}/g, "\n\n");
  if (notes.size) md += `\n${[...notes].map(([id, n]) => `[^${n}]: ${(doc.footnotes[id] || []).map((p) => inlineMd(doc, p.runs, new Map())).join(" ")}`).join("\n")}\n`;
  return `${md.trim()}\n`;
}

// ------------------------------------------------------------------------------------------------ plain text

export function readText(text, o = {}) {
  const report = o.report || createReport("Plain text", o.name);
  const doc = createDocument();
  const src = String(text ?? "").replace(/^\uFEFF/, "").slice(0, 50 * 1024 * 1024);
  const blocks = [];
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    const parts = line.split("\f");
    parts.forEach((t, k) => {
      if (k) blocks.push({ type: "pageBreak" });
      if (k === 0 || t) blocks.push(para(t));
    });
  }
  doc.blocks = blocks.length ? blocks : [para("")];
  report.kept(`${plural(doc.blocks.length, "line")} of text.`);
  return { doc: normalizeDoc(doc), report };
}

export function writeText(input) {
  const doc = normalizeDoc(input);
  const out = [];
  const counters = [];
  for (const b of doc.blocks) {
    if (b.type === "paragraph") {
      const t = paraText(b).replace(/\uFFFC/g, "");
      if (b.list) {
        const L = b.list.level || 0;
        const key = `${b.list.id}:${b.list.kind}`;
        if (L === 0 && counters.key !== key) counters.length = 0;
        if (L === 0) counters.key = key;
        counters.length = L + 1;
        counters[L] = (counters[L] || 0) + 1;
        out.push(`${"    ".repeat(L)}${b.list.kind === "number" ? `${counters[L]}.` : "•"} ${t}`);
      } else {
        counters.length = 0;
        out.push(t);
      }
    } else if (b.type === "table") out.push(...b.rows.map((r) => r.cells.map((c) => c.blocks.map((p) => paraText(p).replace(/\uFFFC/g, "")).join(" ")).join("\t")));
    else if (b.type === "pageBreak") out.push("\f");
    else if (b.type === "rule") out.push("----------");
  }
  return `${out.join("\n").replace(/\n\f\n/g, "\n\f")}\n`;
}
