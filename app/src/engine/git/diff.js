// Line diff (Myers, O(ND)), unified hunks and a three-way text merge with conflict markers. Pure.

/** Splits text into lines that keep their line ending, so a missing final newline shows up as a difference. */
export function splitLines(t) {
  if (!t) return [];
  return t.match(/[^\n]*\n|[^\n]+$/g) || [];
}

/**
 * Differences between two arrays of strings as change blocks (0-based, sorted, non-overlapping).
 * Beyond `maxD` edits the middle part is reported as one replaced block (still correct, only not minimal).
 * @returns {{aStart: number, aLen: number, bStart: number, bLen: number}[]}
 */
export function diffBlocks(a, b, maxD = 1500) {
  const n = a.length;
  const m = b.length;
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let ea = n;
  let eb = m;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const A = ea - s;
  const B = eb - s;
  if (!A && !B) return [];
  if (!A) return [{ aStart: s, aLen: 0, bStart: s, bLen: B }];
  if (!B) return [{ aStart: s, aLen: A, bStart: s, bLen: 0 }];
  const max = Math.min(A + B, maxD);
  const off = max + 1;
  const V = new Int32Array(2 * max + 3);
  const trace = [];
  let D = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(V.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < A && y < B && a[s + x] === b[s + y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= A && y >= B) {
        D = d;
        break outer;
      }
    }
  }
  if (D < 0) return [{ aStart: s, aLen: A, bStart: s, bLen: B }];
  const ops = []; // { x, y, del }
  let x = A;
  let y = B;
  for (let d = D; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[k - 1 + d] < v[k + 1 + d]) ? k + 1 : k - 1;
    const prevX = v[prevK + d];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    ops.push(x === prevX ? { x: prevX, y: prevY, del: false } : { x: prevX, y: prevY, del: true });
    x = prevX;
    y = prevY;
  }
  ops.reverse();
  const blocks = [];
  let cur = null;
  for (const op of ops) {
    if (!cur || op.x !== cur.aStart + cur.aLen - s || op.y !== cur.bStart + cur.bLen - s) {
      cur = { aStart: s + op.x, aLen: 0, bStart: s + op.y, bLen: 0 };
      blocks.push(cur);
    }
    if (op.del) cur.aLen++;
    else cur.bLen++;
  }
  return blocks;
}

/**
 * Unified-diff hunks of two texts: [{ aStart, aLen, bStart, bLen, lines: [{ t: " "|"+"|"-", text, a, b }] }]
 * (`a`/`b` are 1-based line numbers in the old/new text where they apply).
 */
export function diffHunks(aText, bText, context = 3) {
  const a = splitLines(aText);
  const b = splitLines(bText);
  const blocks = diffBlocks(a, b);
  const hunks = [];
  let cur = null;
  let ai = 0; // next old line not yet emitted
  const flushContextAfter = (until) => {
    while (ai < until && cur.trailing < context) {
      cur.lines.push({ t: " ", text: a[ai], a: ai + 1, b: ai + 1 + cur.shift });
      ai++;
      cur.trailing++;
    }
  };
  let shift = 0; // newLine - oldLine for unchanged lines
  for (const blk of blocks) {
    const gap = blk.aStart - ai;
    if (cur && gap > context * 2) {
      flushContextAfter(blk.aStart);
      hunks.push(cur);
      cur = null;
    }
    if (!cur) {
      const from = Math.max(ai, blk.aStart - context);
      cur = { lines: [], trailing: 0, shift, aStart: from + 1, bStart: from + 1 + shift };
      ai = from;
    }
    while (ai < blk.aStart) {
      cur.lines.push({ t: " ", text: a[ai], a: ai + 1, b: ai + 1 + shift });
      ai++;
    }
    cur.shift = shift;
    for (let i = 0; i < blk.aLen; i++) cur.lines.push({ t: "-", text: a[blk.aStart + i], a: blk.aStart + i + 1 });
    for (let i = 0; i < blk.bLen; i++) cur.lines.push({ t: "+", text: b[blk.bStart + i], b: blk.bStart + i + 1 });
    ai = blk.aStart + blk.aLen;
    shift += blk.bLen - blk.aLen;
    cur.shift = shift;
    cur.trailing = 0;
  }
  if (cur) {
    flushContextAfter(a.length);
    hunks.push(cur);
  }
  return hunks.map((h) => {
    const aLen = h.lines.filter((l) => l.t !== "+").length;
    const bLen = h.lines.filter((l) => l.t !== "-").length;
    return { aStart: aLen ? h.aStart : h.aStart - 1, aLen, bStart: bLen ? h.bStart : h.bStart - 1, bLen, lines: h.lines.map(({ t, text, a: la, b: lb }) => ({ t, text, a: la, b: lb })) };
  });
}

