// Groups the text runs of one imported PDF page into editable lines and paragraph blocks. Pure (no DOM).
// Input: `text` items from pdf-content.js. Output blocks: { x, baseline, lines, pitch, size, width, angle, hidden, clip }.
// A line is { x, baseline, width, runs: [{ text, fontId, fontName, size, color, advance, x, alpha }] }.

const sameStyle = (a, b) => a.fontId === b.fontId && Math.abs(a.size - b.size) < 0.05 && a.color === b.color && a.hidden === b.hidden && a.clip === b.clip;

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/** Builds lines out of unrotated runs (clusters by baseline, splits at large horizontal gaps). */
export function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters = [];
  for (const it of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(it.y - c.y) <= 0.3 * Math.min(it.size, c.size)) {
      c.items.push(it);
      c.y = (c.y * (c.items.length - 1) + it.y) / c.items.length;
      c.size = Math.min(c.size, it.size);
    } else clusters.push({ y: it.y, size: it.size, items: [it] });
  }
  const lines = [];
  for (const c of clusters) {
    c.items.sort((a, b) => a.x - b.x);
    let line = null;
    let prev = null;
    for (const it of c.items) {
      const end = prev ? prev.x + prev.advance : 0;
      const gap = prev ? it.x - end : 0;
      if (!line || gap > 2.5 * it.size || gap < -0.6 * it.size) {
        line = { x: it.x, baseline: c.y, runs: [], size: it.size, hidden: it.hidden, clip: it.clip, width: 0 };
        lines.push(line);
        prev = null;
      }
      const last = line.runs[line.runs.length - 1];
      let text = it.text;
      if (prev && gap > 0.15 * it.size && !/\s$/.test(last.text) && !/^\s/.test(text)) text = ` ${text}`;
      if (last && sameStyle(last, it)) {
        last.text += text;
        last.advance = it.x + it.advance - last.x;
      } else line.runs.push({ text, fontId: it.fontId, fontName: it.fontName, size: it.size, color: it.color, alpha: it.alpha, advance: it.advance, x: it.x, hidden: it.hidden, clip: it.clip, z: it.z });
      if (last && sameStyle(last, it)) last.z = Math.min(last.z, it.z);
      prev = it;
      line.width = it.x + it.advance - line.x;
    }
  }
  for (const l of lines) {
    const w = new Map();
    for (const r of l.runs) w.set(r.size, (w.get(r.size) || 0) + r.text.length);
    l.size = [...w.entries()].sort((a, b) => b[1] - a[1])[0][0];
    l.text = l.runs.map((r) => r.text).join('');
  }
  return lines.filter((l) => l.text.trim());
}

/**
 * @param {object[]} items text items
 * @param {{reflow?: boolean}} [opt] `reflow`: join the lines of a paragraph into one flowing paragraph
 */
export function buildBlocks(items, opt = {}) {
  const blocks = [];
  const straight = [];
  for (const it of items) {
    if (Math.abs(it.angle) > 0.02 || !(it.size > 0)) {
      if (it.text.trim()) blocks.push({ x: it.x, baseline: it.y, lines: [{ x: it.x, baseline: it.y, width: it.advance, size: it.size, runs: [it], text: it.text, hidden: it.hidden, clip: it.clip }], pitch: null, size: it.size, width: it.advance, angle: it.angle, hidden: it.hidden, clip: it.clip, z: it.z });
    } else straight.push(it);
  }
  const lines = buildLines(straight).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  /** @type {any[]} */
  const open = [];
  const paras = [];
  for (const l of lines) {
    let best = null;
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      const last = p.lines[p.lines.length - 1];
      const g = l.baseline - last.baseline;
      if (g > 3 * l.size) {
        open.splice(k, 1);
        continue;
      }
      if (g < 0.7 * l.size || g > 2.1 * l.size) continue;
      if (l.hidden !== p.hidden || l.clip !== p.clip || Math.abs(l.size / p.size - 1) > 0.08) continue;
      if (p.lines.length >= 2 && Math.abs(g - p.pitch) > 0.15 * p.pitch + 0.5) continue;
      const dx = l.x - p.x;
      const indented = p.lines.length === 1 && dx > -0.5 * l.size && dx < 3 * l.size && l.x >= p.x - 0.5 * l.size;
      const aligned = Math.abs(l.x - p.x) <= 0.6 * l.size || (p.lines.length >= 2 && Math.abs(l.x - p.x2) <= 0.6 * l.size);
      if (!indented && !aligned) continue;
      // a line that starts to the right of the paragraph body only joins as a second line (hanging indent)
      if (!best || g < best.g) best = { p, g, indented };
    }
    if (best) {
      const p = best.p;
      if (p.lines.length === 1 && best.indented && l.x < p.x - 0.01) p.x = l.x;
      if (p.lines.length === 1 && l.x > p.x + 0.6 * l.size) p.x2 = p.x; // first line is the indented one
      p.lines.push(l);
      p.pitch = p.lines.length === 2 ? best.g : (p.pitch * (p.lines.length - 2) + best.g) / (p.lines.length - 1);
    } else {
      const p = { x: l.x, x2: l.x, lines: [l], pitch: 0, size: l.size, hidden: l.hidden, clip: l.clip };
      paras.push(p);
      open.push(p);
    }
  }
  for (const p of paras) {
    let groups = [p.lines];
    if (opt.reflow && p.lines.length > 2) {
      // short lines end a paragraph
      const maxW = Math.max(...p.lines.map((l) => l.width));
      groups = [];
      let cur = [];
      p.lines.forEach((l, i) => {
        cur.push(l);
        if (l.width < maxW * 0.82 && i < p.lines.length - 1) {
          groups.push(cur);
          cur = [];
        }
      });
      if (cur.length) groups.push(cur);
    }
    for (const ls of groups) {
      const x = Math.min(...ls.map((l) => l.x));
      const width = Math.max(...ls.map((l) => l.x - x + l.width));
      const gaps = [];
      for (let i = 1; i < ls.length; i++) gaps.push(ls[i].baseline - ls[i - 1].baseline);
      blocks.push({ x, baseline: ls[0].baseline, lines: ls, pitch: gaps.length ? median(gaps) : null, size: ls[0].size, width, angle: 0, hidden: p.hidden, clip: p.clip, z: Math.min(...ls.flatMap((l) => l.runs.map((r) => r.z ?? 0))) });
    }
  }
  blocks.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  return blocks;
}

/** Plain text of a page in reading order (lines top to bottom, columns separated by blank lines are not detected). */
export function pageText(items) {
  const lines = buildLines(items.filter((i) => Math.abs(i.angle) <= 0.02)).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const out = [];
  let prev = null;
  for (const l of lines) {
    if (prev && l.baseline - prev.baseline > 1.8 * l.size) out.push('');
    out.push(l.text);
    prev = l;
  }
  return out.join('\n');
}
