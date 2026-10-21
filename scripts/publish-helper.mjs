// Publish helper: a small local program that lets OpenFini upload a website to a server over FTP, FTPS, SFTP or rsync,
// or mail it as a ZIP over SMTP. Browsers and the desktop webview cannot open raw TCP connections, so these protocols
// need a helper process. It has no dependencies (Node 20+), uses Node's own net/tls for FTP and SMTP and the system
// ssh tools (sftp, rsync) for key-based SSH.
//
//   npm run publish:helper                      # prints the address and a token
//   npm run publish:helper -- --port 4310 --token secret --origin https://my.app.example
//
// Then add the address and token in OpenFini ▸ Publish ▸ Server (FTP/SFTP/rsync/SMTP).
//
// Safety: listens on 127.0.0.1 only, accepts browser requests only from allowed origins (localhost, the hosted app, the
// desktop app; add more with --origin), requires a bearer token, handles one upload at a time, validates every file name
// and host name, never uses a shell, and never stores passwords (they arrive with each request and stay in memory).
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "../app/vendor/fflate/fflate.js";

const DEFAULT_ORIGINS = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, /^https:\/\/philppplik\.github\.io$/, /^tauri:\/\/localhost$/, /^https?:\/\/tauri\.localhost$/];
const MAX_BODY = 256 * 1024 * 1024;
const MAX_FILES = 20000;

export const originAllowed = (origin, extra = []) => !origin || extra.includes(origin) || DEFAULT_ORIGINS.some((re) => re.test(origin));

// ------------------------------------------------------------------ validation

export class HelperError extends Error {}

/** Checks the ZIP entries of a site: relative, no "..", no control characters. Returns [{ path, bytes }]. */
export function safeEntries(zipBytes) {
  let entries;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new HelperError("The upload is not a valid ZIP file.");
  }
  const out = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    if (/[\x00-\x1f\\]/.test(name) || name.startsWith("/") || name.split("/").some((p) => p === ".." || p === "." || p === "")) throw new HelperError(`Unsafe file name in the upload: ${JSON.stringify(name.slice(0, 80))}`);
    out.push({ path: name, bytes });
  }
  if (out.length > MAX_FILES) throw new HelperError("Too many files in one upload.");
  return out;
}

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._@-]{0,63}$/;

/** Validates and normalizes the target description sent by the app. */
export function validateTarget(t) {
  if (!t || typeof t !== "object") throw new HelperError("Missing target.");
  const protocol = String(t.protocol || "");
  if (!["ftp", "ftps", "sftp", "rsync", "smtp"].includes(protocol)) throw new HelperError("Unknown protocol.");
  const host = String(t.host || "").trim();
  if (!HOST_RE.test(host)) throw new HelperError("That is not a valid host name.");
  const port = t.port == null || t.port === "" ? undefined : Number(t.port);
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new HelperError("That is not a valid port.");
  const user = t.user ? String(t.user) : "";
  if (user && !USER_RE.test(user)) throw new HelperError("That is not a valid user name.");
  const remotePath = String(t.remotePath || "").trim();
  if (/[\x00-\x1f]/.test(remotePath) || remotePath.split("/").includes("..") || remotePath.length > 1024) throw new HelperError("That is not a valid remote folder.");
  const keyFile = t.keyFile ? String(t.keyFile) : "";
  if (keyFile && (keyFile.startsWith("-") || /[\x00-\x1f]/.test(keyFile))) throw new HelperError("That is not a valid key file path.");
  const out = { protocol, host, port, user, password: t.password ? String(t.password) : "", remotePath, keyFile, strictHostKey: t.strictHostKey === true || t.strictHostKey === "strict", secure: t.secure };
  if (protocol === "smtp") {
    const addr = (a) => (/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(String(a || "")) ? String(a) : null);
    out.to = addr(t.to);
    out.from = addr(t.from) || addr(user) || "openfini@localhost";
    if (!out.to) throw new HelperError("Enter a valid recipient address.");
    out.subject = String(t.subject || "Website from OpenFini").replace(/[\r\n]+/g, " ").slice(0, 200);
    out.name = String(t.name || "site").replace(/[^\w.-]+/g, "_").slice(0, 80) || "site";
  }
  return out;
}

