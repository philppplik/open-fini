// Git for a website project, as one service object used by the Source Control panel, the Explorer decorations, the
// editor change markers and the Vibe tools. No DOM. The engine (app/src/engine/git) is loaded on first use; the
// repository's `.git` data is `web.gitFiles` and is saved inside the document (web/git/… entries).
import { Emitter, debounce } from "../../core/util.js";

const services = new WeakMap();
export function gitServiceFor(app, web) {
  let s = services.get(web);
  if (!s) services.set(web, (s = new GitService(app, web)));
  return s;
}

const STATUS_LABEL = { A: "Added", M: "Modified", D: "Deleted", U: "Untracked" };
export const statusLabel = (c) => STATUS_LABEL[c] || c;

export class GitService extends Emitter {
  constructor(app, web) {
    super();
    this.app = app;
    this.web = web;
    this.G = null;
    this.repo = null;
    this._status = null;
    this.refreshSoon = debounce(() => this.refresh(), 350);
    const touch = () => this.exists && this.refreshSoon();
    web.on("text", touch);
    web.on("tree", touch);
  }

  get exists() {
    return !!this.web.gitFiles;
  }
  get author() {
    return { name: this.app.prefs.gitName || "OpenFini User", email: this.app.prefs.gitEmail || "user@openfini.invalid" };
  }

  async ready() {
    this.G ||= await import("../../engine/git/index.js");
    if (this.exists && (!this.repo || this.repo.files !== this.web.gitFiles)) this.repo = new this.G.GitRepo(this.web.gitFiles, { onChange: () => this.web._dirtySoon() });
    return this;
  }
  async need() {
    await this.ready();
    if (!this.repo) throw new Error("This project has no Git repository yet. Initialize one in Source Control first.");
    return this.repo;
  }

  get wt() {
    const web = this.web;
    return {
      paths: () => [...web.files.keys()],
      get: (p) => {
        const f = web.files.get(p);
        return f ? (typeof f.text === "string" ? f.text : f.bytes) : null;
      },
    };
  }
  get io() {
    const web = this.web;
    return { write: (p, b) => void web.put(p, b), remove: (p) => void web.remove(p) };
  }

  // ------------------------------------------------------------------ state

  async init({ branch = "main" } = {}) {
    await this.ready();
    if (this.exists) throw new Error("This project already has a Git repository.");
    this.web.gitFiles = new Map();
    this.repo = this.G.GitRepo.init(this.web.gitFiles, { branch, onChange: () => this.web._dirtySoon() });
    this.web._dirtySoon();
    await this.refresh();
    return this.repo;
  }

  /** Recomputes the status; emits "change". */
  async refresh() {
    if (!this.exists) {
      this._status = null;
      this.emit("change", null);
      return null;
    }
    await this.ready();
    const st = this.repo.status(this.wt);
    const up = st.branch ? this.repo.readRef(`refs/remotes/origin/${st.branch}`) : null;
    st.upstream = up && st.head ? { oid: up, ...this.repo.aheadBehind(st.head, up) } : null;
    this._status = st;
    this._byPath = new Map(st.changes.map((c) => [c.path, c]));
    this.emit("change", st);
    return st;
  }
  get status() {
    return this._status;
  }
  /** Explorer decoration: { letter, kind, title } or null. Synchronous, from the last refresh. */
  decoration(path) {
    const c = this._byPath?.get(path);
    if (!c) return null;
    if (c.conflict) return { letter: "!", kind: "conflict", title: "Merge conflict" };
    if (c.unstaged === "U") return { letter: "U", kind: "untracked", title: "Untracked" };
    const code = c.unstaged || c.staged;
    return { letter: code, kind: code === "A" ? "added" : code === "D" ? "deleted" : "modified", title: `${c.staged ? "Staged: " : ""}${statusLabel(code)}` };
  }
  folderDecorated(dir) {
    if (!this._byPath) return false;
    for (const p of this._byPath.keys()) if (p.startsWith(`${dir}/`)) return true;
    return false;
  }

  // ------------------------------------------------------------------ staging and committing

  async stage(paths) {
    const r = await this.need();
    const st = r.status(this.wt);
    const list = paths === "all" ? st.changes.map((c) => c.path) : paths;
    r.stage(this.wt, list);
    await this.refresh();
  }
  async unstage(paths) {
    const r = await this.need();
    const st = r.status(this.wt);
    r.unstage(paths === "all" ? st.changes.filter((c) => c.staged).map((c) => c.path) : paths);
    await this.refresh();
  }
  async discard(paths) {
    const r = await this.need();
    const st = r.status(this.wt);
    r.discard(this.wt, this.io, paths === "all" ? st.changes.filter((c) => c.unstaged).map((c) => c.path) : paths);
    await this.refresh();
  }
  /** Commits the staged changes (with `all`, stages every change first). */
  async commit(message, { all = false } = {}) {
    const r = await this.need();
    if (all) r.stage(this.wt, r.status(this.wt).changes.map((c) => c.path));
    const oid = r.commit({ message, author: this.author });
    await this.refresh();
    return oid;
  }

