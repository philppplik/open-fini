// Resolves where a comment thread points, in terms an AI (or any script) can act on. Pure (no DOM, no app):
// everything that needs the open document is injected through `env`, so the functions run in Node and are unit tested
// (tests/collab/comment-context.test.js). The Vibe comment tools (vibe/tools/comments.js) build the real `env`.
//
// Public API
//   resolveTarget(anchor, env) → Target          what the anchor points at right now
//   describeThread(thread, env, { max }) → object   JSON-ready summary: id, status, author, thread messages, target
//   excerptLines(text, fromLine, toLine, { before, after, maxChars }) → { from, to, text }   numbered window of lines
//   findQuote(text, quote, hintLine) → line | null   where a quoted line moved to (nearest to the hint)
// env (all optional; a missing callback yields a target with `exists: false` or fewer details)
//   findNode(id) → node | null                      Vector / Pixel / Layout layer
//   pageName(id) → string | null
//   nodeBounds(node) → {x,y,w,h} | null
//   nodeInfo(node) → object                         compact description (type, name, text, fill ...)
//   fileText(path) → string | null                  Code studio file
//   elementAt(path, sel) → { tag, outerHtml, startLine, endLine, text } | null   website element by element path
//   blockText(path[]) → string | null               Office paragraph text for a path like [3] or [2,0,1,0]
// Target.type: "document" | "page" | "layer" | "region" | "code" | "element" | "text".
// Invariant: output is plain JSON (strings, numbers, booleans, arrays, objects) and bounded in size.

const clip = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ""));
const r1 = (n) => Math.round(n * 10) / 10;

/** A numbered window of lines around [fromLine, toLine] (1-based). */
export function excerptLines(text, fromLine, toLine = fromLine, { before = 3, after = 3, maxChars = 2400 } = {}) {
  const lines = String(text ?? "").split("\n");
  const a = Math.max(1, Math.min(lines.length, Math.floor(fromLine) || 1));
  const b = Math.max(a, Math.min(lines.length, Math.floor(toLine) || a));
  const from = Math.max(1, a - before);
  const to = Math.min(lines.length, b + after);
  let out = "";
  for (let i = from; i <= to; i++) {
    const row = `${i === a || (i > a && i <= b) ? ">" : " "} ${i}\t${lines[i - 1]}\n`;
    if (out.length + row.length > maxChars) break;
    out += row;
  }
  return { from, to, text: out.replace(/\n$/, "") };
}

/** Line number of the line equal to `quote` (trimmed), the one closest to `hint`; null when it is gone. */
export function findQuote(text, quote, hint = 1) {
  const q = String(quote || "").trim();
  if (!q) return null;
  const lines = String(text ?? "").split("\n");
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === q && (best === null || Math.abs(i + 1 - hint) < Math.abs(best - hint))) best = i + 1;
  }
  return best;
}

function parsePath(path) {
  if (Array.isArray(path)) return path;
  try {
    const p = JSON.parse(path);
    return Array.isArray(p) && p.every(Number.isInteger) ? p : null;
  } catch {
    return null;
  }
}