const cleanPath = (p) => {
  if (/[\r\n\x00]/.test(p)) throw new HelperError("Unsafe path.");
  return p;
};

// ------------------------------------------------------------------ line-based socket client (FTP and SMTP)

class LineSocket {
  constructor(socket) {
    this.setSocket(socket);
    this.queue = [];
    this.waiters = [];
    this.error = null;
  }
  setSocket(socket) {
    this.socket = socket;
    this.buf = "";
    socket.setEncoding?.("latin1");
    socket.on("data", (c) => {
      this.buf += typeof c === "string" ? c : c.toString("latin1");
      for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
        this.push(this.buf.slice(0, i).replace(/\r$/, ""));
        this.buf = this.buf.slice(i + 1);
      }
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.fail(new HelperError("The server closed the connection.")));
  }
  push(line) {
    const w = this.waiters.shift();
    if (w) w.resolve(line);
    else this.queue.push(line);
  }
  fail(e) {
    this.error ||= e;
    for (const w of this.waiters.splice(0)) w.reject(e);
  }
  line(timeout = 30000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new HelperError("The server did not answer in time.")), timeout);
      this.waiters.push({ resolve: (l) => (clearTimeout(t), resolve(l)), reject: (e) => (clearTimeout(t), reject(e)) });
    });
  }
  /** Reads one (possibly multi-line) reply: { code, text }. */
  async reply() {
    let first = await this.line();
    const m = /^(\d{3})([ -])/.exec(first);
    if (!m) throw new HelperError(`Unexpected server reply: ${first.slice(0, 80)}`);
    let text = first.slice(4);
    if (m[2] === "-") {
      for (;;) {
        const l = await this.line();
        text += `\n${l.slice(4)}`;
        if (l.startsWith(`${m[1]} `)) break;
      }
    }
    return { code: Number(m[1]), text };
  }
  write(s) {
    this.socket.write(s, "latin1");
  }
  async cmd(line, ok) {
    this.write(`${cleanPath(line)}\r\n`);
    const r = await this.reply();
    if (ok && !ok.includes(Math.floor(r.code / 100)) && !ok.includes(r.code)) throw new HelperError(`${line.split(" ")[0]} failed: ${r.code} ${r.text.split("\n")[0].slice(0, 120)}`);
    return r;
  }
  upgrade(servername, opts = {}) {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("close");
      this.socket.removeAllListeners("error");
      const s = tls.connect({ socket: this.socket, servername: net.isIP(servername) ? undefined : servername, ...opts }, () => {
        this.setSocket(s);
        resolve();
      });
      s.once("error", reject);
    });
  }
}

const connect = (host, port, secure, tlsOpts = {}) =>
  new Promise((resolve, reject) => {
    const h = host.replace(/^\[|\]$/g, "");
    const s = secure ? tls.connect({ host: h, port, servername: net.isIP(h) ? undefined : h, ...tlsOpts }, () => resolve(s)) : net.connect({ host: h, port }, () => resolve(s));
    s.setTimeout(60000, () => s.destroy(new HelperError("Connection timed out.")));
    s.once("error", reject);
  });

// ------------------------------------------------------------------ FTP / FTPS

/**
 * Uploads files with FTP (passive mode). `secure`: false | "explicit" (AUTH TLS) | "implicit".
 * @param {{ host: string, port?: number, user?: string, password?: string, secure?: false | "explicit" | "implicit", remotePath?: string, tlsOptions?: object }} t
 * @param {{ path: string, bytes: Uint8Array }[]} files
 */
