import { test } from "node:test";
import assert from "node:assert/strict";
import { localeCandidates, loadMessages, resolveManifestStrings, localizeManifest } from "../../app/src/extensions/i18n.js";

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const raw = { id: "acme.demo", name: "%ext.name%", description: "Plain description", contributes: { commands: [{ id: "demo.run", title: "%cmd.run%" }, { id: "demo.other", title: "No placeholder" }], menus: [{ menu: "File", command: "demo.run" }] } };
const files = { "locales/en.json": enc({ "ext.name": "Demo", "cmd.run": "Run demo" }), "locales/de.json": enc({ "cmd.run": "Demo ausführen" }) };

test("locale candidates", () => {
  assert.deepEqual(localeCandidates("de-AT"), ["de-AT", "de", "en"]);
  assert.deepEqual(localeCandidates("en"), ["en"]);
});

test("messages merge most specific first with English as fallback", () => {
  assert.deepEqual(loadMessages(files, "de-DE"), { "ext.name": "Demo", "cmd.run": "Demo ausführen" });
  assert.deepEqual(loadMessages({ "locales/de.json": new TextEncoder().encode("{broken") }, "de"), {});
});

test("placeholders resolve in name, description and contributes only", () => {
  const out = localizeManifest(raw, files, "de");
  assert.equal(out.name, "Demo");
  assert.equal(out.description, "Plain description");
  assert.equal(out.contributes.commands[0].title, "Demo ausführen");
  assert.equal(out.contributes.commands[1].title, "No placeholder");
  assert.equal(raw.contributes.commands[0].title, "%cmd.run%"); // input is not mutated
});

test("unknown keys stay readable; manifests without placeholders are returned untouched", () => {
  assert.equal(resolveManifestStrings({ name: "%nope%" }, {}).name, "nope");
  const plain = { name: "Plain", contributes: {} };
  assert.equal(localizeManifest(plain, files, "de"), plain);
});
