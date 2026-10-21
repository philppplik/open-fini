import test from "node:test";
import assert from "node:assert/strict";
import { bridgeSource } from "../../app/src/ui/code/bridge.js";

test("the preview bridge compiles and carries the measure kit", () => {
  assert.doesNotThrow(() => new Function(bridgeSource));
  assert.match(bridgeSource, /gapGuides/);
  assert.match(bridgeSource, /type: "measureInfo"/);
});

test("the bridge only accepts messages from the parent and validates measure options", () => {
  assert.match(bridgeSource, /e\.source !== TOP/);
  assert.match(bridgeSource, /kit\.UNITS\.indexOf\(m\.unit\)/);
  assert.match(bridgeSource, /\^#\[0-9a-f\]\{3,8\}\$/);
});
