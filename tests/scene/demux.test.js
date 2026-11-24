// Scene Studio R7.2 to R7.4: container readers for sequential decoding (read back what scene/mux.js writes), the
// frame lookup, reversed sound (samples, source window, linked reverse) and the frame cache planning.
import test from "node:test";
import assert from "node:assert/strict";
import { muxMp4, muxWebm, opusHead } from "../../app/src/scene/mux.js";
import { demuxVideo, frameIndexAt, av1Codec, hevcCodec } from "../../app/src/scene/demux.js";
import { reverseSamples, sourceWindow } from "../../app/src/scene/audio.js";
import { flattenAudio } from "../../app/src/scene/evaluate.js";
import { planPrefetch } from "../../app/src/scene/decode.js";
import * as M from "../../app/src/scene/model.js";
import * as E from "../../app/src/scene/edit-ops.js";

// 12 frames at 25 fps, a key frame every 5; the payload byte says which frame it is
const frames = Array.from({ length: 12 }, (_, i) => ({ data: new Uint8Array(20 + i).fill(i + 1), ts: i * 40000, dur: 40000, key: i % 5 === 0 }));
const avcC = new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const audio = { codec: "opus", sampleRate: 48000, channels: 2, description: opusHead(2, 48000), samples: Array.from({ length: 25 }, (_, i) => ({ data: new Uint8Array(8).fill(200), ts: i * 20000, dur: 20000, key: true })) };

function checkTrack(t, bytes) {
  assert.equal(t.width, 320);
  assert.equal(t.height, 180);
  assert.equal(t.samples.length, frames.length);
  t.samples.forEach((s, i) => {
    assert.equal(s.ts, frames[i].ts, `time of sample ${i}`);
    assert.equal(s.key, frames[i].key, `key flag of sample ${i}`);
    assert.equal(s.size, frames[i].data.length);
    assert.ok(bytes.subarray(s.offset, s.offset + s.size).every((v) => v === i + 1), `bytes of sample ${i}`);
    assert.equal(s.dur, 40000);
  });
  assert.deepEqual(t.times, frames.map((f) => f.ts));
}

test("MP4 written by the exporter reads back: codec, size, description, samples in order, key frames", () => {
  const bytes = muxMp4({ video: { codec: "avc1.64001f", width: 320, height: 180, description: avcC, samples: frames }, audio: { ...audio, codec: "mp4a.40.2", description: new Uint8Array([0x11, 0x90]) } });
  const t = demuxVideo(bytes, "video/mp4");
  assert.ok(t);
  assert.equal(t.container, "mp4");
  assert.equal(t.codec, "avc1.64001f");
  assert.deepEqual([...t.description], [...avcC]);
  checkTrack(t, bytes);
});

test("WebM written by the exporter reads back (VP9, with sound interleaved)", () => {
  const bytes = muxWebm({ video: { codec: "vp09.00.10.08", width: 320, height: 180, samples: frames }, audio });
  const t = demuxVideo(bytes, "video/webm");
  assert.ok(t);
  assert.equal(t.container, "webm");
  assert.equal(t.codec, "vp09.00.10.08");
  assert.equal(t.description, null);
  checkTrack(t, bytes);
  assert.equal(demuxVideo(muxWebm({ video: { codec: "vp8", width: 320, height: 180, samples: frames } })).codec, "vp8");
});

test("damaged, foreign or video-less input gives null instead of throwing", () => {
  const good = muxMp4({ video: { codec: "avc1.64001f", width: 320, height: 180, description: avcC, samples: frames } });
  for (let cut = 20; cut < good.length; cut += 97) assert.doesNotThrow(() => demuxVideo(good.subarray(0, cut)));
  assert.equal(demuxVideo(good.subarray(0, 40)), null);
  assert.equal(demuxVideo(new Uint8Array(64).fill(7)), null);
  assert.equal(demuxVideo(muxMp4({ audio: { ...audio, codec: "mp4a.40.2" } })), null, "no video track");
  const webm = muxWebm({ video: { codec: "vp8", width: 320, height: 180, samples: frames } });
  for (let cut = 20; cut < webm.length; cut += 53) assert.doesNotThrow(() => demuxVideo(webm.subarray(0, cut)));
  const noKey = muxWebm({ video: { codec: "vp8", width: 8, height: 8, samples: frames.slice(1) } });
  assert.equal(demuxVideo(noKey), null, "a stream that does not start with a key frame");
});

test("codec strings from configuration records", () => {
  assert.equal(av1Codec(new Uint8Array([0x81, 0x08, 0x0c, 0])), "av01.0.08M.08");
  assert.equal(av1Codec(new Uint8Array([0x81, 0x28, 0x4c, 0])), "av01.1.08M.10");
  // HEVC Main, level 3.1 (93), main tier, compatibility flag 1 (written bit-reversed as 0x60000000), progressive
  const hvcc = new Uint8Array([1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 93]);
  assert.equal(hevcCodec("hvc1", hvcc), "hvc1.1.6.L93.90");
});

