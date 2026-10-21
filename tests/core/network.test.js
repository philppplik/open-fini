import { test } from "node:test";
import assert from "node:assert/strict";
import { createNetwork, NetworkBlockedError, NETWORK_KINDS, isLoopbackUrl, blockedMessage, withOfflinePreviewCsp, OFFLINE_PREVIEW_CSP } from "../../app/src/core/network.js";

test("online: every kind is allowed and nothing is reported", () => {
  const blocked = [];
  const net = createNetwork(() => false, { onBlocked: (i) => blocked.push(i) });
  for (const k of Object.keys(NETWORK_KINDS)) assert.equal(net.allowed(k), true);
  assert.doesNotThrow(() => net.assert("ai"));
  assert.equal(net.offline, false);
  assert.deepEqual(blocked, []);
});

test("offline: every kind is refused, assert throws a readable NetworkBlockedError", () => {
  const net = createNetwork(() => true);
  for (const k of Object.keys(NETWORK_KINDS)) {
    assert.equal(net.allowed(k), false, k);
    assert.throws(() => net.assert(k), (e) => e instanceof NetworkBlockedError && e.code === "offline_mode" && e.kind === k && /Offline mode is on/.test(e.message));
  }
  assert.equal(net.offline, true);
});

test("an unknown kind is treated as 'other' and blocked offline", () => {
  const net = createNetwork(() => true);
  assert.equal(net.allowed("telemetry"), false);
  assert.throws(() => net.assert("telemetry"), (e) => e.kind === "other");
});

test("the preference is read on every call", () => {
  let offline = false;
  const net = createNetwork(() => offline);
  assert.equal(net.allowed("ai"), true);
  offline = true;
  assert.equal(net.allowed("ai"), false);
  offline = false;
  assert.equal(net.allowed("ai"), true);
});

test("loopback addresses stay reachable offline; look-alikes do not", () => {
  const net = createNetwork(() => true);
  for (const u of ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://[::1]:8080/x", "ws://127.0.0.1:3000", "http://app.localhost/"]) {
    assert.equal(isLoopbackUrl(u), true, u);
    assert.equal(net.allowed("ai", u), true, u);
  }
  for (const u of ["https://api.openai.com/v1", "http://localhost.evil.com/", "http://127.0.0.1.evil.com/", "http://10.0.0.5/", "not a url", "", undefined]) {
    assert.equal(isLoopbackUrl(u), false, String(u));
    assert.equal(net.allowed("ai", u), false, String(u));
  }
});

test("onBlocked reports the kind and url of refused checks only", () => {
  const seen = [];
  const net = createNetwork(() => true, { onBlocked: (i) => seen.push(i) });
  net.allowed("publish", "https://example.com");
  net.allowed("ai", "http://localhost:1");
  assert.deepEqual(seen, [{ kind: "publish", url: "https://example.com" }]);
  const boom = createNetwork(() => true, { onBlocked: () => { throw new Error("log failed"); } });
  assert.equal(boom.allowed("ai"), false, "a failing logger does not change the answer");
});

test("blockedMessage names the feature and where to switch it off", () => {
  assert.match(blockedMessage("update"), /update checks/);
  assert.match(blockedMessage("ai"), /AI providers and MCP servers/);
  assert.match(blockedMessage("nope"), /other network access/);
  assert.match(blockedMessage("ai"), /Settings/);
});

test("offline preview CSP is inserted into head, after doctype, or in front", () => {
  assert.equal(withOfflinePreviewCsp("<html><head></head></html>", false), "<html><head></head></html>");
  const a = withOfflinePreviewCsp('<!doctype html><html><head lang="en"><title>x</title></head><body></body></html>', true);
  assert.ok(a.includes(`<head lang="en"><meta http-equiv="Content-Security-Policy" content="${OFFLINE_PREVIEW_CSP}"><title>`), a);
  const b = withOfflinePreviewCsp("<!DOCTYPE html><body>hi</body>", true);
  assert.ok(b.startsWith("<!DOCTYPE html><head><meta http-equiv"), b);
  const c = withOfflinePreviewCsp("<p>fragment</p>", true);
  assert.ok(c.startsWith("<head><meta"), c);
  assert.equal(withOfflinePreviewCsp(a, true), a, "idempotent");
  assert.ok(/connect-src 'none'/.test(OFFLINE_PREVIEW_CSP) && !/https?:/.test(OFFLINE_PREVIEW_CSP));
});
