// Git smart-HTTP client (protocol v0): ref discovery, fetch (upload-pack) and push (receive-pack) over `fetch`.
// Browsers cannot call most Git hosts directly (no CORS headers on the git endpoints), so requests can be routed
// through a CORS proxy the user configures. Pure: `fetch` is injected, so it runs in Node tests as well.
import { concat, toHex, utf8, text } from "./objects.js";
import { readPack, writePack, pktLine, readPktLines, FLUSH } from "./pack.js";
import { GitError } from "./repo.js";

const ZERO = "0".repeat(40);

/** The URL to request: direct, through a `{url}` template, or a prefix proxy (https://proxy.example/ + full URL). */
export function proxied(target, proxy) {
  if (!proxy) return target;
  if (proxy.includes("{url}")) return proxy.replace("{url}", encodeURIComponent(target));
  return `${proxy.replace(/\/+$/, "")}/${target}`;
}

export function basicAuth(user, token) {
  const b = utf8(`${user || "x-access-token"}:${token}`);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return `Basic ${btoa(s)}`;
}

function cleanUrl(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) throw new GitError("Enter an https:// repository address.", "BAD_URL");
  return u;
}

async function request(fetchFn, url, init, what) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new GitError(`${what} failed: the request was blocked or could not reach the server. Browsers only allow this when the server (or your CORS proxy) sends CORS headers.`, "NETWORK");
  }
  if (res.status === 401 || res.status === 403) throw new GitError(`${what} was rejected (${res.status}). Check the access token and its permissions.`, "AUTH");
  if (res.status === 404) throw new GitError(`${what}: repository not found (404). Check the address and your access.`, "NOT_FOUND");
  if (!res.ok) throw new GitError(`${what} failed (HTTP ${res.status}).`, "HTTP");
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Lists the refs of a remote.
 * @returns {Promise<{ refs: Map<string, string>, head: string | null, caps: Set<string> }>}
 */
export async function discoverRefs({ url, service = "git-upload-pack", fetch: fetchFn, headers = {}, proxy, signal }) {
  const base = cleanUrl(url);
  const body = await request(fetchFn, proxied(`${base}/info/refs?service=${service}`, proxy), { headers: { Accept: `application/x-${service}-advertisement`, ...headers }, signal }, "Reading the remote");
  const { lines } = readPktLines(body);
  const refs = new Map();
  const caps = new Set();
  let head = null;
  let first = true;
  const symrefs = [];
  for (const l of lines) {
    if (!l) continue;
    let s = text(l).replace(/\n$/, "");
    if (s.startsWith("# service=")) continue;
    if (first) {
      first = false;
      const nul = s.indexOf("\0");
      if (nul >= 0) {
        for (const c of s.slice(nul + 1).split(" ")) {
          caps.add(c);
          if (c.startsWith("symref=HEAD:")) symrefs.push(c.slice(12));
        }
        s = s.slice(0, nul);
      }
    }
    const sp = s.indexOf(" ");
    const oid = s.slice(0, sp);
    const name = s.slice(sp + 1);
    if (name === "capabilities^{}" || name.endsWith("^{}")) continue;
    if (name === "HEAD") head = oid;
    else refs.set(name, oid);
  }
  return { refs, head, headRef: symrefs[0] || null, caps };
}

/** Splits a side-band-64k response into the pack data (channel 1); channel 3 becomes an error. */
function sidebandData(bytes) {
  const { lines } = readPktLines(bytes);
  const parts = [];
  for (const l of lines) {
    if (!l || !l.length) continue;
    const ch = l[0];
    if (ch === 1) parts.push(l.subarray(1));
    else if (ch === 3) throw new GitError(`The server reported: ${text(l.subarray(1)).trim()}`, "REMOTE_ERROR");
    else if (ch !== 2 && !/^(NAK|ACK|shallow|unshallow)/.test(text(l.subarray(0, 9)))) parts.push(l); // not side-banded
  }
  return concat(...parts);
}

/**
 * Downloads the history of the wanted refs into `repo` and updates `refs/remotes/<remote>/…`.
 * @returns {Promise<{ refs: Map<string,string>, objects: number, updated: string[] }>}
 */
