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
  const own = (file) => JSON.parse(read(`src-tauri/capabilities/${file}`)).permissions.filter((p) => typeof p === "string" && p.startsWith("allow-")).map((p) => p.slice(6).replace(/-/g, "_"));
  // computer use has its own capability for the main window only (docs/vibe-computer-use.md); everything else is in default.json
  const computer = own("computer-use.json");
  const allowed = [...own("default.json"), ...computer].sort();
  assert.deepEqual(manifest, commands, "build.rs COMMANDS must match generate_handler!");
  assert.deepEqual(allowed, commands, "capabilities/default.json and computer-use.json must allow every command, once");
  assert.ok(computer.every((c) => c.startsWith("computer_")) && commands.filter((c) => c.startsWith("computer_")).every((c) => computer.includes(c)), "every computer_ command lives in computer-use.json only");
});

test("computer use commands are granted to the main window only, the indicator gets status, pause, resume and stop", () => {
  const use = JSON.parse(read("src-tauri/capabilities/computer-use.json"));
  assert.deepEqual(use.windows, ["main"]);
  const indicator = JSON.parse(read("src-tauri/capabilities/computer-indicator.json"));
  assert.deepEqual(indicator.windows, ["computer-indicator"]);
  assert.deepEqual(indicator.permissions.filter((p) => p.startsWith("allow-")).sort(), ["allow-computer-pause", "allow-computer-resume", "allow-computer-status", "allow-computer-stop"]);
  for (const file of ["default.json", "splash.json"]) {
    const cap = JSON.parse(read(`src-tauri/capabilities/${file}`));
    assert.ok(!cap.permissions.some((p) => typeof p === "string" && p.includes("computer")), `${file} must not grant computer use`);
  }
});