export async function ftpUpload(t, files, { onProgress = () => {}, signal } = {}) {
  const secure = t.secure || (t.protocol === "ftps" ? "explicit" : false);
  const port = t.port || (secure === "implicit" ? 990 : 21);
  const tlsOptions = t.tlsOptions || {};
  const ctl = new LineSocket(await connect(t.host, port, secure === "implicit", tlsOptions));
  const abort = () => ctl.socket.destroy(new Error("Cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    let r = await ctl.reply();
    if (r.code !== 220) throw new HelperError(`The server did not accept the connection: ${r.code} ${r.text.slice(0, 80)}`);
    if (secure === "explicit") {
      await ctl.cmd("AUTH TLS", [2]);
      await ctl.upgrade(t.host.replace(/^\[|\]$/g, ""), tlsOptions);
    }
    r = await ctl.cmd(`USER ${t.user || "anonymous"}`, [2, 3]);
    if (r.code === 331) await ctl.cmd(`PASS ${t.password || "openfini@localhost"}`, [2]);
    if (secure) {
      await ctl.cmd("PBSZ 0", [2]);
      await ctl.cmd("PROT P", [2]);
    }
    await ctl.cmd("TYPE I", [2]);
    const made = new Set();
    const mkdirs = async (dir) => {
      const parts = dir.split("/").filter(Boolean);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        if (made.has(acc)) continue;
        made.add(acc);
        await ctl.cmd(`MKD ${acc}`); // 550 when it exists; any other failure shows up at STOR
      }
    };
    if (t.remotePath && t.remotePath !== "/" && t.remotePath !== ".") {
      const abs = t.remotePath.startsWith("/");
      if (abs) await ctl.cmd("CWD /");
      const parts = t.remotePath.split("/").filter(Boolean);
      for (const p of parts) {
        const c = await ctl.cmd(`CWD ${p}`);
        if (c.code >= 400) {
          await ctl.cmd(`MKD ${p}`, [2]);
          await ctl.cmd(`CWD ${p}`, [2]);
        }
      }
    }
    let n = 0;
    for (const f of files) {
      if (signal?.aborted) throw new Error("Cancelled");
      await mkdirs(f.path.split("/").slice(0, -1).join("/"));
      let dp = null;
      const e = await ctl.cmd("EPSV");
      if (e.code === 229) dp = Number(/\(\|\|\|(\d+)\|\)/.exec(e.text)?.[1]);
      else {
        const p = await ctl.cmd("PASV", [2]);
        const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(p.text);
        if (!m) throw new HelperError("The server sent an unreadable passive-mode reply.");
        dp = Number(m[5]) * 256 + Number(m[6]);
      }
      if (!dp) throw new HelperError("The server did not offer a data port.");
      // always connect to the control host: ignores the address in PASV (prevents FTP bounce attacks)
      const data = await connect(t.host, dp, !!secure, { ...tlsOptions, session: ctl.socket.getSession?.() });
      const st = await ctl.cmd(`STOR ${f.path}`);
      if (st.code >= 400) {
        data.destroy();
        throw new HelperError(`Could not upload ${f.path}: ${st.code} ${st.text.slice(0, 100)}`);
      }
      await new Promise((resolve, reject) => {
        data.once("error", reject);
        data.end(Buffer.from(f.bytes), resolve);
      });
      const done = await ctl.reply();
      if (done.code >= 400) throw new HelperError(`The server rejected ${f.path}: ${done.code} ${done.text.slice(0, 100)}`);
      onProgress({ text: `Uploaded ${f.path}`, done: ++n, total: files.length });
    }
    try {
      await ctl.cmd("QUIT");
    } catch {
      /* closing is best effort */
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    ctl.socket.destroy();
  }
}

// ------------------------------------------------------------------ SMTP

/** Mails `zipBytes` as an attachment. `secure`: "implicit" (465), "starttls" (default) or false. */
export async function smtpSend(t, zipBytes, { onProgress = () => {}, signal } = {}) {
  const implicit = t.secure === "implicit" || t.port === 465;
  const port = t.port || (implicit ? 465 : 587);
  const tlsOptions = t.tlsOptions || {};
  const c = new LineSocket(await connect(t.host, port, implicit, tlsOptions));
  signal?.addEventListener("abort", () => c.socket.destroy(new Error("Cancelled")), { once: true });
  try {
    let r = await c.reply();
    if (r.code !== 220) throw new HelperError(`The mail server did not accept the connection: ${r.code}`);
    const hello = async () => (await c.cmd("EHLO openfini.local", [2])).text;
    let caps = await hello();
    if (!implicit && t.secure !== false) {
      if (/STARTTLS/i.test(caps)) {
        await c.cmd("STARTTLS", [2]);
        await c.upgrade(t.host.replace(/^\[|\]$/g, ""), tlsOptions);
        caps = await hello();
      } else if (!/^(127\.|localhost|\[::1\])/.test(t.host)) throw new HelperError("The mail server does not offer STARTTLS, so the password would travel unencrypted. Nothing was sent.");
    }
    if (t.user) {
      const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
      if (/AUTH[^\n]*PLAIN/i.test(caps)) await c.cmd(`AUTH PLAIN ${b64(`\0${t.user}\0${t.password}`)}`, [2]);
      else if (/AUTH[^\n]*LOGIN/i.test(caps)) {
        await c.cmd("AUTH LOGIN", [3]);
        await c.cmd(b64(t.user), [3]);
        await c.cmd(b64(t.password), [2]);
      } else throw new HelperError("The mail server offers no supported login method (PLAIN or LOGIN).");
    }
    await c.cmd(`MAIL FROM:<${t.from}>`, [2]);
    await c.cmd(`RCPT TO:<${t.to}>`, [2]);
    await c.cmd("DATA", [3]);
    const boundary = `=_openfini_${randomBytes(8).toString("hex")}`;
    const b64 = Buffer.from(zipBytes).toString("base64").replace(/(.{76})/g, "$1\r\n");
    const msg = [`From: <${t.from}>`, `To: <${t.to}>`, `Subject: ${t.subject}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "", "The website is attached as a ZIP file (sent from OpenFini).", "", `--${boundary}`, `Content-Type: application/zip; name="${t.name}.zip"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${t.name}.zip"`, "", b64, `--${boundary}--`, ""].join("\r\n");
    c.write(`${msg.replace(/^\./gm, "..")}\r\n.\r\n`);
    r = await c.reply();
    if (r.code >= 400) throw new HelperError(`The mail server rejected the message: ${r.code} ${r.text.slice(0, 100)}`);
    onProgress({ text: `Mail sent to ${t.to}`, done: 1, total: 1 });
    try {
      await c.cmd("QUIT");
    } catch {
      /* best effort */
    }
  } finally {
    c.socket.destroy();
  }
}

// ------------------------------------------------------------------ SFTP and rsync (system ssh tools, key authentication)

const q = (s) => {
  if (/["\r\n\x00]/.test(s)) throw new HelperError("A file name contains a character that cannot be used with SFTP.");
  return `"${s}"`;
};

/** The sftp batch file for uploading `files` from `localDir` into `remotePath`. */
export function buildSftpBatch(files, localDir, remotePath) {
  const base = remotePath.replace(/\/+$/, "");
  const dirs = new Set();
  const lines = [];
  if (base) {
    let acc = base.startsWith("/") ? "" : ".";
    for (const p of base.split("/").filter(Boolean)) {
      acc = acc === "" ? `/${p}` : `${acc}/${p}`;
      lines.push(`-mkdir ${q(acc)}`);
    }
  }
  const join2 = (a, b) => (a ? `${a}/${b}` : b);
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = join2(base, parts.slice(0, i).join("/"));
      if (!dirs.has(d)) {
        dirs.add(d);
        lines.push(`-mkdir ${q(d)}`);
      }
    }
  }
  for (const f of files) lines.push(`put ${q(`${localDir}/${f.path}`)} ${q(join2(base, f.path))}`);
  return `${lines.join("\n")}\n`;
}

function run(cmd, args, { input, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
    let err = "";
    p.on("error", (e) => reject(e.code === "ENOENT" ? new HelperError(`“${cmd}” was not found on this computer. Install the OpenSSH client${cmd === "rsync" ? " and rsync" : ""} and try again.`) : e));
    for (const s of [p.stdout, p.stderr]) {
      s.setEncoding("utf8");
      s.on("data", (d) => {
        if (s === p.stderr) err += d;
        for (const l of d.split(/\r?\n/)) if (l.trim()) onLine?.(l.trim());
      });
    }
    signal?.addEventListener("abort", () => p.kill(), { once: true });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new HelperError(`${cmd} failed (exit ${code}). ${err.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`))));
    p.stdin.on("error", () => {});
    p.stdin.end(input || "");
  });
}

