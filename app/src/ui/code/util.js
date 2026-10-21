// Small helpers shared by the Code studio modules.
import { h } from "../../core/util.js";

const FILE_ICONS = {
  html: "filetype-html",
  htm: "filetype-html",
  css: "filetype-css",
  js: "filetype-js",
  mjs: "filetype-js",
  json: "filetype-json",
  webmanifest: "filetype-json",
  md: "filetype-md",
  svg: "filetype-svg",
  xml: "filetype-xml",
  png: "filetype-png",
  jpg: "filetype-jpg",
  jpeg: "filetype-jpg",
  gif: "filetype-gif",
  webp: "file-earmark-image",
  avif: "file-earmark-image",
  ico: "file-earmark-image",
  bmp: "file-earmark-image",
  woff: "fonts",
  woff2: "fonts",
  ttf: "fonts",
  otf: "fonts",
  mp4: "file-earmark-play",
  webm: "file-earmark-play",
  mp3: "file-earmark-music",
  wav: "file-earmark-music",
  ogg: "file-earmark-music",
  pdf: "filetype-pdf",
  txt: "filetype-txt",
  markdown: "filetype-md",
  mdx: "filetype-md",
  tex: "file-earmark-text",
  latex: "file-earmark-text",
  bib: "file-earmark-text",
  sty: "file-earmark-text",
  cls: "file-earmark-text",
  csv: "file-earmark-text",
  tsv: "file-earmark-text",
  yaml: "file-earmark-code",
  yml: "file-earmark-code",
  toml: "file-earmark-code",
  ini: "file-earmark-code",
  ts: "filetype-js",
  tsx: "filetype-js",
  jsx: "filetype-js",
  tmpl: "filetype-html",
};

export function fileIconName(path) {
  const ext = path.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "file-earmark";
}

export const fileIcon = (path) => h("sl-icon.of-fileicon", { name: fileIconName(path), "data-ext": path.split(".").pop().toLowerCase() });

export const isImagePath = (p) => /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i.test(p);
export const isFontPath = (p) => /\.(woff2?|ttf|otf)$/i.test(p);

/** 1-based line and column of an offset. */
export function lineCol(text, offset) {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, col: offset - last };
}

/** Offset of a 1-based line/column. */
export function offsetOf(text, line, col = 1) {
  let off = 0;
  for (let l = 1; l < line; l++) {
    const i = text.indexOf("\n", off);
    if (i < 0) return text.length;
    off = i + 1;
  }
  return Math.min(text.length, off + Math.max(0, col - 1));
}

/** Smallest single replacement that turns `a` into `b` (keeps cursors stable when a document is reformatted). */
export function trimmedChange(a, b) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** Case-insensitive subsequence match; returns a score (higher is better) or -1. */
export function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1 + (prev === i - 1 ? 2 : 0) + (i === 0 || /[\s/._-]/.test(t[i - 1]) ? 3 : 0);
      prev = i;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return score - t.length * 0.01;
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
