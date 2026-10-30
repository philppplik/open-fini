// The desktop app's built-in network clients from the JS side: error parsing, trust on first use, base64, the FTP
// publish target with an injected native client, and the pure helpers of "Send by email" and the Node.js tool guide.
// The Rust side has its own unit tests (src-tauri/src/*.rs); real servers are not contacted here.
import test from "node:test";
import assert from "node:assert/strict";
import { parseNetError, withTrust, NativeNetError, bytesToBase64, nativeNetAvailable, invokeNet, relay } from "../../app/src/platform/native-net.js";
import { deployFtp, ftpTarget, targetById, deploy } from "../../app/src/engine/publish/targets.js";

const FP = "AB:".repeat(31) + "AB";

test("errors from the Rust side are classified", () => {
  assert.deepEqual(parseNetError(`UNTRUSTED_CERT:${FP}`).code, "UNTRUSTED_CERT");
  assert.equal(parseNetError(`CERT_CHANGED:${FP}`).fingerprint, FP);
  assert.equal(parseNetError("CANCELLED").code, "CANCELLED");
  const e = parseNetError("Sign-in failed: check the user name and password.");
  assert.equal(e.code, "ERROR");
  assert.match(e.message, /Sign-in failed/);
});

test("without the desktop app everything reports desktop only", async () => {
  assert.equal(nativeNetAvailable(), false);
  await assert.rejects(invokeNet("ftp_test", {}), (e) => e.code === "UNAVAILABLE" && /desktop app/.test(e.message));
  assert.equal(await relay.status(), null);
});

test("trust on first use: asks once, saves the fingerprint, retries with it", async () => {
  const pins = [];
  let saved = "";
  const run = async (pin) => {
    pins.push(pin);
    if (!pin) throw new NativeNetError("untrusted", "UNTRUSTED_CERT", FP);
    return "ok";
  };
  const asked = [];
  const out = await withTrust(run, { confirm: async (c) => (asked.push(c), true), save: (fp) => (saved = fp) });
  assert.equal(out, "ok");
  assert.deepEqual(pins, ["", FP]);
  assert.equal(saved, FP);
  assert.deepEqual(asked, [{ fingerprint: FP, changed: false }]);
  // declined: no retry, a clear error
  await assert.rejects(withTrust(run, { confirm: async () => false }), (e) => e.code === "NOT_TRUSTED");
  // a changed certificate is reported as such
  const changed = async () => {
    throw new NativeNetError("changed", "CERT_CHANGED", FP);
  };
  let flag;
  await assert.rejects(withTrust(changed, { pin: "old", confirm: async (c) => ((flag = c.changed), false) }));
  assert.equal(flag, true);
  // other errors pass through untouched
  await assert.rejects(withTrust(async () => { throw new Error("boom"); }, { confirm: async () => true }), /boom/);
});

test("base64 of large byte arrays", () => {
  const big = new Uint8Array(200000).map((_, i) => i & 255);
  assert.equal(Buffer.from(bytesToBase64(big), "base64").equals(Buffer.from(big)), true);
  assert.equal(bytesToBase64(new Uint8Array([102, 111, 111])), "Zm9v");
});

test("FTP target: desktop only, password from the vault, progress and pinned certificate", async () => {
  const t = targetById("ftp");
  assert.ok(t.desktopOnly && t.testable);
  assert.ok(targetById("sftp").unavailable);
  const files = [{ path: "index.html", bytes: new TextEncoder().encode("<h1>1</h1>") }];
  await assert.rejects(deploy("ftp", { files, config: { host: "x" }, secret: "pw" }), (e) => e.code === "UNAVAILABLE");
  await assert.rejects(deployFtp({ files, config: {}, secret: "pw", native: { ftpUpload: async () => "" } }), (e) => e.code === "BAD_CONFIG");
  await assert.rejects(deployFtp({ files, config: { host: "ftp.example.org", username: "me" }, secret: "", native: { ftpUpload: async () => "" } }), (e) => e.code === "NO_SECRET");
  const seen = [];
  const progress = [];
  const res = await deployFtp({
    files,
    config: { host: " ftp.example.org ", port: "2121", security: "explicit", username: "me", remotePath: "/www", pinnedCert: FP, publicUrl: "https://example.org/" },
    secret: "pw",
    onProgress: (p) => progress.push(p.text),
    native: {
      ftpUpload: async (target, f, opts) => {
        seen.push(target, f);
        opts.onProgress({ text: "Uploading index.html…", done: 0, total: 1 });
        return "Uploaded 1 files.";
      },
    },
  });
  assert.deepEqual(seen[0], { host: "ftp.example.org", port: 2121, security: "explicit", user: "me", password: "pw", remotePath: "/www", pinnedCert: FP });
  assert.equal(seen[1], files);
  assert.equal(res.url, "https://example.org/");
  assert.ok(progress.includes("Uploading index.html…"));
  assert.equal(ftpTarget({ host: "h" }).security, "explicit");
});

test("send by email and Node.js tool helpers", async () => {
  const { parseRecipients, smtpAccount, smtpTarget } = await import("../../app/src/ui/send-email.js");
  assert.deepEqual(parseRecipients("a@x.org, b@y.org; c@z.org  "), ["a@x.org", "b@y.org", "c@z.org"]);
  assert.equal(smtpAccount({}).security, "starttls");
  assert.deepEqual(smtpTarget({ host: " smtp.x.org ", port: "", security: "tls", user: "", pinnedCert: "" }, "pw"), { host: "smtp.x.org", port: null, security: "tls", user: null, password: "pw", pinnedCert: null });
  const { looksUnreachable, nodeToolSteps } = await import("../../app/src/ui/node-tools.js");
  assert.equal(looksUnreachable(new TypeError("Failed to fetch")), true);
  assert.equal(looksUnreachable({ code: "NETWORK", message: "x" }), true);
  assert.equal(looksUnreachable(new Error("401 Unauthorized")), false);
  const steps = nodeToolSteps("publish-helper");
  assert.ok(steps.some((s) => s.includes("npm run publish:helper")));
  assert.ok(steps.some((s) => s.includes("package.json")));
});
