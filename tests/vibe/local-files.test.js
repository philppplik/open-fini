import { test } from "node:test";
import assert from "node:assert/strict";
import { localFileTools, decodeText, normalizeLocalFiles } from "../../app/src/vibe/tools/local-files.js";
import { vibeStore } from "../../app/src/vibe/store.js";

test("local file access is off by default and every call asks when on", async () => {
  assert.equal(normalizeLocalFiles(null).enabled, false);
  const tools = Object.fromEntries(localFileTools().map((t) => [t.name, t]));
  vibeStore.settings.localFiles = null;
  await assert.rejects(tools.local_read_file.run({ path: "/x" }), /switched off/);
  assert.equal(tools.local_read_file.needsApproval({ path: "/x" }), false, "off: the run reports it, nothing to approve");
  vibeStore.settings.localFiles = { enabled: true };
  for (const n of ["local_list_files", "local_read_file", "local_write_file"]) assert.equal(tools[n].alwaysAsk, true, n);
  assert.match(tools.local_write_file.needsApproval({ path: "/a/b.md", content: "héllo" }), /Write 6 bytes to \/a\/b\.md/);
  await assert.rejects(tools.local_list_folders.run({}), /desktop app/, "the browser build has no native side");
  vibeStore.settings.localFiles = null;
});

test("decodeText refuses binary content", () => {
  assert.equal(decodeText(new TextEncoder().encode("Grüße")), "Grüße");
  assert.equal(decodeText(new Uint8Array([0x50, 0, 0x4b])), null);
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x41])), null);
});