  // ------------------------------------------------------------------ history

  async log({ limit = 100, search = "", path = null, all = true } = {}) {
    const r = await this.need();
    if (!r.head().oid && !all) return [];
    const deco = new Map();
    const add = (oid, label) => deco.set(oid, [...(deco.get(oid) || []), label]);
    const head = r.head();
    for (const b of r.branches()) add(b.oid, { name: b.name, kind: b.current ? "head" : "branch" });
    for (const b of r.remoteBranches()) add(b.oid, { name: b.name, kind: "remote" });
    for (const t of r.tags()) add(r._peelCommit(t.oid) || t.oid, { name: t.name, kind: "tag" });
    if (!head.branch && head.oid) add(head.oid, { name: "HEAD", kind: "head" });
    let commits = head.oid || r.refs("refs/").size ? r.log({ all, limit: search ? 2000 : limit, path }) : [];
    if (search) {
      const q = search.toLowerCase();
      commits = commits.filter((c) => c.message.toLowerCase().includes(q) || c.author.name.toLowerCase().includes(q) || c.oid.startsWith(q));
    }
    return commits.slice(0, limit).map((c) => ({ oid: c.oid, short: c.oid.slice(0, 7), subject: c.message.split("\n", 1)[0], message: c.message.trim(), author: c.author.name, email: c.author.email, ts: c.author.ts, parents: c.parents, refs: deco.get(c.oid) || [] }));
  }
  async commitInfo(oid) {
    const r = await this.need();
    const c = r.readCommit(oid);
    return { oid, message: c.message.trim(), author: c.author, parents: c.parents, changes: r.commitChanges(oid) };
  }
  _text(oid) {
    if (!oid) return null;
    const b = this.repo.readBlob(oid);
    return this.G.isBinary(b) ? { binary: true, size: b.length } : this.G.text(b);
  }
  _pair(a, b) {
    const binary = (a && typeof a === "object") || (b && typeof b === "object");
    return binary ? { binary: true, oldText: "", newText: "" } : { binary: false, oldText: a ?? "", newText: b ?? "", oldMissing: a == null, newMissing: b == null };
  }
  /** Texts for a diff: kind "staged" (HEAD vs index), "unstaged" (index vs working tree) or { commit } (parent vs commit). */
  async diffFor(path, kind) {
    const r = await this.need();
    if (typeof kind === "object" && kind.commit) {
      const c = r.readCommit(kind.commit);
      const was = c.parents[0] ? r.lookup(r.readCommit(c.parents[0]).tree, path) : null;
      const now = r.lookup(c.tree, path);
      return this._pair(this._text(was?.oid), this._text(now?.oid));
    }
    if (typeof kind === "object" && kind.compare) {
      const e = r.lookup(r.readCommit(r.resolve(kind.compare)).tree, path);
      const w = this.wt.get(path);
      return this._pair(this._text(e?.oid), w == null ? null : typeof w === "string" ? w : { binary: true });
    }
    const head = r.headFlat().get(path);
    const idx = r.readIndex().get(path);
    if (kind === "staged") return this._pair(this._text(head?.oid), this._text(idx?.oid));
    const w = this.wt.get(path);
    return this._pair(this._text(idx?.oid), w == null ? null : typeof w === "string" ? w : { binary: true });
  }
  /** HEAD text of a tracked file for the editor's change markers (null when untracked or binary). */
  baseText(path) {
    if (!this.repo) return null;
    try {
      const h = this.repo.headFlat().get(path);
      if (!h) return null;
      const t = this._text(h.oid);
      return typeof t === "string" ? t : null;
    } catch {
      return null;
    }
  }
  async unifiedDiff(path, kind) {
    const d = await this.diffFor(path, kind);
    if (d.binary) return `Binary file ${path} differs.\n`;
    return this.G.unifiedDiff(path, d.oldMissing ? null : d.oldText, d.newMissing ? null : d.newText) || "";
  }

  // ------------------------------------------------------------------ branches, merge, tags, restore

