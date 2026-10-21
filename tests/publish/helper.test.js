// The publish helper against fake FTP and SMTP servers (node net) and its HTTP interface.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createHelper, ftpUpload, smtpSend, safeEntries, validateTarget, buildSftpBatch, originAllowed } from "../../scripts/publish-helper.mjs";
import { zipSync, unzipSync } from "../../app/vendor/fflate/fflate.js";
import { readNdjson } from "../../app/src/engine/publish/targets.js";

const enc = new TextEncoder();
const siteZip = () => zipSync({ "index.html": enc.encode("<h1>hi</h1>"), "css/a.css": enc.encode("a{}"), "img/deep/x.bin": new Uint8Array([0, 1, 2, 255]) });

/** A tiny FTP server: passive mode, one data connection per transfer. */
function fakeFtp({ user = "me", pass = "pw" } = {}) {
  const files = new Map();
  const dirs = new Set(["/"]);
  const log = [];
  const open = new Set();
  const server = net.createServer((sock) => {
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    let cwd = "/";
    let authed = false;
    let name = null;
    let dataServer = null;
    let pending = null;
    const say = (s) => sock.write(`${s}\r\n`);
    say("220 fake ftp ready");
    const abs = (p) => (p.startsWith("/") ? p : `${cwd.replace(/\/$/, "")}/${p}`);
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const sp = line.indexOf(" ");
        const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
        const arg = sp < 0 ? "" : line.slice(sp + 1);
        log.push(cmd);
        if (cmd === "USER") {
          name = arg;
          say("331 password please");
        } else if (cmd === "PASS") {
          authed = name === user && arg === pass;
          say(authed ? "230 welcome" : "530 login incorrect");
        } else if (!authed) say("530 not logged in");
        else if (cmd === "TYPE") say("200 binary");
        else if (cmd === "CWD") {
          const t = arg === "/" ? "/" : abs(arg).replace(/\/$/, "");
          if (dirs.has(t)) {
            cwd = t;
            say("250 ok");
          } else say("550 no such directory");
        } else if (cmd === "MKD") {
          const t = abs(arg);
          if (dirs.has(t)) say("550 exists");
          else {
            dirs.add(t);
            say(`257 "${t}" created`);
          }
        } else if (cmd === "EPSV" || cmd === "PASV") {
          dataServer?.close();
          dataServer = net.createServer((ds) => {
            open.add(ds);
            const chunks = [];
            ds.on("data", (c) => chunks.push(c));
            ds.on("end", () => {
              files.set(pending, Buffer.concat(chunks));
              say("226 transfer complete");
            });
          });
          open.add(dataServer);
          dataServer.listen(0, "127.0.0.1", () => {
            const p = dataServer.address().port;
            if (cmd === "EPSV") say(`229 Entering Extended Passive Mode (|||${p}|)`);
            else say(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})`);
          });
        } else if (cmd === "STOR") {
          pending = abs(arg);
          say("150 go ahead");
        } else if (cmd === "QUIT") {
          say("221 bye");
          sock.end();
        } else say("502 not implemented");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, files, dirs, log, port: server.address().port, close: () => new Promise((r) => { for (const x of open) (x.destroy ? x.destroy() : x.close()); server.close(r); }) })));
}

function fakeSmtp({ user = "me", pass = "pw" } = {}) {
  const mails = [];
  const server = net.createServer((sock) => {
    let data = null;
    let from;
    let to;
    let auth = "";
    const say = (s) => sock.write(`${s}\r\n`);
    say("220 fake smtp");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (data !== null) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          mails.push({ from, to, auth, body: buf.slice(0, end) });
          buf = buf.slice(end + 5);
          data = null;
          say("250 queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO/i.test(line)) sock.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^AUTH PLAIN/i.test(line)) {
          auth = Buffer.from(line.slice(11), "base64").toString();
          say(auth === `\0${user}\0${pass}` ? "235 ok" : "535 bad");
        } else if (/^MAIL FROM/i.test(line)) {
          from = /<(.*)>/.exec(line)[1];
          say("250 ok");
        } else if (/^RCPT TO/i.test(line)) {
          to = /<(.*)>/.exec(line)[1];
          say("250 ok");
        } else if (/^DATA/i.test(line)) {
          data = "";
          say("354 go");
        } else if (/^QUIT/i.test(line)) {
          say("221 bye");
          sock.end();
        } else say("502 no");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, mails, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

test("FTP upload creates folders and stores every file", async () => {
  const ftp = await fakeFtp();
  try {
    const files = safeEntries(siteZip());
    const events = [];
    await ftpUpload({ host: "127.0.0.1", port: ftp.port, user: "me", password: "pw", remotePath: "/www/site" }, files, { onProgress: (e) => events.push(e) });
    assert.deepEqual([...ftp.files.keys()].sort(), ["/www/site/css/a.css", "/www/site/img/deep/x.bin", "/www/site/index.html"]);
    assert.equal(ftp.files.get("/www/site/index.html").toString(), "<h1>hi</h1>");
    assert.deepEqual([...ftp.files.get("/www/site/img/deep/x.bin")], [0, 1, 2, 255]);
    assert.equal(events.at(-1).done, 3);
  } finally {
    await ftp.close();
  }
});

test("FTP: wrong password and path injection are rejected", async () => {
  const ftp = await fakeFtp();
  try {
    await assert.rejects(() => ftpUpload({ host: "127.0.0.1", port: ftp.port, user: "me", password: "nope" }, [{ path: "a.txt", bytes: new Uint8Array(1) }]), /PASS failed: 530/);
    await assert.rejects(() => ftpUpload({ host: "127.0.0.1", port: ftp.port, user: "me", password: "pw" }, [{ path: "a\r\nDELE x", bytes: new Uint8Array(1) }]), /Unsafe path/);
    assert.ok(!ftp.log.includes("DELE"));
  } finally {
    await ftp.close();
  }
});

test("SMTP sends the ZIP as an attachment with AUTH PLAIN", async () => {
  const smtp = await fakeSmtp();
  try {
    const zip = siteZip();
    await smtpSend({ host: "127.0.0.1", port: smtp.port, secure: false, user: "me", password: "pw", from: "me@example.com", to: "you@example.com", subject: "Site", name: "site" }, zip);
    assert.equal(smtp.mails.length, 1);
    const m = smtp.mails[0];
    assert.equal(m.to, "you@example.com");
    assert.equal(m.auth, "\0me\0pw");
    const b64 = /Content-Disposition: attachment[^\r]*\r\n\r\n([\s\S]*?)\r\n--/.exec(m.body)[1].replace(/\r\n/g, "");
    assert.deepEqual(Object.keys(unzipSync(new Uint8Array(Buffer.from(b64, "base64")))).sort(), ["css/a.css", "img/deep/x.bin", "index.html"]);
    await assert.rejects(() => smtpSend({ host: "127.0.0.1", port: smtp.port, secure: false, user: "me", password: "bad", from: "a@b.c", to: "x@y.z", subject: "s", name: "s" }, zip), /AUTH failed: 535/);
  } finally {
    await smtp.close();
  }
});

test("helper HTTP: token, origin, streaming progress and cancellation of bad input", async () => {
  const ftp = await fakeFtp();
  const helper = createHelper({ port: 0, token: "secret", upload: {} });
  const base = await helper.listen();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const target = { protocol: "ftp", host: "127.0.0.1", port: ftp.port, user: "me", password: "pw", remotePath: "/pub" };
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    const pre = await fetch(`${base}/publish`, { method: "OPTIONS", headers: { Origin: "http://localhost:4173", "Access-Control-Request-Method": "POST" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:4173");
    assert.equal(pre.headers.get("access-control-allow-private-network"), "true");
    assert.equal((await fetch(`${base}/publish`, { method: "POST", headers: { Origin: "https://evil.example" }, body: siteZip() })).status, 403);
    assert.equal((await fetch(`${base}/publish`, { method: "POST", headers: { "X-OpenFini-Target": b64(target) }, body: siteZip() })).status, 401);
    assert.equal((await fetch(`${base}/publish`, { method: "POST", headers: { Authorization: "Bearer wrong", "X-OpenFini-Target": b64(target) }, body: siteZip() })).status, 401);
    const bad = await fetch(`${base}/publish`, { method: "POST", headers: { Authorization: "Bearer secret", "X-OpenFini-Target": b64({ ...target, host: "a b; rm -rf" }) }, body: siteZip() });
    assert.equal(bad.status, 400);
    const evil = await fetch(`${base}/publish`, { method: "POST", headers: { Authorization: "Bearer secret", "X-OpenFini-Target": b64(target) }, body: zipSync({ "../escape.txt": enc.encode("x") }) });
    assert.equal(evil.status, 400);
    assert.match((await evil.json()).error, /Unsafe file name/);
    const res = await fetch(`${base}/publish`, { method: "POST", headers: { Authorization: "Bearer secret", "X-OpenFini-Target": b64(target) }, body: siteZip() });
    assert.equal(res.status, 200);
    const events = [];
    const last = await readNdjson(res, (e) => events.push(e));
    assert.equal(last.type, "done");
    assert.ok(events.some((e) => e.type === "progress"));
    assert.ok(ftp.files.has("/pub/index.html"));
    // a failing upload reports an error event, not a crash
    const res2 = await fetch(`${base}/publish`, { method: "POST", headers: { Authorization: "Bearer secret", "X-OpenFini-Target": b64({ ...target, password: "bad" }) }, body: siteZip() });
    const last2 = res2.status === 200 ? await readNdjson(res2) : await res2.json();
    assert.match(last2.message || last2.error, /530/);
  } finally {
    await helper.close();
    await ftp.close();
  }
});

test("helper refuses to listen on a public address", () => {
  assert.throws(() => createHelper({ host: "0.0.0.0" }), /local machine/);
  assert.ok(originAllowed("http://localhost:3000") && !originAllowed("https://example.com") && originAllowed("https://example.com", ["https://example.com"]));
});

test("target validation and the SFTP batch", () => {
  assert.throws(() => validateTarget({ protocol: "sftp", host: "-oProxyCommand=x" }), /host/);
  assert.throws(() => validateTarget({ protocol: "sftp", host: "h", user: "-x" }), /user/);
  assert.throws(() => validateTarget({ protocol: "ftp", host: "h", remotePath: "../x" }), /remote folder/);
  assert.throws(() => validateTarget({ protocol: "smtp", host: "h", to: "nope" }), /recipient/);
  assert.equal(validateTarget({ protocol: "sftp", host: "example.com", user: "deploy", port: "2222", remotePath: "/var/www" }).port, 2222);
  const batch = buildSftpBatch([{ path: "index.html" }, { path: "css/a.css" }], "/tmp/x", "/var/www/site");
  assert.equal(batch, `-mkdir "/var"\n-mkdir "/var/www"\n-mkdir "/var/www/site"\n-mkdir "/var/www/site/css"\nput "/tmp/x/index.html" "/var/www/site/index.html"\nput "/tmp/x/css/a.css" "/var/www/site/css/a.css"\n`);
  assert.throws(() => buildSftpBatch([{ path: 'a"b.html' }], "/t", "/x"), /cannot be used/);
});
