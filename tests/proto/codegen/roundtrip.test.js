// Browser round trip of the Proto HTML export (task T7 acceptance): every geometry fixture exported as HTML + CSS and
// rendered in headless Chromium must match the boxes recorded from the canvas CSS (1 px without text, 2 px with text).
// Needs a Chromium-based browser, so it runs only with PROTO_ROUNDTRIP=1 (CHROME_PATH picks the browser):
//   PROTO_ROUNDTRIP=1 npm test -- --test-name-pattern="round trip"
// or directly: node scripts/proto-export-roundtrip.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../fixtures/geometry/", import.meta.url);

test("round trip: exported HTML matches the recorded geometry in Chromium", { skip: !process.env.PROTO_ROUNDTRIP && "set PROTO_ROUNDTRIP=1 (needs Chrome, Edge or Chromium)" }, async () => {
  const { launch } = await import("../../../scripts/proto-record-geometry.mjs");
  const { roundTrip } = await import("../../../scripts/proto-export-roundtrip.mjs");
  const browser = await launch();
  try {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json")).sort()) {
      const fixture = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
      const r = await roundTrip(browser, fixture);
      assert.deepEqual(r.diffs, [], f);
      assert.ok(r.checked > 0, f);
    }
  } finally {
    await browser.close();
  }
});