/** Unified diff text ("--- a/…", "+++ b/…", "@@ … @@"). */
export function unifiedDiff(path, aText, bText, { context = 3, aLabel, bLabel } = {}) {
  const hunks = diffHunks(aText ?? "", bText ?? "", context);
  if (!hunks.length) return "";
  let out = `--- ${aText == null ? "/dev/null" : aLabel || `a/${path}`}\n+++ ${bText == null ? "/dev/null" : bLabel || `b/${path}`}\n`;
  for (const h of hunks) {
    out += `@@ -${h.aStart}${h.aLen === 1 ? "" : `,${h.aLen}`} +${h.bStart}${h.bLen === 1 ? "" : `,${h.bLen}`} @@\n`;
    for (const l of h.lines) out += `${l.t}${l.text}${l.text.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`;
  }
  return out;
}

/** Counts of added and removed lines. */
export function diffStat(aText, bText) {
  let add = 0;
  let del = 0;
  for (const k of diffBlocks(splitLines(aText ?? ""), splitLines(bText ?? ""))) {
    add += k.bLen;
    del += k.aLen;
  }
  return { add, del };
}

/**
 * Gutter marks for the editor: which lines of `current` are added or modified compared with `base`, and after which
 * line text was removed. Line numbers are 1-based; `removed` holds the line after which lines were deleted (0 = top).
 */
export function lineMarks(baseText, currentText) {
  const marks = { added: [], modified: [], removed: [] };
  const a = splitLines(baseText);
  const b = splitLines(currentText);
  for (const k of diffBlocks(a, b)) {
    if (k.bLen === 0) marks.removed.push(k.bStart);
    else for (let i = 0; i < k.bLen; i++) (k.aLen === 0 ? marks.added : marks.modified).push(k.bStart + i + 1);
  }
  return marks;
}

// ------------------------------------------------------------------ three-way merge

/**
 * Three-way merge of texts. Changes that touch the same or adjacent lines and differ become conflicts.
 * @returns {{ text: string, conflicts: number, clean: boolean }}
 */
export function merge3(baseText, oursText, theirsText, { oursLabel = "ours", theirsLabel = "theirs", baseLabel = null } = {}) {
  if (oursText === theirsText) return { text: oursText, conflicts: 0, clean: true };
  if (baseText === oursText) return { text: theirsText, conflicts: 0, clean: true };
  if (baseText === theirsText) return { text: oursText, conflicts: 0, clean: true };
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const bo = diffBlocks(base, ours);
  const bt = diffBlocks(base, theirs);
  const out = [];
  let conflicts = 0;
  let i = 0;
  let oi = 0;
  let ti = 0;
  let dO = 0; // ours index - base index before the current region
  let dT = 0;
  const nl = (lines) => (lines.length && !lines[lines.length - 1].endsWith("\n") ? [...lines.slice(0, -1), `${lines[lines.length - 1]}\n`] : lines);
  while (oi < bo.length || ti < bt.length) {
    const start = Math.min(bo[oi]?.aStart ?? Infinity, bt[ti]?.aStart ?? Infinity);
    for (; i < start; i++) out.push(base[i]);
    let end = start;
    let ownO = 0;
    let ownT = 0;
    let sumO = 0;
    let sumT = 0;
    for (;;) {
      if (oi < bo.length && bo[oi].aStart <= end) {
        end = Math.max(end, bo[oi].aStart + bo[oi].aLen);
        sumO += bo[oi].bLen - bo[oi].aLen;
        oi++;
        ownO++;
      } else if (ti < bt.length && bt[ti].aStart <= end) {
        end = Math.max(end, bt[ti].aStart + bt[ti].aLen);
        sumT += bt[ti].bLen - bt[ti].aLen;
        ti++;
        ownT++;
      } else break;
    }
    const oChunk = ours.slice(start + dO, end + dO + sumO);
    const tChunk = theirs.slice(start + dT, end + dT + sumT);
    dO += sumO;
    dT += sumT;
    if (ownO && !ownT) out.push(...oChunk);
    else if (ownT && !ownO) out.push(...tChunk);
    else if (oChunk.length === tChunk.length && oChunk.every((l, k) => l === tChunk[k])) out.push(...oChunk);
    else {
      conflicts++;
      out.push(`<<<<<<< ${oursLabel}\n`, ...nl(oChunk));
      if (baseLabel) out.push(`||||||| ${baseLabel}\n`, ...nl(base.slice(start, end)));
      out.push("=======\n", ...nl(tChunk), `>>>>>>> ${theirsLabel}\n`);
    }
    i = end;
  }
  for (; i < base.length; i++) out.push(base[i]);
  return { text: out.join(""), conflicts, clean: conflicts === 0 };
}

/** True when text still contains merge conflict markers at line starts. */
export const hasConflictMarkers = (t) => /^<<<<<<< .*\n[\s\S]*?^=======\n[\s\S]*?^>>>>>>> /m.test(t);