export async function fetchRemote(repo, { url, fetch: fetchFn, headers = {}, proxy, remote = "origin", signal, onProgress } = {}) {
  const info = await discoverRefs({ url, fetch: fetchFn, headers, proxy, signal });
  const wants = new Set();
  const branches = [...info.refs].filter(([n]) => n.startsWith("refs/heads/") || n.startsWith("refs/tags/"));
  for (const [, oid] of branches) if (!repo.hasObject(oid)) wants.add(oid);
  let objects = 0;
  if (wants.size) {
    onProgress?.("Downloading…");
    const haves = [...repo.refs("refs/").values(), repo.head().oid].filter((o) => o && repo.hasObject(o)).slice(0, 128);
    const caps = ["side-band-64k", "ofs-delta"].filter((c) => info.caps.has(c));
    caps.push("agent=openfini");
    const parts = [];
    let firstWant = true;
    for (const w of wants) {
      parts.push(pktLine(`want ${w}${firstWant ? ` ${caps.join(" ")}` : ""}\n`));
      firstWant = false;
    }
    parts.push(FLUSH);
    for (const h of new Set(haves)) parts.push(pktLine(`have ${h}\n`));
    parts.push(pktLine("done\n"));
    const resp = await request(fetchFn, proxied(`${cleanUrl(url)}/git-upload-pack`, proxy), { method: "POST", headers: { "Content-Type": "application/x-git-upload-pack-request", Accept: "application/x-git-upload-pack-result", ...headers }, body: concat(...parts), signal }, "Downloading");
    const data = info.caps.has("side-band-64k") ? sidebandData(resp) : resp.subarray(resp.indexOf(0x50)); // "PACK" after NAK
    if (!data.length) throw new GitError("The server sent no data.", "EMPTY_PACK");
    for (const o of readPack(data, { external: (oid) => (repo.hasObject(oid) ? repo.readObject(oid) : null) })) {
      repo.writeObject(o.type, o.content);
      objects++;
    }
  }
  const updated = [];
  for (const [name, oid] of info.refs) {
    if (name.startsWith("refs/heads/")) {
      const ref = `refs/remotes/${remote}/${name.slice(11)}`;
      if (repo.readRef(ref) !== oid) updated.push(name.slice(11));
      repo.writeRef(ref, oid);
    } else if (name.startsWith("refs/tags/") && !repo.readRef(name)) repo.writeRef(name, oid);
  }
  return { refs: info.refs, head: info.head, headRef: info.headRef, objects, updated };
}

/**
 * Pushes `refName` (default: the current branch) to the remote.
 * @returns {Promise<{ ok: boolean, objects: number, message: string }>}
 */
export async function pushRemote(repo, { url, fetch: fetchFn, headers = {}, proxy, remote = "origin", branch, force = false, signal, onProgress } = {}) {
  const name = branch || repo.head().branch;
  if (!name) throw new GitError("Switch to a branch before pushing.", "DETACHED");
  const newOid = repo.readRef(`refs/heads/${name}`);
  if (!newOid) throw new GitError(`There is no branch “${name}” to push.`, "NO_BRANCH");
  const refName = `refs/heads/${name}`;
  const info = await discoverRefs({ url, service: "git-receive-pack", fetch: fetchFn, headers, proxy, signal });
  const oldOid = info.refs.get(refName) || ZERO;
  if (oldOid === newOid) return { ok: true, objects: 0, message: "Everything is up to date." };
  if (oldOid !== ZERO) {
    if (!repo.hasObject(oldOid)) throw new GitError("The remote has commits you do not have. Pull first.", "REMOTE_AHEAD");
    if (!force && !repo.isAncestor(oldOid, newOid)) throw new GitError("The remote branch has commits that are not in yours. Pull and merge first (or force push).", "NON_FAST_FORWARD");
  }
  const haves = [...info.refs.values()].filter((o) => repo.hasObject(o));
  const objs = repo.objectsToSend(newOid, haves);
  onProgress?.(`Uploading ${objs.length} objects…`);
  const caps = "report-status agent=openfini";
  const body = concat(pktLine(`${oldOid} ${newOid} ${refName}\0 ${caps}`), FLUSH, writePack(objs));
  const resp = await request(fetchFn, proxied(`${cleanUrl(url)}/git-receive-pack`, proxy), { method: "POST", headers: { "Content-Type": "application/x-git-receive-pack-request", Accept: "application/x-git-receive-pack-result", ...headers }, body, signal }, "Uploading");
  const { lines } = readPktLines(resp);
  const msgs = lines.filter(Boolean).map((l) => text(l).trim());
  const unpack = msgs.find((m) => m.startsWith("unpack "));
  if (unpack && unpack !== "unpack ok") throw new GitError(`The server could not unpack the upload: ${unpack}`, "REMOTE_ERROR");
  const ng = msgs.find((m) => m.startsWith("ng "));
  if (ng) throw new GitError(`The server rejected the push: ${ng.slice(3)}`, "REJECTED");
  if (!msgs.some((m) => m === `ok ${refName}`)) throw new GitError(`The server did not confirm the push. ${msgs.join(" ").slice(0, 200)}`, "REMOTE_ERROR");
  repo.writeRef(`refs/remotes/${remote}/${name}`, newOid);
  return { ok: true, objects: objs.length, message: `Pushed ${name} (${objs.length} objects).` };
}
