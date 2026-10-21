// Publish targets: one deploy function per service, written against the vendors' documented HTTP APIs.
// Pure: `fetch` and `sleep` are injected so each flow is unit-tested with a mock server. A deploy function takes
//   { files: {path, bytes}[], config, secret, fetch, signal, onProgress, sleep, site: { name } }
// and returns { url, message, config? } where `config` is a patch to remember (for example a created site id).
// Secrets are only ever sent to the host of the target that was configured.
import { zipFiles, joinUrl, contentType, urlPath, sleepMs } from "./files.js";
import { sha1Hex } from "../git/objects.js";
import { GitHubApi, commitFiles, parseGitHubRepo } from "../git/github.js";

export class PublishError extends Error {
  constructor(message, code = "PUBLISH", detail = {}) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.detail = detail;
  }
}

async function call(ctx, url, init, { what, ok = [200, 201, 202, 204], parse = "json" } = {}) {
  let res;
  try {
    res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new PublishError(`${what}: the request could not be sent. The service may not allow requests from a web page (CORS), or you are offline.`, "NETWORK");
  }
  if (!ok.includes(res.status)) {
    let detail = "";
    try {
      const t = await res.text();
      detail = (JSON.parse(t).message || JSON.parse(t).error?.message || t).toString().slice(0, 200);
    } catch {
      /* body is optional */
    }
    if (res.status === 401 || res.status === 403) throw new PublishError(`${what}: access was refused (${res.status}). Check the token and its permissions.${detail ? ` ${detail}` : ""}`, "AUTH");
    throw new PublishError(`${what} failed (HTTP ${res.status}).${detail ? ` ${detail}` : ""}`, "HTTP", { status: res.status });
  }
  if (parse === "json") return res.status === 204 ? null : await res.json().catch(() => null);
  return res;
}

async function pool(items, n, fn, signal) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        await fn(items[i++]);
      }
    }),
  );
}

const needToken = (ctx, what) => {
  if (!ctx.secret) throw new PublishError(`Add your ${what} first.`, "NO_SECRET");
};

// ------------------------------------------------------------------ Netlify

export const NETLIFY_API = "https://api.netlify.com/api/v1";

/** Pure request descriptions (used by the deploy and by the tests). */
export const netlify = {
  createSite: (token, name) => ({ url: `${NETLIFY_API}/sites`, init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(name ? { name } : {}) } }),
  deploy: (token, siteId, zip) => ({ url: `${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`, init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" }, body: zip } }),
  deployState: (token, id) => ({ url: `${NETLIFY_API}/deploys/${encodeURIComponent(id)}`, init: { headers: { Authorization: `Bearer ${token}` } } }),
  site: (token, id) => ({ url: `${NETLIFY_API}/sites/${encodeURIComponent(id)}`, init: { headers: { Authorization: `Bearer ${token}` } } }),
};

export async function deployNetlify(ctx) {
  const { config = {}, secret: token } = ctx;
  needToken(ctx, "Netlify personal access token");
  const patch = {};
  let siteId = (config.siteId || "").trim();
  let site = null;
  if (!siteId) {
    ctx.onProgress?.({ text: "Creating the Netlify site…" });
    const r = netlify.createSite(token, (config.siteName || "").trim());
    site = await call(ctx, r.url, r.init, { what: "Creating the Netlify site" });
    siteId = site.id;
    patch.siteId = siteId;
  }
  ctx.onProgress?.({ text: `Uploading ${ctx.files.length} files…` });
  const zip = zipFiles(ctx.files);
  const d = netlify.deploy(token, siteId, zip);
  const deploy = await call(ctx, d.url, d.init, { what: "Uploading to Netlify" });
  let state = deploy.state;
  for (let i = 0; i < 90 && state !== "ready" && state !== "current"; i++) {
    if (state === "error") throw new PublishError(`Netlify could not process the deploy: ${deploy.error_message || "unknown error"}.`, "REMOTE");
    ctx.onProgress?.({ text: `Netlify is processing the deploy (${state})…` });
    await (ctx.sleep || sleepMs)(1500, ctx.signal);
    const s = netlify.deployState(token, deploy.id);
    const cur = await call(ctx, s.url, s.init, { what: "Checking the Netlify deploy" });
    state = cur.state;
    Object.assign(deploy, cur);
  }
  if (state !== "ready" && state !== "current") throw new PublishError("Netlify did not finish the deploy in time. Check the Netlify dashboard.", "TIMEOUT");
  if (!site) {
    const s = netlify.site(token, siteId);
    site = await call(ctx, s.url, s.init, { what: "Reading the Netlify site" });
  }
  return { url: site.ssl_url || site.url || deploy.ssl_url || deploy.url, id: deploy.id, message: "Deployed to Netlify.", config: patch };
}

// ------------------------------------------------------------------ Vercel

export const VERCEL_API = "https://api.vercel.com";
export const vercelName = (s) => (String(s || "site").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").replace(/---+/g, "--").slice(0, 100) || "site");

export const vercel = {
  upload: (token, file, sha, team) => ({ url: `${VERCEL_API}/v2/files${team ? `?teamId=${encodeURIComponent(team)}` : ""}`, init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "x-vercel-digest": sha }, body: file.bytes } }),
  create: (token, name, files, team, production) => ({
    url: `${VERCEL_API}/v13/deployments${team ? `?teamId=${encodeURIComponent(team)}` : ""}`,
    init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, files, projectSettings: { framework: null }, ...(production ? { target: "production" } : {}) }) },
  }),
  state: (token, id, team) => ({ url: `${VERCEL_API}/v13/deployments/${encodeURIComponent(id)}${team ? `?teamId=${encodeURIComponent(team)}` : ""}`, init: { headers: { Authorization: `Bearer ${token}` } } }),
};

