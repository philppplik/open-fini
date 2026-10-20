// GitHub sync through the REST / Git Data API (api.github.com sends CORS headers, so this works from a browser
// with a personal access token — unlike GitHub's smart-HTTP git endpoints). Pure: `fetch` is injected.
//
// GitHub stores real Git objects, so blob and tree ids equal ours. Commit ids can differ (GitHub re-serializes the
// commit), so the mapping remote id -> local id is kept in `.git/openfini-github.json`, which Git ignores.
import { GitRepo, GitError } from "./repo.js";
import { toHex, utf8, serializeCommit, hashObject } from "./objects.js";

const API = "https://api.github.com";

export function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** "owner/name", "https://github.com/owner/name(.git)" → { owner, name } or null. */
export function parseGitHubRepo(input) {
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(input || "").trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

export class GitHubApi {
  constructor({ token, fetch: fetchFn, base = API, signal } = {}) {
    if (!token) throw new GitError("Add a GitHub personal access token first.", "NO_TOKEN");
    this.token = token;
    this.fetch = fetchFn;
    this.base = base.replace(/\/+$/, "");
    this.signal = signal;
  }
  async req(method, path, body, { allow = [] } = {}) {
    let res;
    try {
      res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: this.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new GitError("Could not reach api.github.com. Check your connection.", "NETWORK");
    }
    if (allow.includes(res.status)) return { status: res.status, json: await res.json().catch(() => null) };
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = j?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new GitError("GitHub rejected the token (401). Create a new personal access token with repository access.", "AUTH");
      if (res.status === 403) throw new GitError(`GitHub refused the request (403): ${msg}`, "AUTH");
      if (res.status === 404) throw new GitError("GitHub returned 404: the repository was not found, or the token cannot see it.", "NOT_FOUND");
      if (res.status === 409 && /empty/i.test(msg)) throw new GitError("This GitHub repository is empty. Create a first commit on GitHub (for example by adding a README), then try again.", "EMPTY_REPO");
      throw new GitError(`GitHub: ${msg}`, "HTTP");
    }
    return { status: res.status, json: res.status === 204 ? null : await res.json() };
  }
  async get(path, opts) {
    return (await this.req("GET", path, null, opts)).json;
  }
  async post(path, body, opts) {
    return (await this.req("POST", path, body, opts)).json;
  }
  repoInfo(o, n) {
    return this.get(`/repos/${o}/${n}`);
  }
  /** SHA of a branch head, or null when the branch does not exist. */
  async branchHead(o, n, branch) {
    const r = await this.req("GET", `/repos/${o}/${n}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`, null, { allow: [404, 409] });
    if (r.status === 404 || r.status === 409) return null;
    return r.json.object.sha;
  }
}

// ---- date helpers