test("frameIndexAt: the frame shown at a time is the last one at or before it", () => {
  const times = [0, 40000, 80000, 120000];
  assert.equal(frameIndexAt(times, 0), 0);
  assert.equal(frameIndexAt(times, 39999), 0);
  assert.equal(frameIndexAt(times, 40000), 1);
  assert.equal(frameIndexAt(times, 1e9), 3);
  assert.equal(frameIndexAt(times, -5), 0);
  assert.equal(frameIndexAt([], 5), -1);
});

test("planPrefetch: the frames ahead of the playhead in the direction the source runs, nearest first", () => {
  const times = Array.from({ length: 100 }, (_, i) => i * 40000);
  assert.deepEqual(planPrefetch(times, 2, -1, 0.2), [50, 49, 48, 47, 46, 45]);
  assert.deepEqual(planPrefetch(times, 2, 1, 0.12), [50, 51, 52, 53]);
  assert.deepEqual(planPrefetch(times, 0.02, -1, 1), [0], "stops at the start of the file");
  assert.deepEqual(planPrefetch(times, 3, 0, 1), [75], "a freeze frame needs one frame");
});

test("reversed sound: samples, the source window and the reversed copy's offsets", () => {
  assert.deepEqual([...reverseSamples(new Float32Array([1, 2, 3, 4]))], [4, 3, 2, 1]);
  const fwd = { in: 2, dur: 3, speed: 1 };
  assert.deepEqual(sourceWindow(fwd, 1, 3), { offset: 3, length: 2, slice: null });
  const rev = { ...fwd, rev: true };
  // the reversed copy covers [2, 5) of the source backwards: clip time 1 is 1 s into it (source 4 s)
  assert.deepEqual(sourceWindow(rev, 1, 3), { offset: 1, length: 2, slice: [2, 5] });
  assert.deepEqual(sourceWindow({ ...rev, speed: 2 }, 0.5, 1), { offset: 1, length: 1, slice: [2, 8] });
});

test("reversing a video turns its linked sound; sound clips reverse on their own; nested reversed sound", () => {
  let m = M.emptyScene({ fps: 25 });
  m = M.addMedia(m, { id: "v1", kind: "video", mime: "video/mp4", name: "a.mp4", duration: 10, w: 64, h: 36, hasAudio: true }).model;
  const placed = M.placeMedia(m, "v1", { start: 0, dur: 4 });
  m = placed.model;
  const vid = Object.values(m.clips).find((c) => c.type === "video").id;
  const aid = Object.values(m.clips).find((c) => c.type === "audio").id;
  assert.deepEqual(E.soundPartners(m, vid), [aid]);
  let r = E.reverseClip(m, vid);
  assert.ok(r.clips[vid].remap && r.clips[aid].rev, "picture and sound play backwards");
  r = E.reverseClip(r, vid);
  assert.ok(!r.clips[aid].rev, "reversing again plays both forward");
  // picture and sound selected together turn once
  r = E.reverseClips(m, [vid, aid]);
  assert.ok(r.clips[aid].rev);
  // sound on its own
  r = E.reverseClip(m, aid);
  assert.ok(r.clips[aid].rev && r.clips[vid].remap === undefined);
  // survives normalization (format 4) and reaches the audio engine
  const n = M.normalizeScene(JSON.parse(JSON.stringify(r)));
  assert.equal(n.clips[aid].rev, true);
  const voice = flattenAudio(n).find((v) => v.id === aid);
  assert.equal(voice.rev, true);
  // a reversed sound inside a composition, trimmed by the composition clip, keeps the right source range
  const inner = { id: "a1", media: "v1", start: 0, dur: 4, in: 1, speed: 1, rev: true };
  const comp = { ...M.emptyScene({ fps: 25 }), media: n.media };
  const withComp = M.addClip(comp, { id: "x", type: "audio", media: "v1", start: 0, dur: inner.dur, in: inner.in, rev: true }).model;
  const pre = M.precompose(withComp, ["x"]);
  const cc = Object.values(pre.model.clips).find((c) => c.type === "comp");
  const trimmed = M.trimClip(pre.model, cc.id, "start", 1); // drop the first second of the composition
  const v = flattenAudio(trimmed).find((x) => x.id.endsWith("/x"));
  assert.equal(v.rev, true);
  // the voice now covers composition time [1, 4): played backwards it is source [1, 4) of the 5 s range [1, 5)
  assert.ok(Math.abs(v.in - 1) < 1e-9 && Math.abs(v.dur - 3) < 1e-9, `in ${v.in} dur ${v.dur}`);
});