export async function deployVercel(ctx) {
  const { config = {}, secret: token } = ctx;
  needToken(ctx, "Vercel access token");
  const team = (config.teamId || "").trim();
  const name = vercelName(config.projectName || ctx.site?.name);
  const meta = ctx.files.map((f) => ({ file: f.path, sha: sha1Hex(f.bytes), size: f.bytes.length, f }));
  let n = 0;
  await pool(meta, 4, async (m) => {
    ctx.onProgress?.({ text: `Uploading file ${++n} of ${meta.length}…`, done: n, total: meta.length });
    const r = vercel.upload(token, m.f, m.sha, team);
    await call(ctx, r.url, r.init, { what: `Uploading ${m.file}`, ok: [200, 201, 409] , parse: "none" });
  }, ctx.signal);
  ctx.onProgress?.({ text: "Creating the deployment…" });
  const c = vercel.create(token, name, meta.map(({ file, sha, size }) => ({ file, sha, size })), team, config.production !== false);
  const dep = await call(ctx, c.url, c.init, { what: "Creating the Vercel deployment" });
  let state = dep.readyState;
  for (let i = 0; i < 90 && state !== "READY"; i++) {
    if (state === "ERROR" || state === "CANCELED") throw new PublishError(`Vercel reported ${state.toLowerCase()} for the deployment.`, "REMOTE");
    ctx.onProgress?.({ text: `Vercel is building (${(state || "queued").toLowerCase()})…` });
    await (ctx.sleep || sleepMs)(1500, ctx.signal);
    const s = vercel.state(token, dep.id, team);
    const cur = await call(ctx, s.url, s.init, { what: "Checking the Vercel deployment" });
    state = cur.readyState;
    Object.assign(dep, cur);
  }
  if (state !== "READY") throw new PublishError("Vercel did not finish in time. Check the Vercel dashboard.", "TIMEOUT");
  const alias = dep.alias?.[0] || dep.url;
  return { url: `https://${alias}`, id: dep.id, message: "Deployed to Vercel." };
}

// ------------------------------------------------------------------ GitHub Pages