const pad = (n) => String(n).padStart(2, "0");
/** ISO 8601 with the commit's own offset, as the API expects: 2024-01-02T03:04:05+02:00 */
export function isoWithTz(ts, tz) {
  const sign = tz[0] === "-" ? -1 : 1;
  const off = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const d = new Date((ts + off * 60) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tz[0]}${tz.slice(1, 3)}:${tz.slice(3, 5)}`;
}
export function parseIso(iso) {
  const m = /^(.*)([+-])(\d\d):?(\d\d)$/.exec(iso);
  const ts = Math.floor(Date.parse(iso) / 1000);
  return { ts: Number.isNaN(ts) ? 0 : ts, tz: m ? `${m[2]}${m[3]}${m[4]}` : "+0000" };
}

// ---- mapping state

const STATE_FILE = "openfini-github.json";
const keyOf = (o, n, b) => `${o}/${n}#${b}`;
function readState(repo) {
  try {
    return JSON.parse(repo._text(STATE_FILE) || "{}");
  } catch {
    return {};
  }
}
function writeState(repo, s) {
  repo._set(STATE_FILE, utf8(JSON.stringify(s)));
}

async function pool(items, n, fn, signal) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await fn(items[i++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/**
 * Pushes the current branch as new commits on GitHub (fast-forward only).
 * @returns {Promise<{ pushed: number, head: string }>}
 */
export async function pushToGitHub(repo, api, { owner, name, branch, onProgress } = {}) {
  branch ||= repo.head().branch;
  const tip = repo.readRef(`refs/heads/${branch}`);
  if (!tip) throw new GitError("Nothing to push: make a commit first.", "NO_COMMITS");
  const state = readState(repo);
  const key = keyOf(owner, name, branch);
  const entry = state[key] || { head: null, map: {} };
  onProgress?.("Checking the remote branch…");
  const remoteHead = await api.branchHead(owner, name, branch);
  if (remoteHead && remoteHead !== entry.head) throw new GitError("The remote branch has commits that are not in this project. Pull first.", "REMOTE_AHEAD");
  const known = new Set(Object.values(entry.map));
  const local2remote = new Map(Object.entries(entry.map).map(([r, l]) => [l, r]));
  // commits still to send, oldest first
  const todo = [];
  const seen = new Set();
  const stack = [tip];
  while (stack.length) {
    const c = stack.pop();
    if (known.has(c) || seen.has(c)) continue;
    seen.add(c);
    todo.push(c);
    stack.push(...repo.readCommit(c).parents);
  }
  if (!todo.length) return { pushed: 0, head: tip };
  todo.sort((a, b) => repo.readCommit(a).committer.ts - repo.readCommit(b).committer.ts || (repo.isAncestor(a, b) ? -1 : 1));
  // topological safety: parents before children
  const ordered = [];
  const done = new Set();
  const visit = (c) => {
    if (done.has(c) || !seen.has(c)) return;
    done.add(c);
    for (const p of repo.readCommit(c).parents) visit(p);
    ordered.push(c);
  };
  todo.forEach(visit);
  const uploaded = new Set();
  for (const k of known) for (const v of repo.flatten(repo.readCommit(k).tree).values()) uploaded.add(v.oid);
  let n = 0;
  for (const c of ordered) {
    const cm = repo.readCommit(c);
    const flat = repo.flatten(cm.tree);
    const blobs = [...new Set([...flat.values()].map((v) => v.oid))].filter((o) => !uploaded.has(o));
    await pool(blobs, 4, async (oid) => {
      onProgress?.(`Uploading file ${++n}…`);
      const r = await api.post(`/repos/${owner}/${name}/git/blobs`, { content: bytesToBase64(repo.readBlob(oid)), encoding: "base64" });
      if (r.sha !== oid) throw new GitError("GitHub stored a file under a different id than expected.", "HASH_MISMATCH");
      uploaded.add(oid);
    }, api.signal);
    const tree = await api.post(`/repos/${owner}/${name}/git/trees`, { tree: [...flat].map(([path, v]) => ({ path, mode: v.mode, type: "blob", sha: v.oid })) });
    const parents = cm.parents.map((p) => local2remote.get(p)).filter(Boolean);
    const person = (p) => ({ name: p.name, email: p.email, date: isoWithTz(p.ts, p.tz) });
    const created = await api.post(`/repos/${owner}/${name}/git/commits`, { message: cm.message, tree: tree.sha, parents, author: person(cm.author), committer: person(cm.committer) });
    local2remote.set(c, created.sha);
    entry.map[created.sha] = c;
  }
  const remoteTip = local2remote.get(tip);
  onProgress?.("Updating the branch…");
  if (remoteHead) await api.req("PATCH", `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: remoteTip, force: false });
  else await api.post(`/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: remoteTip });
  entry.head = remoteTip;
  state[key] = entry;
  writeState(repo, state);
  repo.writeRef(`refs/remotes/origin/${branch}`, tip);
  return { pushed: ordered.length, head: tip };
}

/**
 * Downloads new commits of a branch into the repository (as `refs/remotes/origin/<branch>`); does not touch the
 * working tree. Returns the local id of the fetched tip.
 */
export async function fetchFromGitHub(repo, api, { owner, name, branch, onProgress, limit = 100 } = {}) {
  const remoteHead = await api.branchHead(owner, name, branch);
  if (!remoteHead) throw new GitError(`The branch “${branch}” does not exist on GitHub.`, "NO_BRANCH");
  const state = readState(repo);
  const key = keyOf(owner, name, branch);
  const entry = state[key] || { head: null, map: {} };
  if (entry.map[remoteHead] && repo.hasObject(entry.map[remoteHead])) {
    repo.writeRef(`refs/remotes/origin/${branch}`, entry.map[remoteHead]);
    return { tip: entry.map[remoteHead], fetched: 0, remoteHead };
  }
  // walk back to a commit we know
  const chain = [];
  let sha = remoteHead;
  const stack = [sha];
  const meta = new Map();
  while (stack.length) {
    const s = stack.pop();
    if (meta.has(s) || (entry.map[s] && repo.hasObject(entry.map[s]))) continue;
    if (meta.size >= limit) throw new GitError(`More than ${limit} new commits on GitHub; pull in smaller steps or clone again.`, "TOO_MANY");
    onProgress?.(`Reading commit ${meta.size + 1}…`);
    const c = await api.get(`/repos/${owner}/${name}/git/commits/${s}`);
    meta.set(s, c);
    for (const p of c.parents) stack.push(p.sha);
  }
  // oldest first
  const order = [];
  const visited = new Set();
  const visit = (s) => {
    if (visited.has(s) || !meta.has(s)) return;
    visited.add(s);
    for (const p of meta.get(s).parents) visit(p.sha);
    order.push(s);
  };
  visit(remoteHead);
  for (const s of order) {
    const c = meta.get(s);
    const t = await api.get(`/repos/${owner}/${name}/git/trees/${c.tree.sha}?recursive=1`);
    if (t.truncated) throw new GitError("This repository is too large to read through the GitHub API.", "TOO_LARGE");
    const flat = new Map();
    const need = [];
    for (const e of t.tree) {
      if (e.type !== "blob") continue;
      flat.set(e.path, { oid: e.sha, mode: e.mode === "100755" || e.mode === "120000" ? e.mode : "100644" });
      if (!repo.hasObject(e.sha)) need.push(e.sha);
    }
    await pool([...new Set(need)], 4, async (oid) => {
      onProgress?.("Downloading files…");
      const b = await api.get(`/repos/${owner}/${name}/git/blobs/${oid}`);
      const bytes = b.encoding === "base64" ? base64ToBytes(b.content) : utf8(b.content);
      if (hashObject("blob", bytes) !== oid) throw new GitError("A downloaded file did not match its id.", "HASH_MISMATCH");
      repo.writeObject("blob", bytes);
    }, api.signal);
    const tree = repo.buildTree(flat);
    const parents = c.parents.map((p) => entry.map[p.sha]).filter(Boolean);
    const a = { name: c.author.name, email: c.author.email, ...parseIso(c.author.date) };
    const cm = { name: c.committer.name, email: c.committer.email, ...parseIso(c.committer.date) };
    entry.map[s] = repo.writeObject("commit", serializeCommit({ tree, parents, author: a, committer: cm, message: c.message }));
  }
  entry.head ||= null;
  state[key] = entry;
  writeState(repo, state);
  const tip = entry.map[remoteHead];
  repo.writeRef(`refs/remotes/origin/${branch}`, tip);
  return { tip, fetched: order.length, remoteHead };
}

/** After a successful fetch+merge (or when local equals remote) record the remote head as in sync. */
export function markSynced(repo, { owner, name, branch, remoteHead }) {
  const state = readState(repo);
  const key = keyOf(owner, name, branch);
  state[key] = { ...(state[key] || { map: {} }), head: remoteHead };
  writeState(repo, state);
}

/** Clones a branch into a fresh repository. @returns {Promise<{ git: Map<string, Uint8Array>, files: Map<string, Uint8Array>, branch: string }>} */
export async function cloneFromGitHub(api, { owner, name, branch, onProgress } = {}) {
  const info = await api.repoInfo(owner, name);
  branch ||= info.default_branch;
  const git = new Map();
  const repo = GitRepo.init(git, { branch });
  const { tip, remoteHead } = await fetchFromGitHub(repo, api, { owner, name, branch, onProgress });
  markSynced(repo, { owner, name, branch, remoteHead });
  repo.setRemote("origin", `https://github.com/${owner}/${name}.git`);
  const files = new Map();
  const io = { write: (p, b) => files.set(p, b), remove: (p) => files.delete(p) };
  repo.reset(tip, { paths: () => [], get: () => null }, io, { hard: true });
  const cfg = repo.config();
  cfg[`branch.${branch}`] = { remote: "origin", merge: `refs/heads/${branch}` };
  repo.setConfig(cfg);
  return { git, files, branch };
}

/**
 * Commits a complete file set as one commit on `branch` (creating it when missing). Used by GitHub Pages publishing.
 * `files` is [{ path, bytes }]; the new tree replaces the old one (removed files disappear).
 * @returns {Promise<{ sha: string, created: boolean }>}
 */
export async function commitFiles(api, { owner, name, branch, files, message, author, onProgress }) {
  const head = await api.branchHead(owner, name, branch);
  let n = 0;
  const entries = [];
  await pool(files, 4, async (f) => {
    onProgress?.(`Uploading ${++n} of ${files.length}…`);
    const b = await api.post(`/repos/${owner}/${name}/git/blobs`, { content: bytesToBase64(f.bytes), encoding: "base64" });
    entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
  }, api.signal);
  entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  const tree = await api.post(`/repos/${owner}/${name}/git/trees`, { tree: entries });
  const commit = await api.post(`/repos/${owner}/${name}/git/commits`, { message, tree: tree.sha, parents: head ? [head] : [], ...(author ? { author, committer: author } : {}) });
  if (head) await api.req("PATCH", `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
  else await api.post(`/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  return { sha: commit.sha, created: !head };
}
export { toHex };
