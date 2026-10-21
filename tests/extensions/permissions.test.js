import test from "node:test";
import assert from "node:assert/strict";
import { checkPermission, hasPermission, originMatches, originOf, classifyTool, vibeToolName, findShortcutConflict, METHOD_PERMISSIONS } from "../../app/src/extensions/permissions.js";

test("flag permissions gate their methods", () => {
  assert.equal(checkPermission(["ui"], "ui.showMessage").ok, true);
  const r = checkPermission([], "ui.showMessage");
  assert.equal(r.ok, false);
  assert.equal(r.code, "PERMISSION_DENIED");
  assert.equal(r.needed, "ui");
  assert.match(r.message, /needs the “ui” permission/);
  assert.equal(checkPermission(["storage"], "storage.get").ok, true);
  assert.equal(checkPermission(["ui"], "storage.get").ok, false);
  assert.equal(checkPermission([], "studio.current").ok, true);
  assert.equal(checkPermission(["ui"], "studio.set").ok, true);
});

test("unknown methods are refused", () => {
  assert.equal(checkPermission(["ui"], "fs.readFile").code, "UNKNOWN_METHOD");
});

test("document.callTool needs read or write depending on the tool", () => {
  assert.equal(checkPermission(["document.read"], "document.callTool", {}, { toolKind: "read" }).ok, true);
  assert.equal(checkPermission(["document.read"], "document.callTool", {}, { toolKind: "write" }).ok, false);
  assert.equal(checkPermission(["document.write"], "document.callTool", {}, { toolKind: "write" }).ok, true);
});

test("network.fetch is checked per origin, with wildcards", () => {
  const g = ["network:https://api.example.com", "network:https://*.cdn.test"];
  assert.equal(checkPermission(g, "network.fetch", { url: "https://api.example.com/v1/x?y=1" }).ok, true);
  assert.equal(checkPermission(g, "network.fetch", { url: "https://evil.example.com/" }).ok, false);
  assert.equal(checkPermission(g, "network.fetch", { url: "http://api.example.com/" }).ok, false);
  assert.equal(checkPermission(g, "network.fetch", { url: "https://a.b.cdn.test/x" }).ok, true);
  assert.equal(checkPermission(g, "network.fetch", { url: "https://cdn.test/x" }).ok, false);
  assert.equal(checkPermission(g, "network.fetch", { url: "javascript:alert(1)" }).code, "BAD_REQUEST");
  assert.equal(originOf("not a url"), null);
  assert.ok(originMatches("https://*.example.com", "https://x.example.com"));
  assert.ok(!originMatches("https://*.example.com", "https://example.com.evil.net"));
  assert.ok(hasPermission(new Set(["network:http://localhost:3000"]), "network:http://localhost:3000"));
});

test("events: document events need document.read", () => {
  assert.equal(checkPermission([], "events.subscribe", { event: "studioChanged" }).ok, true);
  assert.equal(checkPermission([], "events.subscribe", { event: "documentChanged" }).ok, false);
  assert.equal(checkPermission(["document.read"], "events.subscribe", { event: "selectionChanged" }).ok, true);
  assert.equal(checkPermission(["document.read"], "events.subscribe", { event: "bogus" }).code, "BAD_REQUEST");
});

test("every method is mapped", () => {
  for (const [m, p] of Object.entries(METHOD_PERMISSIONS)) assert.equal(typeof p, "string", m);
});

test("tool classification keeps assistant internals and networked tools away from extensions", () => {
  assert.equal(classifyTool({ name: "add_shape" }), "write");
  assert.equal(classifyTool({ name: "list_layers", readOnly: true }), "read");
  for (const n of ["generate_image", "create_tool", "install_extension_from_url", "ext_a_b_c", "mcp_x_y"]) assert.equal(classifyTool({ name: n }), "denied", n);
  assert.equal(classifyTool(null), "denied");
});

test("vibe tool names are prefixed, valid and at most 64 characters", () => {
  assert.equal(vibeToolName("acme.grid-tools", "make_grid"), "ext_acme_grid_tools_make_grid");
  const long = vibeToolName(`${"a".repeat(30)}.${"b".repeat(40)}`, "some_tool_name");
  assert.ok(long.length <= 64);
  assert.match(long, /^ext_[a-z0-9_]+$/);
  assert.ok(long.endsWith("_some_tool_name"));
});

test("shortcut conflicts consider studio scopes", () => {
  const cmds = [{ id: "edit.undo", shortcut: "Mod+Z" }, { id: "code.format", shortcut: "Shift+Alt+F", studios: ["code"] }];
  assert.equal(findShortcutConflict(cmds, "mod+z", ["vector"]), "edit.undo");
  assert.equal(findShortcutConflict(cmds, "Shift+Alt+F", ["vector"]), null);
  assert.equal(findShortcutConflict(cmds, "Shift+Alt+F", undefined), "code.format");
  assert.equal(findShortcutConflict(cmds, "Mod+Alt+Q", undefined), null);
});
