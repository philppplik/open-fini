import test from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions, satisfies, validRange } from "../../app/src/extensions/semver.js";

test("parses and orders versions, pre-releases first", () => {
  assert.deepEqual(parseVersion("1.2.3-beta.1"), { major: 1, minor: 2, patch: 3, pre: ["beta", 1] });
  assert.equal(parseVersion("1.2"), null);
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.equal(compareVersions("2.0.0+build", "2.0.0"), 0);
});

test("range matching: operators, carets, tildes, x-ranges, hyphen, OR", () => {
  const ok = (v, r) => assert.ok(satisfies(v, r), `${v} should satisfy ${r}`);
  const no = (v, r) => assert.ok(!satisfies(v, r), `${v} should not satisfy ${r}`);
  ok("0.3.0", ">=0.3.0");
  no("0.2.9", ">=0.3.0");
  ok("1.4.2", "^1.2.3");
  no("2.0.0", "^1.2.3");
  ok("0.3.5", "^0.3.0");
  no("0.4.0", "^0.3.0");
  no("0.0.4", "^0.0.3");
  ok("1.2.9", "~1.2.3");
  no("1.3.0", "~1.2.3");
  ok("0.3.7", "0.3.x");
  no("0.4.0", "0.3.x");
  ok("5.1.1", "*");
  ok("1.5.0", "1.2.0 - 1.6.0");
  no("1.7.0", "1.2.0 - 1.6.0");
  ok("3.0.0", "^1.0.0 || ^3.0.0");
  ok("1.5.0", ">=1.2.0 <2.0.0");
  no("2.0.0", ">=1.2.0 <2.0.0");
  ok("1.2.3", "=1.2.3");
  ok("1.2.3", ">= 1.2.3");
});

test("pre-releases only satisfy ranges that mention the same version tuple", () => {
  assert.ok(!satisfies("1.3.0-beta.1", "^1.2.0"));
  assert.ok(satisfies("1.3.0-beta.1", ">=1.3.0-beta.0"));
});

test("invalid ranges are detected", () => {
  assert.ok(validRange(">=0.3.0"));
  assert.ok(!validRange("latest"));
  assert.ok(!validRange(">=abc"));
  assert.ok(!satisfies("1.0.0", "latest"));
});
