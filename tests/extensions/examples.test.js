import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest, checkPackageFiles } from "../../app/src/extensions/manifest.js";
import { readFolder } from "../../sdk/pack.mjs";

const root = join(import.meta.dirname, "..", "..", "sdk", "examples");
const examples = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("the SDK ships four examples", () => assert.ok(examples.length >= 4, examples.join()));

for (const name of examples) {
  test(`example ${name}: manifest validates and every referenced file exists`, () => {
    const files = readFolder(join(root, name));
    const raw = JSON.parse(new TextDecoder().decode(files["openfini-extension.json"]));
    const r = validateManifest(raw, { hostVersion: "0.4.0" });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(checkPackageFiles(r.manifest, Object.keys(files)), []);
    if (r.manifest.main) assert.match(new TextDecoder().decode(files[r.manifest.main]), /activate\(openfini\)/);
  });
}

test("the JSON schema lists every permission and contribution point the validator knows", () => {
  const schema = JSON.parse(readFileSync(join(root, "..", "schema", "openfini-extension.schema.json"), "utf8"));
  const contributes = Object.keys(schema.properties.contributes.properties);
  for (const k of ["commands", "menus", "keybindings", "panels", "themes", "templates", "importers", "exporters", "vibeTools", "vibeSkills", "settings", "snippets"]) assert.ok(contributes.includes(k), k);
  assert.ok(existsSync(join(root, "..", "openfini.d.ts")));
  const dts = readFileSync(join(root, "..", "openfini.d.ts"), "utf8");
  for (const m of ["commands", "ui", "document", "studio", "storage", "network", "events", "vibe", "files", "messages", "settings"]) assert.match(dts, new RegExp(`\\b${m}:`), m);
});

test("the create-extension CLI templates produce valid extensions", async () => {
  const { scaffold } = await import("../../sdk/create-extension.mjs");
  for (const t of ["command", "panel", "theme"]) {
    const files = scaffold("acme.demo-ext", t, "0.3.0");
    const r = validateManifest(JSON.parse(files["openfini-extension.json"]), { hostVersion: "0.3.0" });
    assert.deepEqual(r.errors, [], t);
    assert.deepEqual(checkPackageFiles(r.manifest, Object.keys(files)), [], t);
  }
  assert.throws(() => scaffold("Bad Id"), /not a valid extension id/);
  assert.throws(() => scaffold("acme.x-y", "nope"), /Unknown template/);
});
