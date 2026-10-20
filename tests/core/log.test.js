import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, redact, redactValue, groupKey, formatArgs, formatEntry, entriesToText } from "../../app/src/core/log.js";

const mk = (o = {}) => {
  let t = 1_700_000_000_000;
  const l = new Logger({ now: () => (t += 1000), ...o });
  l.tick = (ms) => (t += ms);
  return l;
};

test("redact: API keys, bearer tokens and provider key formats", () => {
  assert.equal(redact("key sk-proj-ABCDEFGH12345678abcd used"), "key [redacted-key] used");
  assert.equal(redact("sk-or-v1-abcdefghijklmnop1234567890"), "[redacted-key]");
  assert.match(redact("Authorization: Bearer abc.def.ghi-123456"), /Authorization: \[redacted\]/);
  assert.match(redact("curl -H 'Bearer abcdefghijklmnopqrstu'"), /Bearer \[redacted\]/);
  assert.equal(redact("AIzaSyA1234567890123456789012345678901"), "[redacted-key]");
  assert.equal(redact("token ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "token [redacted-key]");
  assert.equal(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk"), "[redacted-jwt]");
});

test("redact: URLs with credentials and token query parameters", () => {
  const s = redact("GET https://user:hunter2@api.example.com/v1/x?api_key=abc123&model=gpt&token=zzz&code=XY1 failed");
  assert.ok(!s.includes("hunter2") && !s.includes("abc123") && !s.includes("zzz") && !s.includes("XY1"), s);
  assert.ok(s.includes("api.example.com/v1/x") && s.includes("model=gpt"), s);
});

test("redact: name=value pairs, quoted JSON values with spaces", () => {
  assert.equal(redact('{"apiKey":"supersecret","password": "two words","name":"ok"}'), '{"apiKey":"[redacted]","password": "[redacted]","name":"ok"}');
  assert.equal(redact("passphrase=correct horse"), "passphrase=[redacted] horse");
  assert.equal(redact("status code: 404 and key: value"), "status code: 404 and key: value");
});

test("redact: home directories and e-mail addresses", () => {
  assert.equal(redact("C:\\Users\\Philipp Paulik\\Documents\\a.ofini"), "C:\\Users\\<user>\\Documents\\a.ofini");
  assert.equal(redact("C:\\Users\\bob failed to open x/y"), "C:\\Users\\<user> failed to open x/y");
  assert.equal(redact("C:\\Users\\philipp\\Documents\\a.ofini"), "C:\\Users\\<user>\\Documents\\a.ofini");
  assert.equal(redact("file:///C:/Users/philipp/x.txt"), "file:///C:/Users/<user>/x.txt");
  assert.equal(redact("/Users/anna/Library/x and /home/bob/.config"), "/Users/<user>/Library/x and /home/<user>/.config");
  assert.equal(redact("mail me at jane.doe+x@example.org please"), "mail me at [email] please");
});

test("redact: data URIs are shortened, ordinary text is untouched", () => {
  const uri = `data:image/png;base64,${"A".repeat(500)}`;
  assert.equal(redact(`img ${uri}`), "img data:[522 chars omitted]");
  const plain = "Autosave failed: QuotaExceededError (build 0.3.0-a7db4167) at chunk-AB12CD34.js:12:5";
  assert.equal(redact(plain), plain);
  assert.equal(redact(null), "");
  assert.equal(redact(42), "42");
});

test("redactValue blanks secret-looking properties and caps size and depth", () => {
  const v = redactValue({ apiKey: "sk-123456789012345678", nested: { token: "abc", note: "see sk-123456789012345678", deep: { a: { b: { c: 1 } } } }, list: Array.from({ length: 80 }, (_, i) => i), bytes: new Uint8Array(10) });
  assert.equal(v.apiKey, "[redacted]");
  assert.equal(v.nested.token, "[redacted]");
  assert.equal(v.nested.note, "see [redacted-key]");
  assert.equal(v.list.length, 51);
  assert.equal(v.bytes, "[binary 10 bytes]");
  assert.equal(v.nested.deep.a.b, "[object]");
  const circ = {};
  circ.self = circ;
  assert.equal(redactValue(circ).self, "[circular]");
});

test("formatArgs: errors, objects and redaction of the joined message", () => {
  assert.equal(formatArgs(["a", 1, null, true]), "a 1 null true");
  assert.equal(formatArgs([new TypeError("boom")]), "TypeError: boom");
  assert.equal(formatArgs([{ token: "x", n: 1 }]), '{"token":"[redacted]","n":1}');
  assert.ok(formatArgs(["x".repeat(5000)]).length <= 2001);
  assert.equal(formatArgs(["login with sk-abcdefghijklmnopqrst"]), "login with [redacted-key]");
});

test("ring buffer keeps only the newest entries", () => {
  const l = mk({ capacity: 5, minLevel: "debug" });
  for (let i = 0; i < 12; i++) l.info("t", `message ${i}`);
  const e = l.entries();
  assert.equal(e.length, 5);
  assert.equal(e[0].msg, "message 7");
  assert.equal(e[4].msg, "message 11");
  assert.equal(l.dropped > 0, true);
});

test("levels: minLevel filters, counters follow errors and warnings", () => {
  const l = mk();
  assert.equal(l.debug("a", "hidden"), null);
  l.info("a", "shown");
  l.warn("a", "w");
  l.error("a", "e1");
  l.error("a", "e2");
  assert.equal(l.entries().length, 4);
  assert.equal(l.errorCount, 2);
  assert.equal(l.warnCount, 1);
  assert.equal(l.unseen, 2);
  l.markSeen();
  assert.equal(l.unseen, 0);
  l.error("a", "e3");
  assert.equal(l.unseen, 1);
  l.minLevel = "debug";
  assert.ok(l.debug("a", "now shown"));
});

test("identical consecutive entries merge with a count, other entries do not", () => {
  const l = mk({ mergeWindow: 5000 });
  l.error("x", "same");
  l.error("x", "same");
  l.error("x", "same");
  assert.equal(l.entries().length, 1);
  assert.equal(l.entries()[0].count, 3);
  assert.equal(l.errorCount, 3);
  l.error("x", "other");
  l.error("x", "same");
  assert.equal(l.entries().length, 3);
  l.tick(60_000);
  l.error("x", "same");
  assert.equal(l.entries().length, 4, "outside the merge window a new entry starts");
});

test("filters: level, scope, search, since and limit", () => {
  const l = mk({ minLevel: "debug" });
  l.debug("net", "fetch started");
  l.info("ai", "chat started");
  l.warn("net", "slow response from Provider");
  l.error("ai", "request failed: 401");
  assert.deepEqual(l.entries({ level: "warn" }).map((e) => e.msg), ["slow response from Provider", "request failed: 401"]);
  assert.equal(l.entries({ scope: "ai" }).length, 2);
  assert.equal(l.entries({ scope: "ai,net" }).length, 4);
  assert.equal(l.entries({ scope: "all" }).length, 4);
  assert.equal(l.entries({ search: "PROVIDER" }).length, 1);
  assert.equal(l.entries({ limit: 2 }).length, 2);
  assert.equal(l.entries({ since: l.buffer[2].t })[0].msg, "slow response from Provider");
  assert.deepEqual(l.scopes(), ["ai", "net"]);
});

test("scoped logger, subscribe and clear", () => {
  const l = mk();
  const seen = [];
  const off = l.subscribe((e) => seen.push(e ? e.msg : "cleared"));
  const s = l.scope("storage");
  s.warn("full");
  s.error("failed", new Error("nope"));
  l.clear();
  off();
  l.warn("storage", "after");
  assert.deepEqual(seen, ["full", "failed Error: nope", "cleared"]);
  assert.equal(l.entries().length, 1);
  assert.equal(l.errorCount, 0);
});

test("secrets never reach the buffer, stacks are redacted and trimmed", () => {
  const l = mk();
  const err = new Error("request to https://x.test/a?token=SECRET123 failed");
  err.stack = `Error: request failed\n${Array.from({ length: 30 }, (_, i) => `    at fn${i} (C:\\Users\\jane\\app\\file${i}.js:1:1)`).join("\n")}`;
  const e = l.error("net", err, "key sk-abcdefghijklmnopqrstuv");
  assert.ok(!e.msg.includes("SECRET123") && !e.msg.includes("sk-abc"), e.msg);
  assert.ok(!e.stack.includes("jane"), e.stack);
  assert.equal(e.stack.split("\n").length, 12);
});

test("echo is called for warnings and errors only", () => {
  const l = mk({ minLevel: "debug" });
  const out = [];
  l.echo = (level, scope, msg) => out.push(`${level}:${scope}:${msg}`);
  l.debug("a", "d");
  l.info("a", "i");
  l.warn("a", "w");
  l.error("a", "e");
  assert.deepEqual(out, ["warn:a:w", "error:a:e"]);
});

test("previous-session entries are loaded, marked and kept apart", () => {
  const l = mk();
  assert.equal(l.loadPrevious([{ t: 1, level: "error", scope: "boot", msg: "old problem sk-abcdefghijklmnopqrst", count: 2 }, { bad: true }]), 1);
  l.error("app", "new");
  const all = l.entries();
  assert.equal(all.length, 2);
  assert.equal(all[0].prev, true);
  assert.equal(all[0].msg, "old problem [redacted-key]");
  assert.equal(l.entries({ previous: false }).length, 1);
  assert.equal(l.errorCount, 1, "earlier sessions do not count");
  assert.deepEqual(l.persistable().map((e) => e.msg), ["new"]);
  assert.match(formatEntry(all[0]), /previous session/);
});

test("persistable returns the newest errors without internals", () => {
  const l = mk();
  for (let i = 0; i < 70; i++) l.error("x", `error ${i}`);
  l.warn("x", "warning");
  const p = l.persistable(50);
  assert.equal(p.length, 50);
  assert.equal(p[49].msg, "error 69");
  assert.deepEqual(Object.keys(p[0]).sort(), ["count", "last", "level", "msg", "scope", "t"]);
});

test("groupKey merges messages that differ in numbers, ids and URLs", () => {
  assert.equal(groupKey("Failed to load https://a.test/x.js?v=1 (3 retries)"), groupKey("Failed to load https://b.test/y.js?v=2 (9 retries)"));
  assert.equal(groupKey("chunk-ABCD1234.js failed"), groupKey("chunk-WXYZ9876.js failed"));
  assert.notEqual(groupKey("disk full"), groupKey("network down"));
});

test("entriesToText renders one line per entry with stack frames indented", () => {
  const l = mk();
  const err = new Error("x");
  err.stack = "Error: x\n    at a (f.js:1:1)\n    at b (f.js:2:2)";
  l.error("app", err);
  l.warn("app", "careful");
  const text = entriesToText(l.entries());
  const lines = text.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /ERROR \[app\] Error: x/);
  assert.match(lines[1], /^ {4}at a/);
  assert.match(lines[3], /WARN {2}\[app\] careful/);
  assert.equal(entriesToText(l.entries(), { stack: false }).split("\n").length, 2);
});