export async function deployGitHubPages(ctx) {
  const { config = {}, secret: token } = ctx;
  needToken(ctx, "GitHub personal access token");
  const repo = parseGitHubRepo(config.repo);
  if (!repo) throw new PublishError("Enter the repository as owner/name.", "BAD_CONFIG");
  const branch = (config.branch || "gh-pages").trim();
  const api = new GitHubApi({ token, fetch: ctx.fetch, signal: ctx.signal });
  const files = [...ctx.files.filter((f) => f.path !== ".nojekyll"), { path: ".nojekyll", bytes: new Uint8Array(0) }];
  const info = await api.repoInfo(repo.owner, repo.name);
  if (branch === info.default_branch && config.allowDefaultBranch !== true) throw new PublishError(`“${branch}” is the default branch of this repository; publishing would replace everything on it. Use a separate branch such as gh-pages.`, "BAD_CONFIG");
  await commitFiles(api, { owner: repo.owner, name: repo.name, branch, files, message: config.message || "Publish site from OpenFini", onProgress: (text) => ctx.onProgress?.({ text }) });
  ctx.onProgress?.({ text: "Enabling GitHub Pages…" });
  await api.req("POST", `/repos/${repo.owner}/${repo.name}/pages`, { source: { branch, path: "/" } }, { allow: [201, 409, 422] });
  let url = `https://${repo.owner}.github.io/${repo.name}/`;
  try {
    const p = await api.get(`/repos/${repo.owner}/${repo.name}/pages`);
    if (p?.html_url) url = p.html_url;
  } catch {
    /* the default address is a good guess */
  }
  return { url, message: "Committed to GitHub. Pages can take a minute to update." };
}

// ------------------------------------------------------------------ WebDAV / HTTP PUT

export const dirsOf = (files) => {
  const set = new Set();
  for (const f of files) {
    const parts = f.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
};

export function davAuth(config, secret) {
  if (config.auth === "bearer" && secret) return { Authorization: `Bearer ${secret}` };
  if (config.auth === "none" || !secret) return {};
  const raw = new TextEncoder().encode(`${config.username || ""}:${secret}`);
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return { Authorization: `Basic ${btoa(s)}` };
}

export async function deployWebDav(ctx) {
  const { config = {} } = ctx;
  const base = String(config.url || "").trim();
  if (!/^https?:\/\//i.test(base)) throw new PublishError("Enter the WebDAV or upload address (https://…).", "BAD_CONFIG");
  if (/^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base) && config.auth !== "none") throw new PublishError("Credentials are only sent over https:// (or to localhost).", "BAD_CONFIG");
  const headers = davAuth(config, ctx.secret);
  const dav = config.mode !== "put";
  if (dav) {
    const dirs = dirsOf(ctx.files);
    let i = 0;
    for (const d of dirs) {
      ctx.onProgress?.({ text: `Creating folder ${d}…`, done: i++, total: dirs.length });
      await call(ctx, `${joinUrl(base, d)}/`, { method: "MKCOL", headers }, { what: `Creating folder ${d}`, ok: [200, 201, 204, 301, 405], parse: "none" });
    }
  }
  let n = 0;
  await pool(ctx.files, 3, async (f) => {
    ctx.onProgress?.({ text: `Uploading ${f.path}…`, done: n, total: ctx.files.length });
    await call(ctx, joinUrl(base, f.path), { method: "PUT", headers: { ...headers, "Content-Type": contentType(f.path) }, body: f.bytes }, { what: `Uploading ${f.path}`, ok: [200, 201, 204], parse: "none" });
    n++;
  }, ctx.signal);
  return { url: (config.publicUrl || base).trim(), message: `Uploaded ${ctx.files.length} files.` };
}

// ------------------------------------------------------------------ Publish helper (FTP / FTPS / SFTP / rsync / SMTP)

/** Reads the helper's newline-delimited JSON progress stream. */
export async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        last = JSON.parse(line);
        onEvent?.(last);
      } catch {
        /* ignore garbage */
      }
    }
    if (done) break;
  }
  return last;
}

export function helperRequest(config, files, secrets = {}) {
  const target = { protocol: config.protocol, host: config.host, port: config.port ? Number(config.port) : undefined, user: config.username, password: secrets.password, remotePath: config.remotePath, keyFile: config.keyFile, strictHostKey: config.strictHostKey, secure: config.secure, to: config.to, from: config.from, subject: config.subject, name: config.name };
  const json = JSON.stringify(target);
  const b = new TextEncoder().encode(json);
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  const b64 = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { url: `${String(config.helperUrl || "http://127.0.0.1:4310").replace(/\/+$/, "")}/publish`, init: { method: "POST", headers: { Authorization: `Bearer ${secrets.token || ""}`, "Content-Type": "application/zip", "X-OpenFini-Target": b64 }, body: zipFiles(files) } };
}

