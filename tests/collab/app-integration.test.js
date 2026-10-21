// How collaboration plugs into the rest of the app: logging, network policy, profiles, documents, storage.
import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../../app/src/core/log.js";
import { NETWORK_KINDS, createNetwork } from "../../app/src/core/network.js";
import { buildProfile } from "../../app/src/customize/profile.js";
import { getDefaultPrefs } from "../../app/src/core/app.js";
import { Doc } from "../../app/src/core/doc.js";
import { isProtectedKey } from "../../app/src/core/storage.js";
import { normalizeThreads, newThread } from "../../app/src/collab/comments.js";
import { formatInvite, newRoomId, newRoomSecret, newIdentity } from "../../app/src/collab/crypto.js";

test("invite codes never survive logging", async () => {
  const code = formatInvite({ relay: "wss://relay.example.org/", room: newRoomId(), secret: newRoomSecret(), host: (await newIdentity()).id });
  const secret = code.split(".")[2];
  const out = redact(`Joining ${code} now`);
  assert.ok(!out.includes(secret), out);
  assert.match(out, /\[redacted-invite\]/);
});

test("offline mode knows collaboration and still allows relays on this device", () => {
  assert.ok(NETWORK_KINDS.collab);
  const net = createNetwork(() => true);
  assert.throws(() => net.assert("collab", "wss://relay.example.org/"), /Offline mode/);
  assert.doesNotThrow(() => net.assert("collab", "ws://127.0.0.1:8787/"));
});

test("exported profiles (.ofprofile) never contain collaboration identity or room data", () => {
  const prefs = { ...getDefaultPrefs(), collabNick: "Mia", collabColor: "#ff0000", collabRelay: "wss://relay.example.org/" };
  const json = JSON.stringify(buildProfile(prefs));
  assert.ok(!/collab/i.test(json.replace(/"collab\.open"/g, "")), json.slice(0, 200));
});

test("documents save comments additively and load them back", () => {
  const doc = new Doc({ name: "Poster" });
  assert.equal(doc.toJSON().comments, undefined, "no field while there are no comments");
  const author = { id: "A".repeat(22), nick: "Ann", color: "#ff0000" };
  doc.comments.push(newThread({ id: "t1", anchor: { kind: "page", page: doc.pages[0].id }, author, text: "Nice", ts: 5 }));
  const json = doc.toJSON();
  assert.equal(json.comments.length, 1);
  json.comments.push("junk", null, [1], { noId: true });
  const back = Doc.fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(back.comments.length, 1, "the loader keeps only objects with an id");
  assert.deepEqual(normalizeThreads(back.comments)[0].messages[0].text, "Nice");
  // an old reader ignores the field; an old file without it loads with no comments
  delete json.comments;
  assert.deepEqual(Doc.fromJSON(json).comments, []);
});

test("stored versions are protected by the app lock like autosaved sessions", () => {
  assert.equal(isProtectedKey("versions.data.v1"), true);
  assert.equal(isProtectedKey("versions.index"), true);
});
