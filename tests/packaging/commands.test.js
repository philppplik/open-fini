// The desktop app's own commands must be listed in three places: generate_handler! (src-tauri/src/lib.rs), the app
// manifest (src-tauri/build.rs) and the main window's capability (allow-<command>). A command missing from the last two
// is refused at run time without a compile error, so this test keeps them in sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("every Tauri command is in the manifest and the default capability", () => {
  const lib = read("src-tauri/src/lib.rs");
  const handler = /generate_handler!\[([\s\S]*?)\]/.exec(lib)[1];
  const commands = [...handler.matchAll(/(?:\w+::)?(\w+),?/g)].map((m) => m[1]).filter(Boolean).sort();
  const manifest = [...read("src-tauri/build.rs").matchAll(/^\s*"(\w+)",$/gm)].map((m) => m[1]).sort();
  const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
  const allowed = cap.permissions.filter((p) => typeof p === "string" && p.startsWith("allow-")).map((p) => p.slice(6).replace(/-/g, "_")).sort();
  assert.deepEqual(manifest, commands, "build.rs COMMANDS must match generate_handler!");
  assert.deepEqual(allowed, commands, "capabilities/default.json must allow every command");
});