function sshOpts(t) {
  const o = ["-o", "BatchMode=yes", "-o", `StrictHostKeyChecking=${t.strictHostKey ? "yes" : "accept-new"}`, "-o", "ConnectTimeout=20"];
  if (t.keyFile) o.push("-i", t.keyFile, "-o", "IdentitiesOnly=yes");
  return o;
}

export async function sftpUpload(t, files, { onProgress = () => {}, signal, bin = "sftp" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openfini-pub-"));
  try {
    for (const f of files) {
      const p = join(dir, f.path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, f.bytes);
    }
    const local = dir.replace(/\\/g, "/");
    const batch = buildSftpBatch(files, local, t.remotePath);
    const args = [...sshOpts(t), ...(t.port ? ["-P", String(t.port)] : []), "-b", "-", `${t.user ? `${t.user}@` : ""}${t.host}`];
    let n = 0;
    await run(bin, args, { input: batch, signal, onLine: (l) => /^Uploading /.test(l) && onProgress({ text: l.slice(0, 120), done: ++n, total: files.length }) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function rsyncUpload(t, files, { onProgress = () => {}, signal, bin = "rsync" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openfini-pub-"));
  try {
    for (const f of files) {
      const p = join(dir, f.path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, f.bytes);
    }
    const ssh = ["ssh", ...sshOpts(t), ...(t.port ? ["-p", String(t.port)] : [])].map((s) => (/\s/.test(s) ? `'${s}'` : s)).join(" ");
    const dest = `${t.user ? `${t.user}@` : ""}${t.host}:${t.remotePath.replace(/\/+$/, "") || "."}/`;
    await run(bin, ["-az", "--protect-args", "-e", ssh, `${dir.replace(/\\/g, "/")}/`, dest], { signal, onLine: (l) => onProgress({ text: l.slice(0, 120) }) });
    onProgress({ text: `Synced ${files.length} files`, done: files.length, total: files.length });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function which(cmd) {
  try {
    await run(process.platform === "win32" ? "where" : "which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ HTTP server

/**
 * @param {{ port?: number, host?: string, token?: string, origins?: string[], log?: (s: string) => void, upload?: object }} o
 *   `upload` overrides the protocol functions (tests).
 */
export function createHelper({ port = 4310, host = "127.0.0.1", token = randomBytes(18).toString("base64url"), origins = [], log = () => {}, upload = {} } = {}) {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("The publish helper only listens on the local machine (127.0.0.1).");
  const impl = { ftp: ftpUpload, ftps: ftpUpload, sftp: sftpUpload, rsync: rsyncUpload, smtp: smtpSend, ...upload };
  let busy = false;
  const tokenOk = (h) => {
    const m = /^Bearer (.+)$/.exec(h || "");
    if (!m) return false;
    const a = Buffer.from(m[1]);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && originAllowed(origin, origins) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Headers": "authorization, content-type, x-openfini-target", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600" } : {};
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };
    if (!originAllowed(origin, origins)) return send(403, { error: "This origin is not allowed. Start the helper with --origin <address>." });
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") {
      const bins = { sftp: await which("sftp"), rsync: await which("rsync") };
      return send(200, { ok: true, name: "openfini-publish-helper", protocols: { ftp: true, ftps: true, smtp: true, sftp: bins.sftp, rsync: bins.rsync } });
    }
    if (req.method !== "POST" || url.pathname !== "/publish") return send(404, { error: "Not found." });
    if (!tokenOk(req.headers.authorization)) return send(401, { error: "Wrong or missing token." });
    if (busy) return send(409, { error: "Another upload is running." });
    busy = true;
    const ac = new AbortController();
    res.on("close", () => !res.writableEnded && ac.abort());
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) throw new HelperError("The upload is larger than 256 MB.");
        chunks.push(c);
      }
      const header = req.headers["x-openfini-target"];
      if (!header) throw new HelperError("Missing target.");
      const target = validateTarget(JSON.parse(Buffer.from(String(header), "base64url").toString("utf8")));
      const zip = new Uint8Array(Buffer.concat(chunks));
      const files = safeEntries(zip);
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", ...cors });
      const emit = (o) => !res.writableEnded && res.write(`${JSON.stringify(o)}\n`);
      log(`upload: ${files.length} files via ${target.protocol} to ${target.host}`);
      const onProgress = (p) => emit({ type: "progress", ...p });
      if (target.protocol === "smtp") await impl.smtp({ ...target, secure: target.secure === "implicit" ? "implicit" : target.secure === false ? false : "starttls" }, zip, { onProgress, signal: ac.signal });
      else await impl[target.protocol]({ ...target, secure: target.protocol === "ftps" ? target.secure || "explicit" : false }, files, { onProgress, signal: ac.signal });
      emit({ type: "done", message: target.protocol === "smtp" ? `Mailed the site to ${target.to}.` : `Uploaded ${files.length} files to ${target.host}.` });
      res.end();
    } catch (err) {
      const msg = err instanceof HelperError || err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND" || err?.code?.startsWith?.("ERR_TLS") || err?.code === "CERT_HAS_EXPIRED" || err?.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ? friendly(err) : "The upload failed.";
      log(`error: ${msg}`);
      if (res.headersSent) {
        res.write(`${JSON.stringify({ type: "error", message: msg })}\n`);
        res.end();
      } else send(400, { error: msg });
    } finally {
      busy = false;
    }
  });
  return {
    server,
    token,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(`http://${host === "::1" ? "[::1]" : host}:${server.address().port}`))),
    close: () => new Promise((resolve) => (server.closeAllConnections?.(), server.close(() => resolve()))),
  };
}

function friendly(err) {
  if (err.code === "ECONNREFUSED") return "The server refused the connection. Check host and port.";
  if (err.code === "ENOTFOUND") return "The host name could not be found.";
  if (String(err.code).includes("CERT") || String(err.code).startsWith("ERR_TLS") || err.code === "DEPTH_ZERO_SELF_SIGNED_CERT") return `The server's certificate was not accepted (${err.code}).`;
  return err.message;
}

// ------------------------------------------------------------------ command line

function args(argv) {
  const o = { origins: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--token") o.token = argv[++i];
    else if (a === "--origin") o.origins.push(argv[++i]);
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = args(process.argv.slice(2));
    if (o.help) {
      console.log("Usage: node scripts/publish-helper.mjs [--port 4310] [--token <secret>] [--origin <https://app.example>]");
      process.exit(0);
    }
    const helper = createHelper({ port: o.port || 4310, token: o.token || process.env.OPENFINI_PUBLISH_TOKEN || undefined, origins: o.origins, log: (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`) });
    const url = await helper.listen();
    console.log(`OpenFini publish helper is running.\n  Address: ${url}\n  Token:   ${helper.token}\nAdd both in OpenFini ▸ Publish ▸ Server. Press Ctrl+C to stop.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
export { zipSync, fileURLToPath, access };