export async function deployHelper(ctx) {
  const { config = {} } = ctx;
  let secrets = {};
  try {
    secrets = typeof ctx.secret === "string" && ctx.secret.startsWith("{") ? JSON.parse(ctx.secret) : { token: ctx.secret };
  } catch {
    secrets = { token: ctx.secret };
  }
  if (!secrets.token) throw new PublishError("Add the helper token printed when you started the publish helper.", "NO_SECRET");
  const r = helperRequest(config, ctx.files, secrets);
  ctx.onProgress?.({ text: "Sending the site to the publish helper…" });
  const res = await call(ctx, r.url, r.init, { what: "Contacting the publish helper", parse: "none" });
  const last = await readNdjson(res, (ev) => ev.type === "progress" && ctx.onProgress?.({ text: ev.text, done: ev.done, total: ev.total }));
  if (!last || last.type === "error") throw new PublishError(last?.message || "The publish helper did not finish.", "REMOTE");
  return { url: config.publicUrl || last.url || "", message: last.message || "Uploaded by the publish helper." };
}

// ------------------------------------------------------------------ registry

/** Field descriptions drive the form in the Publish dialog. `secret` names what is stored in the vault. */
export const TARGETS = [
  { id: "netlify", label: "Netlify", deploy: deployNetlify, secret: "Personal access token", secretHelp: "Netlify ▸ User settings ▸ Applications ▸ Personal access tokens.", host: "api.netlify.com", fields: [{ key: "siteId", label: "Site ID (empty creates a new site)" }, { key: "siteName", label: "Name for a new site (optional)" }] },
  { id: "vercel", label: "Vercel", deploy: deployVercel, secret: "Access token", secretHelp: "Vercel ▸ Account settings ▸ Tokens.", host: "api.vercel.com", fields: [{ key: "projectName", label: "Project name" }, { key: "teamId", label: "Team ID (optional)" }] },
  { id: "github-pages", label: "GitHub Pages", deploy: deployGitHubPages, secret: "Personal access token", secretHelp: "A fine-grained token with Contents and Pages read/write access to the repository.", host: "api.github.com", fields: [{ key: "repo", label: "Repository (owner/name)" }, { key: "branch", label: "Branch", placeholder: "gh-pages" }] },
  { id: "webdav", label: "WebDAV / HTTP PUT", deploy: deployWebDav, secret: "Password or token", secretHelp: "Sent only to the address below. The server must send CORS headers (allow PUT, MKCOL and Authorization).", fields: [{ key: "url", label: "Upload address", placeholder: "https://cloud.example.com/remote.php/dav/files/me/site" }, { key: "username", label: "Username" }, { key: "mode", label: "Method", options: [["webdav", "WebDAV (creates folders with MKCOL)"], ["put", "Plain HTTP PUT"]] }, { key: "publicUrl", label: "Public address of the site (optional)" }] },
  { id: "helper", label: "Server (FTP / SFTP / rsync / SMTP) via helper", deploy: deployHelper, secret: "Helper token", secretHelp: "Printed by `npm run publish:helper`. The server password is asked for per upload and never saved.", helper: true, fields: [{ key: "helperUrl", label: "Helper address", placeholder: "http://127.0.0.1:4310" }, { key: "protocol", label: "Protocol", options: [["sftp", "SFTP (ssh keys)"], ["ftp", "FTP"], ["ftps", "FTPS (explicit TLS)"], ["rsync", "rsync over ssh"], ["smtp", "Mail the site as a ZIP (SMTP)"]] }, { key: "host", label: "Host" }, { key: "port", label: "Port (optional)" }, { key: "username", label: "Username" }, { key: "remotePath", label: "Remote folder", placeholder: "/var/www/html" }, { key: "keyFile", label: "SSH key file (optional)" }, { key: "to", label: "Mail to (SMTP only)" }, { key: "publicUrl", label: "Public address of the site (optional)" }] },
  { id: "cloudflare", label: "Cloudflare Pages", unavailable: "Cloudflare's direct-upload API needs BLAKE3 file hashing and does not allow calls from web pages. Use GitHub Pages or Netlify, or connect the repository exported from Source Control to Cloudflare Pages.", fields: [] },
];

export const targetById = (id) => TARGETS.find((t) => t.id === id) || null;

/** Runs a deploy for a target kind. */
export function deploy(kind, ctx) {
  const t = targetById(kind);
  if (!t) throw new PublishError(`Unknown publish target “${kind}”.`, "BAD_CONFIG");
  if (t.unavailable) throw new PublishError(t.unavailable, "UNAVAILABLE");
  return t.deploy(ctx);
}

export { urlPath };
