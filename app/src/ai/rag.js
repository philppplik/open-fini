// Local retrieval: paragraph/sentence-aware chunking, BM25 index, optional dense vectors with hybrid
// (reciprocal rank fusion) search, JSON serialization. Pure, no dependencies.

import { base64ToBytes, bytesToBase64 } from "./util.js";

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

/** Splits `text` on `sep`, keeping the separator attached to the end of each part. */
function splitKeep(text, sep) {
  const out = [];
  let i = 0;
  for (;;) {
    const j = text.indexOf(sep, i);
    if (j < 0) break;
    out.push(text.slice(i, j + sep.length));
    i = j + sep.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function toUnits(text, size, seps) {
  if (text.length <= size) return [text];
  if (!seps.length) {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }
  const parts = splitKeep(text, seps[0]);
  if (parts.length === 1) return toUnits(text, size, seps.slice(1));
  const out = [];
  for (const p of parts) out.push(...(p.length <= size ? [p] : toUnits(p, size, seps.slice(1))));
  return out;
}

function overlapTail(s, overlap) {
  if (overlap <= 0 || s.length <= overlap) return "";
  const t = s.slice(s.length - overlap);
  const m = /\s/.exec(t);
  if (!m) return "";
  return t.slice(m.index + 1);
}

/**
 * Splits text into chunks of at most `size` characters, preferring paragraph, then line, then sentence,
 * then clause and word boundaries. Consecutive chunks share up to `overlap` characters of context.
 * @param {string} text
 * @param {{size?:number, overlap?:number, separators?:string[]}} [opts]
 * @returns {string[]}
 */
export function chunkText(text, { size = 900, overlap = 120, separators = DEFAULT_SEPARATORS } = {}) {
  text = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const units = toUnits(text, size, separators);
  const chunks = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + u.length > size) {
      chunks.push(cur.trim());
      const tail = overlapTail(cur, Math.min(overlap, Math.floor(size / 3)));
      cur = tail && tail.length + u.length <= size ? tail + u : u;
    } else cur += u;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

// ------------------------------------------------------------------ tokenizer

const STOP = new Set(
  "a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our she so such that the their them then there these they this to us was we were what when which who will with you your would can could should do does did been being than too very just also about over under again".split(
    " ",
  ),
);

/** Light English stemmer (suffix stripping). @param {string} w */
export function stem(w) {
  if (w.length <= 3) return w;
  if (/^\d+$/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) {
    w = w.slice(0, -3);
    if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  if (w.endsWith("ed") && w.length > 4) {
    w = w.slice(0, -2);
    if (/([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  if (w.endsWith("ly") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") && w.length > 3) return w.slice(0, -1);
  return w;
}

/**
 * Tokenizes text: lower-case words and numbers, stop words removed, stemmed.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (STOP.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function normalize(vec) {
  const v = Float32Array.from(vec);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

const RRF_K = 60;

/** Local knowledge index with BM25 and optional dense vectors. */
export class KnowledgeIndex {
  /** @param {{k1?:number, b?:number, chunkSize?:number, overlap?:number}} [opts] */
  constructor(opts = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
    this.chunkSize = opts.chunkSize ?? 900;
    this.overlap = opts.overlap ?? 120;
    /** @type {Map<string, {id:string,title:string,meta:any,chunkIds:string[]}>} */ this.docs = new Map();
    /** @type {Map<string, {id:string,docId:string,text:string,len:number,tf:Map<string,number>,vec:Float32Array|null}>} */ this.chunks = new Map();
    /** @type {Map<string, Map<string, number>>} */ this.postings = new Map();
    this.totalLen = 0;
    this.embedder = null;
    this.dim = 0;
  }

  /**
   * Sets (or clears) an async embedder `(texts: string[]) => number[][]`. Documents added afterwards are embedded;
   * call {@link KnowledgeIndex#embedMissing} to embed existing ones.
   * @param {((texts:string[])=>Promise<number[][]>)|null} fn
   */
  setEmbedder(fn) {
    this.embedder = fn || null;
  }

  /**
   * Adds or replaces a document. The BM25 part is applied synchronously; the returned promise resolves after
   * embedding (when an embedder is set). If embedding fails the document stays searchable via BM25 and the promise rejects.
   * @param {{id:string, title?:string, text:string, meta?:any}} doc
   * @returns {Promise<{docId:string, chunks:number}>}
   */
  addDocument(doc) {
    const id = String(doc.id);
    if (this.docs.has(id)) this.removeDocument(id);
    const title = doc.title || "";
    const pieces = chunkText(doc.text, { size: this.chunkSize, overlap: this.overlap });
    const chunkIds = [];
    const titleTokens = tokenize(title);
    pieces.forEach((text, i) => {
      const cid = `${id}#${i}`;
      const toks = titleTokens.concat(tokenize(text));
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [t, n] of tf) {
        let p = this.postings.get(t);
        if (!p) this.postings.set(t, (p = new Map()));
        p.set(cid, n);
      }
      this.chunks.set(cid, { id: cid, docId: id, text, len: toks.length, tf, vec: null });
      this.totalLen += toks.length;
      chunkIds.push(cid);
    });
    this.docs.set(id, { id, title, meta: doc.meta, chunkIds });
    const result = { docId: id, chunks: chunkIds.length };
    if (!this.embedder || !chunkIds.length) return Promise.resolve(result);
    return this._embedChunks(chunkIds).then(() => result);
  }

  async _embedChunks(ids) {
    const fn = this.embedder;
    const BATCH = 64;
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const vecs = await fn(slice.map((cid) => this.chunks.get(cid)?.text ?? ""));
      if (!Array.isArray(vecs) || vecs.length !== slice.length) throw new Error("The embedder returned the wrong number of vectors.");
      slice.forEach((cid, k) => {
        const c = this.chunks.get(cid);
        if (!c) return; // removed meanwhile
        c.vec = normalize(vecs[k]);
        this.dim = c.vec.length;
      });
    }
  }

  /** Embeds all chunks that have no vector yet (e.g. after setEmbedder). @returns {Promise<number>} number embedded */
  async embedMissing() {
    if (!this.embedder) return 0;
    const ids = [...this.chunks.values()].filter((c) => !c.vec).map((c) => c.id);
    await this._embedChunks(ids);
    return ids.length;
  }

  /** Lists indexed documents. @returns {{id:string,title:string,chunks:number,meta:any}[]} */
  listDocuments() {
    return [...this.docs.values()].map((d) => ({ id: d.id, title: d.title, chunks: d.chunkIds.length, meta: d.meta }));
  }

  /** @param {string} id @returns {boolean} true when the document existed */
  removeDocument(id) {
    const d = this.docs.get(String(id));
    if (!d) return false;
    for (const cid of d.chunkIds) {
      const c = this.chunks.get(cid);
      if (!c) continue;
      for (const t of c.tf.keys()) {
        const p = this.postings.get(t);
        if (p) {
          p.delete(cid);
          if (!p.size) this.postings.delete(t);
        }
      }
      this.totalLen -= c.len;
      this.chunks.delete(cid);
    }
    this.docs.delete(d.id);
    return true;
  }

  _bm25(query) {
    const q = tokenize(query);
    const scores = new Map();
    const N = this.chunks.size;
    if (!N || !q.length) return scores;
    const avg = this.totalLen / N || 1;
    for (const t of new Set(q)) {
      const p = this.postings.get(t);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const [cid, tf] of p) {
        const len = this.chunks.get(cid).len;
        const s = (idf * tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * len) / avg));
        scores.set(cid, (scores.get(cid) || 0) + s);
      }
    }
    return scores;
  }

  _hit(cid, score) {
    const c = this.chunks.get(cid);
    const d = this.docs.get(c.docId);
    return { docId: c.docId, title: d.title, chunkId: cid, text: c.text, score, meta: d.meta };
  }

  /**
   * BM25-only search (synchronous).
   * @param {string} query
   * @param {{k?:number, minScore?:number}} [opts]
   */
  searchSync(query, { k = 6, minScore = 0 } = {}) {
    return [...this._bm25(query)]
      .filter(([, s]) => s > minScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([cid, s]) => this._hit(cid, s));
  }

  /**
   * Searches the index. Without an embedder this is BM25 (scores are BM25 values). With an embedder and vectors it
   * fuses BM25 and cosine rankings via reciprocal rank fusion (scores are RRF values, roughly 0.01-0.03).
   * @param {string} query
   * @param {{k?:number, minScore?:number}} [opts]
   * @returns {Promise<{docId:string,title:string,chunkId:string,text:string,score:number,meta:any}[]>}
   */
  async search(query, { k = 6, minScore = 0 } = {}) {
    const bm = this._bm25(query);
    const hasVecs = this.embedder && this.dim > 0;
    if (!hasVecs) return this.searchSync(query, { k, minScore });
    let qv = null;
    try {
      [qv] = await this.embedder([query]);
    } catch {
      return this.searchSync(query, { k, minScore }); // degrade gracefully
    }
    qv = normalize(qv);
    const dense = [];
    if (qv.length === this.dim) {
      for (const c of this.chunks.values()) {
        if (!c.vec || c.vec.length !== this.dim) continue;
        let s = 0;
        for (let i = 0; i < this.dim; i++) s += c.vec[i] * qv[i];
        dense.push([c.id, s]);
      }
    }
    dense.sort((a, b) => b[1] - a[1]);
    const lex = [...bm].sort((a, b) => b[1] - a[1]);
    const fused = new Map();
    lex.slice(0, 100).forEach(([cid], r) => fused.set(cid, (fused.get(cid) || 0) + 1 / (RRF_K + r + 1)));
    dense
      .filter(([, s]) => s > 0)
      .slice(0, 100)
      .forEach(([cid], r) => fused.set(cid, (fused.get(cid) || 0) + 1 / (RRF_K + r + 1)));
    return [...fused]
      .filter(([, s]) => s > minScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([cid, s]) => this._hit(cid, s));
  }

  /** Index statistics. */
  stats() {
    let vectors = 0;
    for (const c of this.chunks.values()) if (c.vec) vectors++;
    return {
      docs: this.docs.size,
      chunks: this.chunks.size,
      terms: this.postings.size,
      avgChunkLength: this.chunks.size ? this.totalLen / this.chunks.size : 0,
      vectors,
      dim: this.dim,
      hasEmbedder: !!this.embedder,
    };
  }

  /** Serializes the index (vectors as base64 Float32). @returns {object} */
  toJSON() {
    const docs = [];
    for (const d of this.docs.values()) {
      docs.push({
        id: d.id,
        title: d.title,
        meta: d.meta,
        chunks: d.chunkIds.map((cid) => {
          const c = this.chunks.get(cid);
          const o = { text: c.text };
          if (c.vec) o.vec = bytesToBase64(new Uint8Array(c.vec.buffer, c.vec.byteOffset, c.vec.byteLength));
          return o;
        }),
      });
    }
    return { format: "openfini-knowledge", version: 1, k1: this.k1, b: this.b, chunkSize: this.chunkSize, overlap: this.overlap, dim: this.dim, docs };
  }

  /**
   * Restores an index from {@link KnowledgeIndex#toJSON} output (object or JSON string). Chunks are kept as stored.
   * @param {object|string} data
   * @returns {KnowledgeIndex}
   */
  static fromJSON(data) {
    const j = typeof data === "string" ? JSON.parse(data) : data;
    if (!j || j.format !== "openfini-knowledge") throw new Error("Not an OpenFini knowledge index.");
    const idx = new KnowledgeIndex({ k1: j.k1, b: j.b, chunkSize: j.chunkSize, overlap: j.overlap });
    for (const d of j.docs || []) {
      const chunkIds = [];
      const titleTokens = tokenize(d.title || "");
      (d.chunks || []).forEach((ch, i) => {
        const cid = `${d.id}#${i}`;
        const toks = titleTokens.concat(tokenize(ch.text));
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const [t, n] of tf) {
          let p = idx.postings.get(t);
          if (!p) idx.postings.set(t, (p = new Map()));
          p.set(cid, n);
        }
        let vec = null;
        if (ch.vec) {
          const bytes = base64ToBytes(ch.vec);
          vec = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
          idx.dim = vec.length;
        }
        idx.chunks.set(cid, { id: cid, docId: d.id, text: ch.text, len: toks.length, tf, vec });
        idx.totalLen += toks.length;
        chunkIds.push(cid);
      });
      idx.docs.set(d.id, { id: d.id, title: d.title || "", meta: d.meta, chunkIds });
    }
    return idx;
  }
}
