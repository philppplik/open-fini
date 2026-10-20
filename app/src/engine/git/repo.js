// A Git repository whose `.git` folder is a Map<string, Uint8Array> ("HEAD", "objects/ab/cdef…", "refs/heads/main",
// "index", "config", …) — the same layout as a real .git directory, so the data can be exported and used by any Git.
// The working tree is supplied by the caller (see `Worktree` below), which keeps this engine independent of the
// project model and testable in Node. Everything here is synchronous and pure.
import { concat, fromHex, toHex, hashObject, packLoose, unpackLoose, serializeTree, parseTree, serializeCommit, parseCommit, serializeTag, parseTag, sha1, utf8, text, isBinary, formatTz } from "./objects.js";
import { merge3, hasConflictMarkers } from "./diff.js";
import { createIgnore } from "./ignore.js";

/**
 * @typedef {{ paths(): string[], get(path: string): string | Uint8Array | null }} Worktree  file contents (text files as strings)
 * @typedef {{ write(path: string, bytes: Uint8Array): void, remove(path: string): void }} WorktreeWriter
 */

export class GitError extends Error {
  constructor(message, code = "GIT", detail = {}) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.detail = detail;
  }
}

const bytesOf = (c) => (typeof c === "string" ? utf8(c) : c);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Rules of `git check-ref-format` (the parts that matter for branch and tag names). */
export function validRefName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 200 &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) &&
    !name.includes("..") &&
    !name.includes("@{") &&
    !name.includes("//") &&
    !/^[./-]|[./]$|\/\.|\.lock(\/|$)/.test(name) &&
    name !== "@"
  );
}

export function makePerson({ name, email }, date = new Date()) {
  return { name: name || "OpenFini User", email: email || "user@openfini.invalid", ts: Math.floor(date.getTime() / 1000), tz: formatTz(date.getTimezoneOffset()) };
}

export class GitRepo {
  /** @param {Map<string, Uint8Array>} files the `.git` folder @param {{ onChange?: () => void }} [opts] */
  constructor(files = new Map(), { onChange } = {}) {
    this.files = files;
    this.onChange = onChange || null;
    this._cache = new Map();
    this._wtHash = new Map();
    this._indexRef = null;
    this._index = null;
  }

  /** Creates an empty repository (HEAD → refs/heads/<branch>) in `files`. */
  static init(files = new Map(), { branch = "main", onChange } = {}) {
    if (!validRefName(branch)) throw new GitError("That is not a valid branch name.", "BAD_REF");
    const r = new GitRepo(files, { onChange });
    r._set("HEAD", utf8(`ref: refs/heads/${branch}\n`));
    r._set("config", utf8("[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n"));
    r._set("description", utf8("Unnamed repository; created by OpenFini.\n"));
    r._set("info/exclude", utf8("# git ls-files --others --exclude-from=.git/info/exclude\n"));
    r.writeIndex(new Map());
    return r;
  }

  get exists() {
    return this.files.has("HEAD");
  }

  // ------------------------------------------------------------------ raw files

  _get(p) {
    return this.files.get(p) || null;
  }
  _text(p) {
    const b = this.files.get(p);
    return b ? text(b) : null;
  }
  _set(p, bytes) {
    this.files.set(p, bytes);
    this.onChange?.();
  }
  _del(p) {
    if (this.files.delete(p)) this.onChange?.();
  }

  // ------------------------------------------------------------------ objects

