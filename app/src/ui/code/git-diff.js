// Diff viewer for Source Control: unified or side-by-side, with long unchanged stretches folded.
import { h, empty } from "../../core/util.js";
import { diffBlocks, splitLines } from "../../engine/git/diff.js";

const CONTEXT = 3;

/** Rows of a whole-file diff. Row: { t: "ctx"|"del"|"add"|"skip", text, a, b, n } */
export function diffRows(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const rows = [];
  let ai = 0;
  let bi = 0;
  const ctx = (to) => {
    const n = to - ai;
    const keepHead = rows.length ? CONTEXT : 0; // after a change
    const run = [];
    for (let i = 0; i < n; i++) run.push({ t: "ctx", text: a[ai + i], a: ai + i + 1, b: bi + i + 1 });
    const tail = to < a.length ? CONTEXT : 0; // before the next change
    if (run.length > keepHead + tail + 2) {
      rows.push(...run.slice(0, keepHead), { t: "skip", n: run.length - keepHead - tail }, ...run.slice(run.length - tail));
    } else rows.push(...run);
    ai += n;
    bi += n;
  };
  for (const k of diffBlocks(a, b)) {
    ctx(k.aStart);
    for (let i = 0; i < k.aLen; i++) rows.push({ t: "del", text: a[ai + i], a: ai + i + 1 });
    for (let i = 0; i < k.bLen; i++) rows.push({ t: "add", text: b[bi + i], b: bi + i + 1 });
    ai += k.aLen;
    bi += k.bLen;
  }
  ctx(a.length);
  return rows;
}

const clean = (s) => s.replace(/\n$/, "");

/** @param {{ binary?: boolean, oldText: string, newText: string }} d @param {"unified"|"split"} mode */
export function renderDiff(d, mode = "unified") {
  const root = h("div.of-gdiff", { role: "table", "aria-label": "File changes" });
  if (d.binary) {
    root.append(h("div.of-empty", "Binary file. Its contents cannot be shown as text."));
    return root;
  }
  let rows = diffRows(d.oldText, d.newText);
  if (!rows.some((r) => r.t === "add" || r.t === "del")) {
    root.append(h("div.of-empty", "No changes in this file."));
    return root;
  }
  const draw = () => {
    empty(root);
    const out = [];
    if (mode === "unified") {
      for (const r of rows) out.push(r.t === "skip" ? skipRow(r) : h("div.of-gdiff__row", { class: `of-gdiff__${r.t}`, role: "row" }, h("span.of-gdiff__no", r.a ?? ""), h("span.of-gdiff__no", r.b ?? ""), h("span.of-gdiff__sign", r.t === "add" ? "+" : r.t === "del" ? "−" : " "), h("span.of-gdiff__text", clean(r.text))));
    } else {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.t === "skip") out.push(skipRow(r));
        else if (r.t === "ctx") out.push(split(r, r));
        else if (r.t === "del") {
          const dels = [];
          while (rows[i]?.t === "del") dels.push(rows[i++]);
          const adds = [];
          while (rows[i]?.t === "add") adds.push(rows[i++]);
          i--;
          for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push(split(dels[k], adds[k]));
        } else out.push(split(null, r));
      }
    }
    root.append(...out);
  };
  const split = (l, r) =>
    h(
      "div.of-gdiff__row.of-gdiff__split",
      { role: "row" },
      h("span.of-gdiff__no", l?.a ?? ""),
      h("span.of-gdiff__text", { class: l ? (l.t === "del" ? "of-gdiff__del" : "") : "of-gdiff__blank" }, l ? clean(l.text) : ""),
      h("span.of-gdiff__no", r?.b ?? ""),
      h("span.of-gdiff__text", { class: r ? (r.t === "add" ? "of-gdiff__add" : "") : "of-gdiff__blank" }, r ? clean(r.text) : ""),
    );
  const skipRow = (r) => {
    const b = h("button.of-gdiff__skip", { type: "button" }, `${r.n} unchanged lines — show`);
    b.addEventListener("click", () => {
      const a = splitLines(d.oldText);
      const bb = splitLines(d.newText);
      void bb;
      const idx = rows.indexOf(r);
      const before = rows[idx - 1];
      const startA = (before?.a ?? 0) + 1;
      const startB = (before?.b ?? 0) + 1;
      const fill = [];
      for (let i = 0; i < r.n; i++) fill.push({ t: "ctx", text: a[startA - 1 + i], a: startA + i, b: startB + i });
      rows = [...rows.slice(0, idx), ...fill, ...rows.slice(idx + 1)];
      draw();
    });
    return b;
  };
  draw();
  root.setMode = (m) => {
    mode = m;
    draw();
  };
  return root;
}
