// Knowledge base sources for the RAG tools (rag_add_source, rag_search, rag_list, rag_remove): adds text, project files,
// folders and fetched pages to the on-device KnowledgeIndex (app/src/ai/rag.js) with caps, records where every chunk
// starts (line and character) so answers can cite "source:line", and formats search hits as numbered citations.
// Pure apart from the injected index, reader and fetch. Embeddings come from the index's embedder (the user's
// configured embedding provider) when one is set; otherwise retrieval is BM25 on this device with no network at all.
//
// Public API
//   SOURCE_CAPS                                         per-call and per-file limits
//   isTextPath(path) → boolean                          extensions indexed as text
//   addTextSource(index, { id, title, text, source, kind }) → Promise<{ id, chunks, chars }>
//   addFiles(index, files, { prefix, kind, onProgress, signal, now }) → Promise<{ added, skipped, chunks, truncated }>
//   listSources(index) → [{ id, title, kind, source, chunks, chars, added }]
//   searchWithCitations(index, query, k) → { results: [{ n, source, title, line, char, chunk, score, text }], cite }

export const SOURCE_CAPS = Object.freeze({ maxFiles: 300, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024, maxMillis: 60_000 });

const TEXT_EXT = /\.(txt|md|markdown|mdx|rst|adoc|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|svg|csv|tsv|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ps1|sql|lua|r|tex|bib|log|vue|svelte)$/i;
export const isTextPath = (p) => TEXT_EXT.test(String(p));

/** Start offset, line and character of each chunk inside `text` (chunks overlap, so search forward from the last start). */
export function chunkPositions(text, chunks) {
  const out = [];
  let from = 0;
  for (const c of chunks) {
    const probe = c.slice(0, Math.min(80, c.length));
    let at = text.indexOf(probe, from);
    if (at < 0) at = text.indexOf(probe);
    if (at < 0) at = from;
    let line = 1;
    for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) line++;
    out.push({ char: at, line });
    from = at + 1;
  }
  return out;
}

export async function addTextSource(index, { id, title, text, source, kind = "text", now = Date.now() }) {
  const clean = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!clean.trim()) throw new Error(`“${title || id}” has no text to index.`);
  const docId = `src:${id}`;
  const p = index.addDocument({ id: docId, title: title || id, text: clean, meta: { kind, source: source || id, added: now, chars: clean.length } });
  const doc = index.docs.get(docId);
  doc.meta.positions = chunkPositions(clean, doc.chunkIds.map((c) => index.chunks.get(c).text));
  try {
    await p;
  } catch {
    /* embedding failed: the source stays searchable with BM25 */
  }
  return { id: docId, chunks: doc.chunkIds.length, chars: clean.length };
}

/** Adds many { path, text } or { path, bytes } files, honoring SOURCE_CAPS. Never throws for a single bad file. */
export async function addFiles(index, files, { prefix = "file", kind = "file", onProgress, signal, clock = Date.now } = {}) {
  const t0 = clock();
  let total = 0;
  let chunks = 0;
  const added = [];
  const skipped = [];
  let truncated = false;
  for (const f of files) {
    if (signal?.aborted) throw signal.reason || new Error("Aborted.");
    if (added.length >= SOURCE_CAPS.maxFiles || clock() - t0 > SOURCE_CAPS.maxMillis) {
      truncated = true;
      break;
    }
    if (!isTextPath(f.path)) {
      skipped.push({ path: f.path, reason: "not a text file" });
      continue;
    }
    const size = f.bytes ? f.bytes.length : String(f.text ?? "").length;
    if (size > SOURCE_CAPS.maxFileBytes) {
      skipped.push({ path: f.path, reason: "larger than 2 MiB" });
      continue;
    }
    if (total + size > SOURCE_CAPS.maxTotalBytes) {
      truncated = true;
      break;
    }
    const text = f.text ?? new TextDecoder().decode(f.bytes);
    if (!text.trim() || /\u0000/.test(text.slice(0, 4096))) {
      skipped.push({ path: f.path, reason: "empty or binary" });
      continue;
    }
    total += size;
    const r = await addTextSource(index, { id: `${prefix}:${f.path}`, title: f.path, text, source: f.path, kind });
    chunks += r.chunks;
    added.push(f.path);
    onProgress?.({ files: added.length, bytes: total, path: f.path });
  }
  return { added, skipped, chunks, truncated };
}

export function listSources(index) {
  return index.listDocuments().map((d) => ({ id: d.id, title: d.title, kind: d.meta?.kind || (d.meta?.project ? "project" : "note"), source: d.meta?.source || d.title, chunks: d.chunks, chars: d.meta?.chars ?? null, added: d.meta?.added ? new Date(d.meta.added).toISOString() : null }));
}

/** Search hits as numbered citations: `[n] source:line`. */
export async function searchWithCitations(index, query, k = 5) {
  const hits = await index.search(query, { k });
  const results = hits.map((hh, i) => {
    const chunk = Number(String(hh.chunkId).split("#").pop()) || 0;
    const pos = hh.meta?.positions?.[chunk] || null;
    return { n: i + 1, source: hh.meta?.source || hh.title, title: hh.title, line: pos?.line ?? null, char: pos?.char ?? null, chunk, score: Math.round(hh.score * 1000) / 1000, text: hh.text };
  });
  return { results, cite: results.map((r) => `[${r.n}] ${r.source}${r.line ? `:${r.line}` : ` (chunk ${r.chunk + 1})`}`).join("\n") };
}