  hasObject(oid) {
    return this.files.has(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
  }
  /** @returns {{ type: string, content: Uint8Array }} */
  readObject(oid) {
    let o = this._cache.get(oid);
    if (o) return o;
    const bytes = this.files.get(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    if (!bytes) throw new GitError(`The object ${oid.slice(0, 7)} is missing from this repository.`, "MISSING_OBJECT", { oid });
    o = unpackLoose(bytes);
    if (this._cache.size > 400) this._cache.delete(this._cache.keys().next().value);
    this._cache.set(oid, o);
    return o;
  }
  writeObject(type, content) {
    const oid = hashObject(type, content);
    const path = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
    if (!this.files.has(path)) this._set(path, packLoose(type, content));
    return oid;
  }
  /** Stores an object received from a remote (trusted only after its hash was verified by the caller). */
  writeVerified(oid, type, content) {
    if (hashObject(type, content) !== oid) throw new GitError("A received object did not match its id.", "BAD_OBJECT");
    return this.writeObject(type, content);
  }
  readCommit(oid) {
    const o = this.readObject(oid);
    if (o.type !== "commit") throw new GitError(`${oid.slice(0, 7)} is not a commit.`, "NOT_COMMIT");
    return { oid, ...(o.parsed ||= parseCommit(o.content)) };
  }
  readBlob(oid) {
    const o = this.readObject(oid);
    if (o.type !== "blob") throw new GitError(`${oid.slice(0, 7)} is not a file.`, "NOT_BLOB");
    return o.content;
  }
  treeEntries(oid) {
    const o = this.readObject(oid);
    if (o.type !== "tree") throw new GitError(`${oid.slice(0, 7)} is not a folder.`, "NOT_TREE");
    return (o.parsed ||= parseTree(o.content));
  }
  /** All files of a tree: Map<path, { oid, mode }>. */
  flatten(treeOid, prefix = "", out = new Map()) {
    for (const e of this.treeEntries(treeOid)) {
      const p = prefix + e.name;
      if (e.mode === "40000") this.flatten(e.oid, `${p}/`, out);
      else out.set(p, { oid: e.oid, mode: e.mode });
    }
    return out;
  }
  /** Writes the tree objects for a flat map and returns the root tree id. */
  buildTree(flat) {
    const root = { files: [], dirs: new Map() };
    for (const [p, v] of flat) {
      const parts = p.split("/");
      let node = root;
      for (const d of parts.slice(0, -1)) {
        if (!node.dirs.has(d)) node.dirs.set(d, { files: [], dirs: new Map() });
        node = node.dirs.get(d);
      }
      node.files.push({ mode: v.mode, name: parts[parts.length - 1], oid: v.oid });
    }
    const write = (node) => {
      const entries = [...node.files];
      for (const [name, child] of node.dirs) entries.push({ mode: "40000", name, oid: write(child) });
      return this.writeObject("tree", serializeTree(entries));
    };
    return write(root);
  }
  /** The blob at `path` of a tree, or null. */
  lookup(treeOid, path) {
    let oid = treeOid;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const e = this.treeEntries(oid).find((x) => x.name === parts[i]);
      if (!e) return null;
      if (i === parts.length - 1) return e.mode === "40000" ? null : e;
      if (e.mode !== "40000") return null;
      oid = e.oid;
    }
    return null;
  }

  // ------------------------------------------------------------------ refs

  _packedRefs() {
    const t = this._text("packed-refs");
    const m = new Map();
    if (!t) return m;
    for (const line of t.split("\n")) {
      if (!line || line[0] === "#" || line[0] === "^") continue;
      const sp = line.indexOf(" ");
      if (sp === 40) m.set(line.slice(41), line.slice(0, 40));
    }
    return m;
  }
  readRef(name) {
    const loose = this._text(name);
    if (loose != null) {
      const v = loose.trim();
      if (/^[0-9a-f]{40}$/.test(v)) return v;
      if (v.startsWith("ref: ")) return this.readRef(v.slice(5));
    }
    return this._packedRefs().get(name) || null;
  }
  writeRef(name, oid) {
    if (!name.startsWith("refs/") || !validRefName(name.slice(5))) throw new GitError(`“${name}” is not a valid reference name.`, "BAD_REF");
    if (!/^[0-9a-f]{40}$/.test(oid)) throw new GitError("Invalid object id.", "BAD_OID");
    this._set(name, utf8(`${oid}\n`));
  }
  deleteRef(name) {
    this._del(name);
    const packed = this._text("packed-refs");
    if (packed && packed.includes(` ${name}\n`)) {
      this._set("packed-refs", utf8(packed.split("\n").filter((l) => !l.endsWith(` ${name}`)).join("\n")));
    }
  }
  /** Map<fullName, oid> of all references below a prefix, loose and packed. */
  refs(prefix = "refs/") {
    const out = new Map();
    for (const [k, v] of this._packedRefs()) if (k.startsWith(prefix)) out.set(k, v);
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix) && !k.endsWith(".lock")) {
        const oid = this.readRef(k);
        if (oid) out.set(k, oid);
      }
    }
    return out;
  }
  /** @returns {{ branch: string | null, oid: string | null }} */
  head() {
    const t = (this._text("HEAD") || "").trim();
    if (t.startsWith("ref: refs/heads/")) {
      const branch = t.slice("ref: refs/heads/".length);
      return { branch, oid: this.readRef(`refs/heads/${branch}`) };
    }
    return { branch: null, oid: /^[0-9a-f]{40}$/.test(t) ? t : null };
  }
  _moveHead(oid) {
    const { branch } = this.head();
    if (branch) this.writeRef(`refs/heads/${branch}`, oid);
    else this._set("HEAD", utf8(`${oid}\n`));
  }

  /** Resolves a revision: HEAD, branch, tag, remote branch, full or short id, with ~n and ^ suffixes. Returns a commit id or null. */
  resolve(rev, { peel = true } = {}) {
    const m = /^([^~^]+)((?:[~^]\d*)*)$/.exec(String(rev || "").trim());
    if (!m) return null;
    const base = m[1];
    let oid = null;
    if (base === "HEAD") oid = this.head().oid;
    else if (/^[0-9a-f]{40}$/.test(base)) oid = this.hasObject(base) ? base : null;
    else {
      for (const p of [`refs/heads/${base}`, `refs/tags/${base}`, `refs/remotes/${base}`, `refs/${base}`, base.startsWith("refs/") ? base : null]) {
        if (p && (oid = this.readRef(p))) break;
      }
      if (!oid && /^[0-9a-f]{4,39}$/.test(base)) {
        const hits = [...this.files.keys()].filter((k) => k.startsWith(`objects/${base.slice(0, 2)}/`) && (k.slice(8, 10) + k.slice(11)).startsWith(base));
        if (hits.length === 1) oid = hits[0].slice(8, 10) + hits[0].slice(11);
      }
    }
    if (!oid) return null;
    if (peel) {
      for (let i = 0; i < 5; i++) {
        const o = this.readObject(oid);
        if (o.type !== "tag") break;
        oid = parseTag(o.content).object;
      }
    }
    for (const [, op, n] of m[2].matchAll(/([~^])(\d*)/g)) {
      const count = n === "" ? 1 : Number(n);
      if (op === "~") for (let i = 0; i < count && oid; i++) oid = this.readCommit(oid).parents[0] || null;
      else if (count > 0) oid = this.readCommit(oid).parents[count - 1] || null;
    }
    return oid;
  }

  // ------------------------------------------------------------------ config (remotes)

  config() {
    const out = {};
    let section = null;
    for (const raw of (this._text("config") || "").split("\n")) {
      const line = raw.trim();
      const sec = /^\[(.+)\]$/.exec(line);
      if (sec) {
        const m = /^(\S+)\s+"(.*)"$/.exec(sec[1]);
        section = m ? `${m[1]}.${m[2]}` : sec[1];
        out[section] ||= {};
      } else if (section && line && line[0] !== "#" && line[0] !== ";") {
        const eq = line.indexOf("=");
        if (eq > 0) out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return out;
  }
  setConfig(cfg) {
    let s = "";
    for (const [section, kv] of Object.entries(cfg)) {
      const dot = section.indexOf(".");
      s += dot < 0 ? `[${section}]\n` : `[${section.slice(0, dot)} "${section.slice(dot + 1)}"]\n`;
      for (const [k, v] of Object.entries(kv)) s += `\t${k} = ${v}\n`;
    }
    this._set("config", utf8(s));
  }
  remotes() {
    const out = [];
    for (const [k, v] of Object.entries(this.config())) if (k.startsWith("remote.") && v.url) out.push({ name: k.slice(7), url: v.url });
    return out;
  }
  setRemote(name, url) {
    if (!/^[\w.-]+$/.test(name)) throw new GitError("That is not a valid remote name.", "BAD_REMOTE");
    const cfg = this.config();
    if (url) cfg[`remote.${name}`] = { url, fetch: `+refs/heads/*:refs/remotes/${name}/*` };
    else delete cfg[`remote.${name}`];
    this.setConfig(cfg);
  }

  // ------------------------------------------------------------------ index (real DIRC v2 file)

  /** @returns {Map<string, { oid: string, mode: string, size: number }>} */
  readIndex() {
    const bytes = this._get("index");
    if (this._index && this._indexRef === bytes) return this._index;
    let map;
    try {
      map = bytes ? parseIndex(bytes) : new Map();
    } catch {
      map = this._indexFromHead(); // unreadable (for example a v4 index written by another Git): rebuild from HEAD
    }
    this._index = map;
    this._indexRef = bytes;
    return map;
  }
  _indexFromHead() {
    const map = new Map();
    const h = this.head().oid;
    if (h) for (const [p, v] of this.flatten(this.readCommit(h).tree)) map.set(p, { ...v, size: this.readBlob(v.oid).length });
    return map;
  }
  writeIndex(map) {
    const bytes = serializeIndex(map);
    this._set("index", bytes);
    this._index = map;
    this._indexRef = bytes;
  }

  // ------------------------------------------------------------------ history

  headFlat() {
    const h = this.head().oid;
    return h ? this.flatten(this.readCommit(h).tree) : new Map();
  }

  /** Commits reachable from `from` (revision or id), newest first. Options: limit, skip, path (only commits touching it). */
  log({ from = "HEAD", limit = 200, skip = 0, path = null, all = false } = {}) {
    const starts = [];
    if (all) {
      for (const oid of this.refs("refs/").values()) starts.push(this._peelCommit(oid));
      const h = this.head().oid;
      if (h) starts.push(h);
    } else {
      const s = Array.isArray(from) ? from : [from];
      for (const r of s) {
        const oid = this.resolve(r);
        if (oid) starts.push(oid);
      }
    }
    const seen = new Set();
    const queue = [];
    const push = (oid) => {
      if (!oid || seen.has(oid)) return;
      seen.add(oid);
      const c = this.readCommit(oid);
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (queue[mid].committer.ts > c.committer.ts) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, c);
    };
    for (const s of [...new Set(starts)].filter(Boolean)) push(s);
    const out = [];
    let skipped = 0;
    while (queue.length && out.length < limit) {
      const c = queue.shift();
      for (const p of c.parents) push(p);
      if (path) {
        const here = this.lookup(c.tree, path)?.oid ?? null;
        const parent = c.parents[0] ? this.lookup(this.readCommit(c.parents[0]).tree, path)?.oid ?? null : null;
        if (here === parent && c.parents.length < 2) continue;
      }
      if (skipped < skip) {
        skipped++;
        continue;
      }
      out.push(c);
    }
    return out;
  }
  _peelCommit(oid) {
    for (let i = 0; i < 5; i++) {
      const o = this.readObject(oid);
      if (o.type === "commit") return oid;
      if (o.type !== "tag") return null;
      oid = parseTag(o.content).object;
    }
    return null;
  }
  ancestors(oid) {
    const set = new Set();
    const stack = [oid];
    while (stack.length) {
      const o = stack.pop();
      if (!o || set.has(o) || !this.hasObject(o)) continue;
      set.add(o);
      stack.push(...this.readCommit(o).parents);
    }
    return set;
  }
  isAncestor(a, b) {
    return this.ancestors(b).has(a);
  }
  mergeBase(a, b) {
    const anc = this.ancestors(a);
    if (anc.has(b)) return b;
    const seen = new Set();
    const queue = [b];
    while (queue.length) {
      queue.sort((x, y) => this.readCommit(y).committer.ts - this.readCommit(x).committer.ts);
      const o = queue.shift();
      if (seen.has(o)) continue;
      seen.add(o);
      if (anc.has(o)) return o;
      queue.push(...this.readCommit(o).parents);
    }
    return null;
  }
  /** Commits only in `a` and only in `b`: { ahead, behind } of a relative to b. */
  aheadBehind(a, b) {
    const A = this.ancestors(a);
    const B = this.ancestors(b);
    let ahead = 0;
    let behind = 0;
    for (const o of A) if (!B.has(o)) ahead++;
    for (const o of B) if (!A.has(o)) behind++;
    return { ahead, behind };
  }

  // ------------------------------------------------------------------ branches and tags

  branches() {
    const cur = this.head();
    return [...this.refs("refs/heads/")].map(([n, oid]) => ({ name: n.slice(11), oid, current: n.slice(11) === cur.branch })).sort((a, b) => a.name.localeCompare(b.name));
  }
  remoteBranches() {
    return [...this.refs("refs/remotes/")].map(([n, oid]) => ({ name: n.slice(13), oid })).sort((a, b) => a.name.localeCompare(b.name));
  }
  createBranch(name, oid = this.head().oid) {
    if (!validRefName(name)) throw new GitError(`“${name}” is not a valid branch name.`, "BAD_REF");
    if (this.readRef(`refs/heads/${name}`)) throw new GitError(`A branch named “${name}” already exists.`, "EXISTS");
    if (!oid) throw new GitError("Make a first commit before creating branches.", "NO_COMMITS");
    this.writeRef(`refs/heads/${name}`, oid);
  }
  deleteBranch(name, { force = false } = {}) {
    const cur = this.head();
    if (cur.branch === name) throw new GitError("You cannot delete the branch you are on. Switch to another branch first.", "CURRENT_BRANCH");
    const oid = this.readRef(`refs/heads/${name}`);
    if (!oid) throw new GitError(`There is no branch “${name}”.`, "NO_BRANCH");
    if (!force && cur.oid && !this.isAncestor(oid, cur.oid)) throw new GitError(`“${name}” has commits that are not merged into the current branch.`, "UNMERGED", { name });
    this.deleteRef(`refs/heads/${name}`);
  }
  renameBranch(from, to) {
    if (!validRefName(to)) throw new GitError(`“${to}” is not a valid branch name.`, "BAD_REF");
    const oid = this.readRef(`refs/heads/${from}`);
    if (!oid) throw new GitError(`There is no branch “${from}”.`, "NO_BRANCH");
    if (this.readRef(`refs/heads/${to}`)) throw new GitError(`A branch named “${to}” already exists.`, "EXISTS");
    this.writeRef(`refs/heads/${to}`, oid);
    this.deleteRef(`refs/heads/${from}`);
    if (this.head().branch === from) this._set("HEAD", utf8(`ref: refs/heads/${to}\n`));
  }
  tags() {
    return [...this.refs("refs/tags/")]
      .map(([n, oid]) => {
        const o = this.readObject(oid);
        if (o.type === "tag") {
          const t = parseTag(o.content);
          return { name: n.slice(10), oid, target: t.object, annotated: true, message: t.message.trim() };
        }
        return { name: n.slice(10), oid, target: oid, annotated: false, message: "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  }
  createTag(name, { oid = this.head().oid, message = "", tagger } = {}) {
    if (!validRefName(name)) throw new GitError(`“${name}” is not a valid tag name.`, "BAD_REF");
    if (this.readRef(`refs/tags/${name}`)) throw new GitError(`A tag named “${name}” already exists.`, "EXISTS");
    if (!oid) throw new GitError("Make a first commit before tagging.", "NO_COMMITS");
    const ref = message ? this.writeObject("tag", serializeTag({ object: oid, tag: name, tagger: tagger || makePerson({}), message })) : oid;
    this.writeRef(`refs/tags/${name}`, ref);
    return ref;
  }
  deleteTag(name) {
    if (!this.readRef(`refs/tags/${name}`)) throw new GitError(`There is no tag “${name}”.`, "NO_TAG");
    this.deleteRef(`refs/tags/${name}`);
  }

  // ------------------------------------------------------------------ working tree: status, staging

  _hashOf(path, content) {
    const c = this._wtHash.get(path);
    if (c && (c.key === content || (typeof content === "string" && c.key === content))) return c;
    const bytes = bytesOf(content);
    const rec = { key: content, oid: hashObject("blob", bytes), size: bytes.length };
    if (this._wtHash.size > 5000) this._wtHash.clear();
    this._wtHash.set(path, rec);
    return rec;
  }

  mergeState() {
    const head = this._text("MERGE_HEAD")?.trim() || null;
    if (!head) return null;
    let conflicts = [];
    try {
      conflicts = JSON.parse(this._text("openfini-conflicts") || "[]");
    } catch {
      /* ignore */
    }
    return { head, message: this._text("MERGE_MSG") || "", conflicts };
  }
  _clearMerge() {
    for (const f of ["MERGE_HEAD", "MERGE_MSG", "openfini-conflicts"]) this._del(f);
  }

  /**
   * Compares HEAD, the index and the working tree.
   * @param {Worktree} wt
   * @returns {{ branch: string | null, head: string | null, merging: object | null, changes: { path: string, staged: "A"|"M"|"D"|null, unstaged: "M"|"D"|"U"|null, conflict: boolean }[] }}
   */
  status(wt, { ignore } = {}) {
    const headFlat = this.headFlat();
    const index = this.readIndex();
    const wtPaths = wt.paths();
    const ig = ignore || createIgnore((p) => (p.startsWith(".git/") ? this._text(p.slice(5)) : typeof wt.get(p) === "string" ? wt.get(p) : null), wtPaths);
    const merge = this.mergeState();
    const conflicts = new Set(merge?.conflicts || []);
    const all = new Set([...headFlat.keys(), ...index.keys()]);
    const present = new Set(wtPaths);
    for (const p of wtPaths) if (all.has(p) || !ig(p)) all.add(p);
    const changes = [];
    for (const path of [...all].sort()) {
      const h = headFlat.get(path);
      const i = index.get(path);
      const content = present.has(path) ? wt.get(path) : null;
      const w = content == null ? null : this._hashOf(path, content).oid;
      const staged = !h && i ? "A" : h && !i ? "D" : h && i && h.oid !== i.oid ? "M" : null;
      let unstaged = null;
      if (i) unstaged = w == null ? "D" : w !== i.oid ? "M" : null;
      else if (w != null) unstaged = "U";
      if (staged || unstaged) changes.push({ path, staged, unstaged, conflict: conflicts.has(path) });
    }
    const hd = this.head();
    return { branch: hd.branch, head: hd.oid, merging: merge, changes };
  }

  /** Stages the working-tree state of `paths` (a deleted file stages its deletion). */
  stage(wt, paths) {
    const index = new Map(this.readIndex());
    const conflicts = this.mergeState()?.conflicts;
    for (const path of paths) {
      const c = wt.get(path);
      if (c == null) index.delete(path);
      else {
        const bytes = bytesOf(c);
        if (typeof c === "string" && hasConflictMarkers(c) && conflicts?.includes(path)) throw new GitError(`“${path}” still contains conflict markers. Resolve them first, or stage anyway after removing the markers.`, "CONFLICT_MARKERS", { path });
        const oid = this.writeObject("blob", bytes);
        index.set(path, { oid, mode: "100644", size: bytes.length });
      }
    }
    this.writeIndex(index);
    if (conflicts?.length) {
      const left = conflicts.filter((p) => !paths.includes(p));
      this._set("openfini-conflicts", utf8(JSON.stringify(left)));
    }
  }
  /** Resets the index entries of `paths` to HEAD (the working tree is not touched). */
  unstage(paths) {
    const index = new Map(this.readIndex());
    const head = this.headFlat();
    for (const path of paths) {
      const h = head.get(path);
      if (h) index.set(path, { ...h, size: this.readBlob(h.oid).length });
      else index.delete(path);
    }
    this.writeIndex(index);
  }
  /** Restores `paths` in the working tree from the index; untracked files are deleted. @param {WorktreeWriter} io */
  discard(wt, io, paths) {
    const index = this.readIndex();
    for (const path of paths) {
      const e = index.get(path);
      if (e) io.write(path, this.readBlob(e.oid));
      else io.remove(path);
    }
  }

  // ------------------------------------------------------------------ commit

  /**
   * Commits the index. Throws when there is nothing to commit.
   * @param {{ message: string, author: { name: string, email: string }, committer?: object, date?: Date, allowEmpty?: boolean }} o
   */
  commit({ message, author, committer, date = new Date(), allowEmpty = false }) {
    message = String(message || "").trim();
    if (!message) throw new GitError("Enter a commit message.", "NO_MESSAGE");
    const merge = this.mergeState();
    if (merge?.conflicts.length) throw new GitError("Resolve the merge conflicts and stage the files before committing.", "CONFLICTS", { paths: merge.conflicts });
    const index = this.readIndex();
    const tree = this.buildTree(index);
    const head = this.head().oid;
    const parents = head ? [head] : [];
    if (merge) parents.push(merge.head);
    if (!allowEmpty && !merge && head && this.readCommit(head).tree === tree) throw new GitError("There is nothing to commit. Stage some changes first.", "NOTHING_TO_COMMIT");
    if (!allowEmpty && !merge && !head && index.size === 0) throw new GitError("There is nothing to commit. Stage some files first.", "NOTHING_TO_COMMIT");
    const a = makePerson(author, date);
    const oid = this.writeObject("commit", serializeCommit({ tree, parents, author: a, committer: committer ? { ...a, ...committer } : a, message }));
    this._moveHead(oid);
    this._clearMerge();
    return oid;
  }

  // ------------------------------------------------------------------ switching, merging, restoring

  /** Paths whose content differs between two flat trees: [{ path, status: "A"|"M"|"D" }] */
  diffFlat(a, b) {
    const out = [];
    for (const [p, v] of b) {
      const o = a.get(p);
      if (!o) out.push({ path: p, status: "A", oldOid: null, newOid: v.oid });
      else if (o.oid !== v.oid || o.mode !== v.mode) out.push({ path: p, status: "M", oldOid: o.oid, newOid: v.oid });
    }
    for (const [p, v] of a) if (!b.has(p)) out.push({ path: p, status: "D", oldOid: v.oid, newOid: null });
    return out.sort((x, y) => x.path.localeCompare(y.path));
  }
  /** Files changed by a commit compared with its first parent. */
  commitChanges(oid) {
    const c = this.readCommit(oid);
    const before = c.parents[0] ? this.flatten(this.readCommit(c.parents[0]).tree) : new Map();
    return this.diffFlat(before, this.flatten(c.tree));
  }

  /**
   * Switches to a branch (or a commit, detached) and updates the working tree.
   * Refuses when uncommitted changes touch files that differ between the two states, unless `force`.
   * @param {string} target branch name, tag or commit id
   * @param {Worktree} wt @param {WorktreeWriter} io
   */
  checkout(target, wt, io, { force = false } = {}) {
    const branchOid = this.readRef(`refs/heads/${target}`);
    const oid = branchOid || this.resolve(target);
    if (!oid) throw new GitError(`“${target}” is not a branch, tag or commit.`, "NO_REV");
    const newFlat = this.flatten(this.readCommit(oid).tree);
    this._applyTree(newFlat, wt, io, { force });
    if (branchOid) this._set("HEAD", utf8(`ref: refs/heads/${target}\n`));
    else this._set("HEAD", utf8(`${oid}\n`));
    this._clearMerge();
    return { oid, branch: branchOid ? target : null };
  }

  _applyTree(newFlat, wt, io, { force }) {
    const curFlat = this.headFlat();
    const diff = this.diffFlat(curFlat, newFlat);
    const touched = new Set(diff.map((d) => d.path));
    const st = this.status(wt);
    if (!force) {
      const blockers = st.changes.filter((c) => (touched.has(c.path) && (c.staged || c.unstaged !== "U")) || (c.unstaged === "U" && newFlat.has(c.path) && !curFlat.has(c.path)));
      if (blockers.length) throw new GitError(`Uncommitted changes in ${blockers.length === 1 ? `“${blockers[0].path}”` : `${blockers.length} files`} would be overwritten. Commit, discard or stash them first.`, "DIRTY", { paths: blockers.map((b) => b.path) });
    }
    const index = new Map(this.readIndex());
    if (force) {
      for (const c of st.changes) if (c.unstaged !== "U" || newFlat.has(c.path)) touched.add(c.path);
      index.clear();
    }
    for (const p of touched) {
      const v = newFlat.get(p);
      if (v) {
        const bytes = this.readBlob(v.oid);
        io.write(p, bytes);
        index.set(p, { ...v, size: bytes.length });
      } else {
        io.remove(p);
        index.delete(p);
      }
    }
    if (force) for (const [p, v] of newFlat) if (!index.has(p)) index.set(p, { ...v, size: this.readBlob(v.oid).length });
    this.writeIndex(index);
  }

  /** Creates a branch at `from` (default HEAD) and switches to it. */
  checkoutNewBranch(name, wt, io, from = "HEAD") {
    const oid = this.resolve(from);
    if (!oid) throw new GitError("Make a first commit before creating branches.", "NO_COMMITS");
    this.createBranch(name, oid);
    this._set("HEAD", utf8(`ref: refs/heads/${name}\n`));
    return { oid, branch: name };
  }

  /**
   * Merges `theirs` (branch, tag or id) into the current branch.
   * @returns {{ result: "up-to-date" | "fast-forward" | "merged" | "conflict", oid?: string, conflicts?: string[] }}
   */
  merge(theirs, wt, io, { author, message, date = new Date() } = {}) {
    const toOid = this.resolve(theirs);
    if (!toOid) throw new GitError(`“${theirs}” is not a branch, tag or commit.`, "NO_REV");
    const cur = this.head();
    if (this.mergeState()) throw new GitError("A merge is already in progress. Finish or abort it first.", "MERGING");
    if (!cur.oid) {
      this.checkout(theirs, wt, io);
      return { result: "fast-forward", oid: toOid };
    }
    if (cur.oid === toOid || this.isAncestor(toOid, cur.oid)) return { result: "up-to-date", oid: cur.oid };
    if (this.isAncestor(cur.oid, toOid)) {
      this._applyTree(this.flatten(this.readCommit(toOid).tree), wt, io, { force: false });
      this._moveHead(toOid);
      return { result: "fast-forward", oid: toOid };
    }
    const st = this.status(wt);
    const dirty = st.changes.filter((c) => c.staged || c.unstaged !== "U");
    if (dirty.length) throw new GitError("Commit or discard your uncommitted changes before merging.", "DIRTY", { paths: dirty.map((d) => d.path) });
    const baseOid = this.mergeBase(cur.oid, toOid);
    const B = baseOid ? this.flatten(this.readCommit(baseOid).tree) : new Map();
    const O = this.headFlat();
    const T = this.flatten(this.readCommit(toOid).tree);
    const index = new Map(this.readIndex());
    const conflicts = [];
    const oursName = cur.branch || "HEAD";
    const theirName = /^[0-9a-f]{40}$/.test(theirs) ? theirs.slice(0, 7) : theirs;
    const sizeOf = (v) => this.readBlob(v.oid).length;
    for (const p of new Set([...B.keys(), ...O.keys(), ...T.keys()])) {
      const b = B.get(p);
      const o = O.get(p);
      const t = T.get(p);
      if (o?.oid === t?.oid) continue;
      if (b?.oid === o?.oid) {
        // only theirs changed
        if (t) {
          const bytes = this.readBlob(t.oid);
          io.write(p, bytes);
          index.set(p, { ...t, size: bytes.length });
        } else {
          io.remove(p);
          index.delete(p);
        }
        continue;
      }
      if (b?.oid === t?.oid) continue; // only ours changed
      // both sides changed the same file differently
      if (o && t) {
        const ob = this.readBlob(o.oid);
        const tb = this.readBlob(t.oid);
        const bb = b ? this.readBlob(b.oid) : new Uint8Array(0);
        if (!isBinary(ob) && !isBinary(tb) && !isBinary(bb)) {
          const r = merge3(text(bb), text(ob), text(tb), { oursLabel: oursName, theirsLabel: theirName });
          const bytes = utf8(r.text);
          io.write(p, bytes);
          if (r.clean) index.set(p, { oid: this.writeObject("blob", bytes), mode: "100644", size: bytes.length });
          else conflicts.push(p);
          continue;
        }
        conflicts.push(p); // binary on both sides: keep ours
        continue;
      }
      // modified on one side, deleted on the other: keep the modified file and flag it
      const keep = o || t;
      const bytes = this.readBlob(keep.oid);
      io.write(p, bytes);
      if (t && !o) index.delete(p);
      conflicts.push(p);
    }
    this.writeIndex(index);
    const msg = message || `Merge ${/^[0-9a-f]{40}$/.test(theirs) ? "commit" : "branch"} '${theirName}'${cur.branch && cur.branch !== "main" && cur.branch !== "master" ? ` into ${cur.branch}` : ""}`;
    if (conflicts.length) {
      this._set("MERGE_HEAD", utf8(`${toOid}\n`));
      this._set("MERGE_MSG", utf8(`${msg}\n\n# Conflicts:\n${conflicts.map((c) => `#\t${c}`).join("\n")}\n`));
      this._set("openfini-conflicts", utf8(JSON.stringify(conflicts)));
      return { result: "conflict", conflicts, oid: toOid };
    }
    this._set("MERGE_HEAD", utf8(`${toOid}\n`));
    const oid = this.commit({ message: msg, author: author || {}, date });
    return { result: "merged", oid };
  }

  /** Abandons a merge: restores HEAD in the working tree and index. */
  abortMerge(wt, io) {
    if (!this.mergeState()) throw new GitError("There is no merge in progress.", "NOT_MERGING");
    const flat = this.headFlat();
    const st = this.status(wt);
    for (const c of st.changes) if (c.unstaged !== "U" || flat.has(c.path)) (flat.get(c.path) ? io.write(c.path, this.readBlob(flat.get(c.path).oid)) : io.remove(c.path));
    const index = new Map();
    for (const [p, v] of flat) index.set(p, { ...v, size: this.readBlob(v.oid).length });
    this.writeIndex(index);
    this._clearMerge();
  }

  /** Writes the file `path` as it was at `rev` into the working tree (and the index with `stage`). */
  restoreFile(path, rev, wt, io, { stage = false } = {}) {
    const oid = this.resolve(rev);
    if (!oid) throw new GitError(`“${rev}” is not a commit.`, "NO_REV");
    const e = this.lookup(this.readCommit(oid).tree, path);
    if (!e) throw new GitError(`“${path}” does not exist in ${oid.slice(0, 7)}.`, "NO_FILE");
    const bytes = this.readBlob(e.oid);
    io.write(path, bytes);
    if (stage) this.stage({ paths: () => [path], get: () => bytes }, [path]);
    return bytes;
  }

  /** Moves the current branch (or HEAD) to `rev`; mode "mixed" keeps the working tree, "hard" resets it. */
  reset(rev, wt, io, { hard = false } = {}) {
    const oid = this.resolve(rev);
    if (!oid) throw new GitError(`“${rev}” is not a commit.`, "NO_REV");
    const flat = this.flatten(this.readCommit(oid).tree);
    if (hard) {
      const cur = this.headFlat();
      for (const d of this.diffFlat(cur, flat)) d.status === "D" ? io.remove(d.path) : io.write(d.path, this.readBlob(d.newOid));
      for (const c of this.status(wt).changes) if (c.unstaged === "M" || c.unstaged === "D") flat.get(c.path) && io.write(c.path, this.readBlob(flat.get(c.path).oid));
    }
    const index = new Map();
    for (const [p, v] of flat) index.set(p, { ...v, size: this.readBlob(v.oid).length });
    this.writeIndex(index);
    this._moveHead(oid);
    this._clearMerge();
    return oid;
  }

  // ------------------------------------------------------------------ transfer helpers

  /**
   * Objects a remote needs to receive `oid`, given commits it already has: [{ oid, type, content }].
   * Over-sending is harmless; objects of unknown commits are never skipped.
   */
  objectsToSend(oid, haveOids = []) {
    const known = new Set();
    for (const h of haveOids) for (const a of this.ancestors(h)) known.add(a);
    const toSend = [];
    const seen = new Set();
    const stack = [oid];
    while (stack.length) {
      const c = stack.pop();
      if (!c || seen.has(c) || known.has(c)) continue;
      seen.add(c);
      toSend.push(c);
      stack.push(...this.readCommit(c).parents);
    }
    const haveObjs = new Set();
    const addTreeObjs = (treeOid, into) => {
      into.add(treeOid);
      for (const e of this.treeEntries(treeOid)) {
        if (e.mode === "40000") addTreeObjs(e.oid, into);
        else if (e.mode !== "160000") into.add(e.oid);
      }
    };
    for (const c of toSend) for (const p of this.readCommit(c).parents) if (known.has(p)) addTreeObjs(this.readCommit(p).tree, haveObjs);
    const out = [];
    const emitted = new Set();
    const emit = (id) => {
      if (emitted.has(id) || haveObjs.has(id)) return;
      emitted.add(id);
      const o = this.readObject(id);
      out.push({ oid: id, type: o.type, content: o.content });
      if (o.type === "tree") for (const e of this.treeEntries(id)) if (e.mode !== "160000") emit(e.oid);
    };
    for (const c of [...toSend].reverse()) {
      emit(c);
      emit(this.readCommit(c).tree);
    }
    return out;
  }

  /** Copies the `.git` data to a plain object { "HEAD": bytes, … } (entries of the `.ofini` archive). */
  snapshot() {
    return new Map(this.files);
  }
}

// ------------------------------------------------------------------ index file

export function serializeIndex(map) {
  const entries = [...map].map(([path, v]) => ({ path, nameBytes: utf8(path), ...v })).sort((a, b) => {
    const n = Math.min(a.nameBytes.length, b.nameBytes.length);
    for (let i = 0; i < n; i++) if (a.nameBytes[i] !== b.nameBytes[i]) return a.nameBytes[i] - b.nameBytes[i];
    return a.nameBytes.length - b.nameBytes.length;
  });
  const parts = [];
  const head = new Uint8Array(12);
  head.set([0x44, 0x49, 0x52, 0x43]);
  const hv = new DataView(head.buffer);
  hv.setUint32(4, 2);
  hv.setUint32(8, entries.length);
  parts.push(head);
  for (const e of entries) {
    const len = 62 + e.nameBytes.length;
    const padded = Math.ceil((len + 1) / 8) * 8;
    const b = new Uint8Array(padded);
    const dv = new DataView(b.buffer);
    dv.setUint32(24, parseInt(e.mode, 8)); // mode
    dv.setUint32(36, Math.min(e.size || 0, 0xffffffff)); // size
    b.set(fromHex(e.oid), 40);
    dv.setUint16(60, Math.min(e.nameBytes.length, 0xfff));
    b.set(e.nameBytes, 62);
    parts.push(b);
  }
  const body = concat(...parts);
  return concat(body, sha1(body));
}

export function parseIndex(bytes) {
  if (bytes.length < 32 || toHex(bytes.subarray(0, 4)) !== "44495243") throw new Error("Not a Git index.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4);
  if (version !== 2 && version !== 3) throw new Error("Unsupported index version.");
  const count = dv.getUint32(8);
  const map = new Map();
  let p = 12;
  for (let i = 0; i < count; i++) {
    const start = p;
    const mode = dv.getUint32(p + 24).toString(8);
    const size = dv.getUint32(p + 36);
    const oid = toHex(bytes.subarray(p + 40, p + 60));
    const flags = dv.getUint16(p + 60);
    p += 62;
    if (version === 3 && flags & 0x4000) p += 2;
    let end = bytes.indexOf(0, p);
    if (end < 0) throw new Error("Corrupt index.");
    const path = text(bytes.subarray(p, end));
    p = start + Math.ceil((end - start + 1) / 8) * 8;
    const stage = (flags >> 12) & 3;
    if (stage === 0) map.set(path, { oid, mode, size });
  }
  return map;
}