/** What the anchor points at right now. Never throws; unresolved anchors carry `exists: false` and the saved quote. */
export function resolveTarget(anchor, env = {}) {
  const a = anchor || { kind: "doc" };
  const quote = a.quote ? clip(a.quote, 200) : undefined;
  switch (a.kind) {
    case "node": {
      const node = env.findNode?.(a.node) || null;
      const page = a.page ? { id: a.page, name: env.pageName?.(a.page) ?? undefined } : undefined;
      if (!node) return { type: "layer", exists: false, layerId: a.node, note: "The layer was deleted; the comment keeps its saved position.", ...(a.pin ? { pin: a.pin } : {}), ...(quote ? { quote } : {}), ...(page ? { page } : {}) };
      const b = env.nodeBounds?.(node) || null;
      const out = { type: "layer", exists: true, layerId: a.node, name: node.name, layerType: node.type, ...(page ? { page } : {}) };
      if (b) {
        out.bounds = { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
        if (a.off) out.point = { x: r1(b.x + a.off.x * b.w), y: r1(b.y + a.off.y * b.h) };
      }
      const info = env.nodeInfo?.(node);
      if (info) out.layer = info;
      return out;
    }
    case "region":
      return { type: "region", exists: true, page: { id: a.page, name: env.pageName?.(a.page) ?? undefined }, point: a.pin || (a.rect ? { x: a.rect.x, y: a.rect.y } : undefined), ...(a.rect && (a.rect.w || a.rect.h) ? { rect: a.rect } : {}), ...(quote ? { quote } : {}) };
    case "page":
      return { type: "page", exists: !!env.pageName?.(a.page) || !env.pageName, page: { id: a.page, name: env.pageName?.(a.page) ?? quote } };
    case "line": {
      const text = env.fileText?.(a.path);
      const from = a.line || 1;
      const to = a.endLine || from;
      if (text == null) return { type: "code", exists: false, path: a.path, line: from, ...(a.endLine ? { endLine: to } : {}), ...(quote ? { quote } : {}), note: "The file no longer exists." };
      const lines = text.split("\n");
      const out = { type: "code", exists: from <= lines.length, path: a.path, line: from, endLine: to, ...(a.col !== undefined ? { col: a.col } : {}), ...(a.endCol !== undefined ? { endCol: a.endCol } : {}), totalLines: lines.length };
      if (from <= lines.length) {
        out.code = clip(lines.slice(from - 1, Math.min(to, lines.length)).join("\n"), 1500);
        out.context = excerptLines(text, from, to).text;
      }
      // the line text saved with the comment tells whether the code moved since
      const cur = lines[from - 1]?.trim();
      if (quote && a.endLine === undefined && cur !== quote.trim()) {
        const moved = findQuote(text, quote, from);
        out.stale = true;
        out.note = moved ? `The commented line moved: the saved text is now on line ${moved}.` : "The commented line was edited or removed since the comment was written.";
        if (moved) out.movedTo = moved;
      }
      if (quote) out.quote = quote;
      return out;
    }
    case "element": {
      const el = a.sel !== undefined && env.elementAt ? env.elementAt(a.path, a.sel) : null;
      if (!el) return { type: "element", exists: false, ...(a.path ? { file: a.path } : {}), ...(a.sel ? { selector: a.sel } : {}), ...(quote ? { quote } : {}), note: "The element could not be located (it may have moved or been removed)." };
      return { type: "element", exists: true, file: a.path, selector: a.sel, tag: el.tag, startLine: el.startLine, endLine: el.endLine, outerHtml: clip(el.outerHtml, 1200), ...(el.text ? { text: clip(el.text, 300) } : {}), ...(quote ? { quote } : {}) };
    }
    case "text": {
      const path = parsePath(a.path);
      const full = path && env.blockText ? env.blockText(path) : null;
      if (full == null) return { type: "text", exists: false, ...(path ? { blockPath: path } : {}), ...(quote ? { quote } : {}), note: "The paragraph no longer exists." };
      const from = Math.min(a.from ?? 0, full.length);
      const to = Math.min(a.to ?? from, full.length);
      const selected = full.slice(from, to);
      const out = { type: "text", exists: true, blockPath: path, from, to, paragraph: clip(full, 1200), ...(selected ? { selectedText: clip(selected, 600) } : {}) };
      if (quote) {
        out.quote = quote;
        if (selected && selected !== quote && !selected.includes(quote)) {
          const i = full.indexOf(quote);
          out.stale = true;
          out.note = i >= 0 ? `The quoted text moved to offset ${i} of the paragraph.` : "The quoted text was edited since the comment was written.";
          if (i >= 0) out.movedTo = i;
        }
      }
      return out;
    }
    case "item":
      // Office Suite apps (sheet cell, slide object, board item): identified by the app's record key
      return { type: "item", exists: true, item: a.item, ...(quote ? { quote } : {}), note: "An item of an Office Suite document (cell, slide object or board item); its quote names it." };
    default:
      return { type: "document", exists: true };
  }
}

/** JSON-ready summary of a thread (messages without deleted ones; the target resolved against `env`). */
export function describeThread(th, env = {}, { max = 20 } = {}) {
  const msgs = th.messages.filter((m) => !m.deleted);
  return {
    id: th.id,
    status: th.resolved ? "resolved" : "open",
    author: th.nick || "Unknown author",
    createdAt: new Date(th.ts).toISOString(),
    ...(th.resolved ? { resolvedBy: th.resolvedBy || "Unknown author" } : {}),
    anchorKind: th.anchor?.kind || "doc",
    target: resolveTarget(th.anchor, env),
    messages: msgs.slice(0, max).map((m) => ({ id: m.id, author: m.nick || "Unknown author", text: m.text, at: new Date(m.ts).toISOString() })),
  };
}