  async branches() {
    const r = await this.need();
    return { current: r.head().branch, detached: !r.head().branch && r.head().oid, local: r.branches(), remote: r.remoteBranches() };
  }
  async createBranch(name, { checkout = true } = {}) {
    const r = await this.need();
    if (checkout) r.checkoutNewBranch(name, this.wt, this.io);
    else r.createBranch(name);
    await this.refresh();
  }
  async checkout(target, { force = false } = {}) {
    const r = await this.need();
    const res = r.checkout(target, this.wt, this.io, { force });
    await this.refresh();
    return res;
  }
  async deleteBranch(name, { force = false } = {}) {
    const r = await this.need();
    r.deleteBranch(name, { force });
    await this.refresh();
  }
  async merge(name) {
    const r = await this.need();
    const res = r.merge(name, this.wt, this.io, { author: this.author });
    await this.refresh();
    return res;
  }
  async abortMerge() {
    const r = await this.need();
    r.abortMerge(this.wt, this.io);
    await this.refresh();
  }
  async tags() {
    return (await this.need()).tags();
  }
  async createTag(name, message = "", rev = "HEAD") {
    const r = await this.need();
    r.createTag(name, { oid: r.resolve(rev), message, tagger: this.G.makePerson(this.author) });
    await this.refresh();
  }
  async deleteTag(name) {
    (await this.need()).deleteTag(name);
    await this.refresh();
  }
  async restoreFile(path, rev, { stage = false } = {}) {
    const r = await this.need();
    r.restoreFile(path, rev, this.wt, this.io, { stage });
    await this.refresh();
  }
  /** Adds a line to the project's .gitignore. */
  async ignore(pattern) {
    const web = this.web;
    if (web.has(".gitignore")) {
      const t = web.text(".gitignore") ?? "";
      if (!t.split("\n").includes(pattern)) web.setText(".gitignore", `${t}${t && !t.endsWith("\n") ? "\n" : ""}${pattern}\n`);
    } else web.create(".gitignore", `${pattern}\n`);
    await this.refresh();
  }

  // ------------------------------------------------------------------ remotes

  async remotes() {
    return (await this.need()).remotes();
  }
  async setRemote(url, name = "origin") {
    (await this.need()).setRemote(name, url || null);
    this.emit("change", this._status);
  }
  /** Remote settings that are not secret: { proxy } and the branch to sync. */
  get remoteSettings() {
    return (this.web.settings.git ||= { proxy: "" });
  }
  /** Which transport applies to a remote URL. */
  transportFor(url) {
    const gh = this.G?.parseGitHubRepo(url);
    return /^https?:\/\/github\.com\//i.test(url || "") && gh && !this.remoteSettings.proxy ? "github-api" : "smart-http";
  }

  /** @param {{ token: string, onProgress?: Function, signal?: AbortSignal }} o */
  async push({ token, onProgress, signal } = {}) {
    const r = await this.need();
    const remote = r.remotes()[0];
    if (!remote) throw new Error("Add a remote repository first.");
    this.app.network?.assert?.("publish", remote.url);
    const G = this.G;
    const branch = r.head().branch;
    if (!branch) throw new Error("Switch to a branch before pushing.");
    let res;
    if (this.transportFor(remote.url) === "github-api") {
      const gh = G.parseGitHubRepo(remote.url);
      res = await G.pushToGitHub(r, new G.GitHubApi({ token, fetch: (...a) => fetch(...a), signal }), { owner: gh.owner, name: gh.name, branch, onProgress });
      res.message = res.pushed ? `Pushed ${res.pushed} commit${res.pushed === 1 ? "" : "s"} to GitHub.` : "Everything is up to date.";
    } else {
      res = await G.pushRemote(r, { url: remote.url, fetch: (...a) => fetch(...a), headers: token ? { Authorization: G.basicAuth("x-access-token", token) } : {}, proxy: this.remoteSettings.proxy, branch, signal, onProgress });
    }
    await this.refresh();
    return res;
  }
  /** Fetches and merges the remote branch of the same name. */
  async pull({ token, onProgress, signal } = {}) {
    const r = await this.need();
    const remote = r.remotes()[0];
    if (!remote) throw new Error("Add a remote repository first.");
    this.app.network?.assert?.("publish", remote.url);
    const G = this.G;
    const branch = r.head().branch;
    if (!branch) throw new Error("Switch to a branch before pulling.");
    let remoteHead = null;
    if (this.transportFor(remote.url) === "github-api") {
      const gh = G.parseGitHubRepo(remote.url);
      const f = await G.fetchFromGitHub(r, new G.GitHubApi({ token, fetch: (...a) => fetch(...a), signal }), { owner: gh.owner, name: gh.name, branch, onProgress });
      remoteHead = f.remoteHead;
      var gh2 = gh;
    } else {
      await G.fetchRemote(r, { url: remote.url, fetch: (...a) => fetch(...a), headers: token ? { Authorization: G.basicAuth("x-access-token", token) } : {}, proxy: this.remoteSettings.proxy, signal, onProgress });
    }
    if (!r.readRef(`refs/remotes/origin/${branch}`)) throw new Error(`The remote has no branch “${branch}”.`);
    const res = r.merge(`origin/${branch}`, this.wt, this.io, { author: this.author });
    if (remoteHead) G.markSynced(r, { owner: gh2.owner, name: gh2.name, branch, remoteHead });
    await this.refresh();
    return res;
  }

  // ------------------------------------------------------------------ zip

  async exportZip() {
    const r = await this.need();
    return this.G.exportRepoZip(r, this.wt);
  }
}
