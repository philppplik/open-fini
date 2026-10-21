import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest, normalizeOrigin, permissionError, checkPackageFiles, describePermission } from "../../app/src/extensions/manifest.js";

const base = () => ({
  id: "acme.grid-tools",
  name: "Grid Tools",
  version: "1.0.0",
  description: "Makes grids.",
  engines: { openfini: ">=0.3.0" },
  main: "main.js",
  permissions: ["document.write", "ui", "network:https://api.example.com"],
  contributes: {
    commands: [{ id: "grid.make", title: "Make Grid", studios: ["vector"] }],
    menus: [{ menu: "Shape", command: "grid.make" }],
    keybindings: [{ command: "grid.make", key: "Mod+Alt+G" }],
  },
});

test("a complete manifest validates and is normalized", () => {
  const r = validateManifest(base(), { hostVersion: "0.3.0" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.manifest.publisher, "acme");
  assert.ok(r.manifest.activationEvents.includes("onCommand:grid.make"));
  assert.equal(r.manifest.contributes.panels.length, 0);
});

test("errors name the field and explain the fix", () => {
  const bad = base();
  bad.id = "Bad Id";
  bad.version = "1";
  bad.engines = {};
  bad.permissions = ["root", "network:http://evil.example"];
  bad.contributes.menus = [{ menu: "Nope", command: "x" }];
  const r = validateManifest(bad);
  const msgs = r.errors.map((e) => e.message).join("\n");
  assert.match(msgs, /id: must look like publisher\.name/);
  assert.match(msgs, /version: must be a semantic version/);
  assert.match(msgs, /engines\.openfini: is required/);
  assert.match(msgs, /permissions\[0\]: unknown permission “root”/);
  assert.match(msgs, /permissions\[1\].*plain http is only allowed for localhost/);
  assert.match(msgs, /contributes\.menus\[0\]\.menu: must be one of/);
  assert.equal(r.ok, false);
  assert.equal(r.manifest, null);
});

test("rejects an extension for a different OpenFini version", () => {
  const r = validateManifest({ ...base(), engines: { openfini: "^2.0.0" } }, { hostVersion: "0.3.0" });
  assert.match(r.errors[0].message, /needs OpenFini \^2\.0\.0, but you are running 0\.3\.0/);
});

test("commands need main; menus and keybindings must reference declared commands", () => {
  const b = base();
  delete b.main;
  assert.match(validateManifest(b).errors[0].message, /main: is required/);
  const c = base();
  c.contributes.keybindings = [{ command: "missing", key: "Mod+K" }, { command: "grid.make", key: "ctrl+k" }];
  const msgs = validateManifest(c).errors.map((e) => e.message).join("\n");
  assert.match(msgs, /“missing” is not declared/);
  assert.match(msgs, /not a valid shortcut/);
});

test("themes need both modes and only plain CSS values", () => {
  const b = base();
  b.contributes = { themes: [{ id: "ink", label: "Ink", dark: { "--of-bg-app": "#000" }, light: { "--of-bg-app": "url(http://x/y.png)" } }] };
  const msgs = validateManifest(b).errors.map((e) => e.message).join("\n");
  assert.match(msgs, /not a plain CSS value/);
  b.contributes.themes[0].light = { "--of-bg-app": "#fff" };
  b.contributes.themes[0].dark.color = "red";
  assert.match(validateManifest(b).errors[0].message, /must start with --of- or --sl-/);
  delete b.contributes.themes[0].dark.color;
  delete b.contributes.themes[0].light;
  assert.match(validateManifest(b).errors[0].message, /both a "dark" and a "light"/);
});

test("vibe tools need the vibe permission and a sane schema", () => {
  const b = base();
  b.contributes.vibeTools = [{ name: "make_grid", description: "Makes a grid of rectangles.", inputSchema: { type: "object", properties: { n: { type: "number" } } } }];
  assert.match(validateManifest(b).errors.map((e) => e.message).join(), /"vibe" permission/);
  b.permissions.push("vibe");
  assert.equal(validateManifest(b).ok, true);
  b.contributes.vibeTools[0].inputSchema = { type: "string" };
  assert.match(validateManifest(b).errors[0].message, /must be “object”/);
});

test("unknown fields only warn; activation events are checked", () => {
  const b = base();
  b.foo = 1;
  b.activationEvents = ["onStartup", "onSomething"];
  const r = validateManifest(b);
  assert.ok(r.warnings.some((w) => /foo/.test(w.message)));
  assert.match(r.errors[0].message, /activationEvents\[1\]/);
});

test("origins and permission strings", () => {
  assert.equal(normalizeOrigin("HTTPS://API.Example.com"), "https://api.example.com");
  assert.equal(normalizeOrigin("https://*.example.com"), "https://*.example.com");
  assert.equal(normalizeOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeOrigin("http://example.com"), null);
  assert.equal(normalizeOrigin("https://example.com/path"), null);
  assert.equal(permissionError("storage"), null);
  assert.match(permissionError("network:ftp://x"), /use network:https/);
  assert.equal(describePermission("network:https://a.b").risk, "high");
});

test("referenced files must exist in the package", () => {
  const m = validateManifest({ ...base(), contributes: { panels: [{ id: "p", title: "P", html: "panel.html" }] } }).manifest;
  assert.deepEqual(checkPackageFiles(m, ["main.js"]), ["The manifest refers to “panel.html”, but the package has no such file."]);
  assert.deepEqual(checkPackageFiles(m, ["main.js", "panel.html"]), []);
});
