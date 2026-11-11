// Scene Studio: container writers (MP4, WebM), the GIF encoder, WAV, the noise gate curve and captions.
import test from "node:test";
import assert from "node:assert/strict";
import { muxMp4, muxWebm, opusHead } from "../../app/src/scene/mux.js";
import { createGifEncoder } from "../../app/src/scene/gif.js";
import { readGif } from "../../app/src/engine/formats/gif.js";
import { encodeWav, gateCurve } from "../../app/src/scene/audio.js";
import { avcCodec, defaultBitrate } from "../../app/src/scene/export.js";
import * as C from "../../app/src/scene/captions.js";
import * as M from "../../app/src/scene/model.js";

const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);

// children of a box (or of the file): [{ type, start, size }]
function boxes(b, from = 0, to = b.length) {
  const out = [];
  for (let o = from; o + 8 <= to; ) {
    const size = be32(b, o);
    assert.ok(size >= 8 && o + size <= to, `box ${type(b, o)} at ${o} has a valid size`);
    out.push({ type: type(b, o), start: o, size });
    o += size;
  }
  return out;
}
const find = (b, path, from = 0, to = b.length) => {
  let list = boxes(b, from, to);
  let hit = null;
  for (const name of path) {
    hit = list.find((x) => x.type === name);
    assert.ok(hit, `box ${name}`);
    const skip = name === "stsd" ? 16 : 8;
    list = name === path[path.length - 1] ? [] : boxes(b, hit.start + skip, hit.start + hit.size);
  }
  return hit;
};

const sample = (n, fill, ts, key = false) => ({ data: new Uint8Array(n).fill(fill), ts, dur: 33333, key });

test("MP4: box structure, sample tables and chunk offsets", () => {
  const video = { codec: "avc1.64001f", width: 640, height: 360, description: new Uint8Array([1, 100, 0, 31, 255, 225, 0, 0]), samples: [sample(100, 1, 0, true), sample(40, 2, 33333), sample(50, 3, 66666)] };
  const audio = { codec: "mp4a.40.2", sampleRate: 48000, channels: 2, description: new Uint8Array([0x11, 0x90]), samples: [sample(20, 9, 0, true), sample(21, 8, 21333, true), sample(22, 7, 42666, true)] };
  const b = muxMp4({ video, audio });
  assert.deepEqual(boxes(b).map((x) => x.type), ["ftyp", "mdat", "moov"]);
  const moov = find(b, ["moov"]);
  const traks = boxes(b, moov.start + 8, moov.start + moov.size).filter((x) => x.type === "trak");
  assert.equal(traks.length, 2);
  const stbl = (tk) => find(b, ["mdia", "minf", "stbl"], tk.start + 8, tk.start + tk.size);
  const table = (tk, name) => boxes(b, stbl(tk).start + 8, stbl(tk).start + stbl(tk).size).find((x) => x.type === name);
  // sample sizes and offsets of the video track point at the right bytes in mdat
  const stsz = table(traks[0], "stsz");
  assert.equal(be32(b, stsz.start + 16), 3);
  assert.deepEqual([0, 1, 2].map((i) => be32(b, stsz.start + 20 + i * 4)), [100, 40, 50]);
  const stco = table(traks[0], "stco");
  [1, 2, 3].forEach((fill, i) => assert.equal(b[be32(b, stco.start + 16 + i * 4)], fill));
  const aco = table(traks[1], "stco");
  [9, 8, 7].forEach((fill, i) => assert.equal(b[be32(b, aco.start + 16 + i * 4)], fill));
  // only the first video sample is a sync sample
  const stss = table(traks[0], "stss");
  assert.deepEqual([be32(b, stss.start + 12), be32(b, stss.start + 16)], [1, 1]);
  assert.equal(table(traks[1], "stss"), undefined, "audio: every sample is a sync sample");
  // sample entries
  const stsd = table(traks[0], "stsd");
  assert.equal(type(b, stsd.start + 16), "avc1");
  assert.equal(type(b, table(traks[1], "stsd").start + 16), "mp4a");
  // Opus in MP4 and a video-only file
  const opus = muxMp4({ video, audio: { ...audio, codec: "opus", description: opusHead(2, 48000) } });
  const t2 = boxes(opus, find(opus, ["moov"]).start + 8).filter((x) => x.type === "trak")[1];
  const sd = boxes(opus, find(opus, ["mdia", "minf", "stbl"], t2.start + 8, t2.start + t2.size).start + 8).find((x) => x.type === "stsd");
  assert.equal(type(opus, sd.start + 16), "Opus");
  assert.equal(boxes(muxMp4({ video })).length, 3);
  assert.throws(() => muxMp4({ video: { ...video, samples: [] } }), /Nothing to write/);
});

test("WebM: EBML header, tracks, clusters at key frames, cues inside the file", () => {
  const video = { codec: "vp09.00.40.08", width: 320, height: 180, samples: [sample(30, 1, 0, true), sample(10, 2, 33333), sample(31, 3, 2000000, true)] };
  const audio = { codec: "opus", sampleRate: 48000, channels: 2, description: null, samples: [sample(8, 9, 0, true), sample(8, 9, 20000, true)] };
  const b = muxWebm({ video, audio });
  assert.deepEqual([...b.slice(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  const text = String.fromCharCode(...b);
  for (const s of ["webm", "V_VP9", "A_OPUS", "OpusHead", "OpenFini"]) assert.ok(text.includes(s), s);
  const count = (id) => {
    let n = 0;
    for (let i = 0; i + 4 <= b.length; i++) if (b[i] === id[0] && b[i + 1] === id[1] && b[i + 2] === id[2] && b[i + 3] === id[3]) n++;
    return n;
  };
  assert.equal(count([0x1f, 0x43, 0xb6, 0x75]), 2, "one cluster per video key frame");
  assert.equal(count([0x1c, 0x53, 0xbb, 0x6b]), 1, "cues");
  assert.ok(muxWebm({ audio }).length > 40);
});

test("GIF: frames round-trip through the decoder with their colors", () => {
  const w = 8;
  const h = 6;
  const frame = (r, g, b) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i += 4) d.set([r, g, b, 255], i);
    return d;
  };
  const gif = createGifEncoder(w, h, { fps: 10, paletteFrames: 3 });
  gif.add(frame(255, 0, 0));
  gif.add(frame(0, 255, 0));
  gif.add(frame(0, 0, 255));
  gif.add(frame(255, 255, 255));
  const out = readGif(gif.finish());
  assert.equal(out.width, w);
  assert.equal(out.frames.length, 4);
  assert.equal(out.frames[0].delay, 100);
  const px = (i) => [...out.frames[i].rgba.slice(0, 3)];
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 24);
  assert.ok(close(px(0), [255, 0, 0]) && close(px(1), [0, 255, 0]) && close(px(2), [0, 0, 255]), JSON.stringify([px(0), px(1), px(2)]));
  // a larger noisy frame exercises the LZW table reset
  const big = createGifEncoder(64, 64, { fps: 15 });
  const noisy = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 2654435761) >>> 24;
  big.add(noisy);
  const back = readGif(big.finish());
  assert.equal(back.frames.length, 1);
  assert.equal(back.warnings.length, 0);
});

test("WAV header, gate curve, codec helpers", () => {
  const buf = { numberOfChannels: 2, sampleRate: 48000, length: 4, getChannelData: (c) => Float32Array.from(c ? [0, -1, 0, 0] : [1, 0, 0.5, 0]) };
  const wav = encodeWav(buf);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(wav.length, 44 + 16);
  const v = new DataView(wav.buffer);
  assert.equal(v.getInt16(44, true), 32767);
  assert.equal(v.getInt16(50, true), -32768);
  // 100 ms of signal, then silence: the gate opens, then closes over the release time
  const s = new Float32Array(48000);
  for (let i = 0; i < 4800; i++) s[i] = Math.sin(i / 5) * 0.5;
  const g = gateCurve(s, 48000, -40, 0.1);
  assert.equal(g[0], 1);
  assert.equal(g[9], 1);
  assert.ok(g[12] > 0 && g[12] < 1);
  assert.equal(g[40], 0);
  assert.equal(avcCodec(1280, 720, 30), "avc1.64001f");
  assert.equal(avcCodec(1920, 1080, 30), "avc1.640028");
  assert.equal(avcCodec(3840, 2160, 30), "avc1.640033");
  assert.ok(defaultBitrate(1920, 1080, 30) > 4e6);
});

test("captions: SRT and VTT in and out, words to cues, cues to clips", () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond line\r\nwraps\r\n";
  const cues = C.parseSubtitles(srt);
  assert.deepEqual(cues, [{ t0: 1, t1: 2.5, text: "Hello there" }, { t0: 3, t1: 4, text: "Second line\nwraps" }]);
  assert.deepEqual(C.parseSubtitles(C.formatSrt(cues)), cues);
  assert.deepEqual(C.parseSubtitles(C.formatVtt(cues)), cues);
  assert.deepEqual(C.parseSubtitles("WEBVTT\n\nNOTE x\n\n01:02.000 --> 01:03.000 align:start\nHi"), [{ t0: 62, t1: 63, text: "Hi" }]);
  assert.deepEqual(C.parseSubtitles("garbage"), []);
  const words = "This is a sentence. And here comes another one after a pause".split(" ").map((w, i) => ({ w, t0: i < 4 ? i * 0.3 : 3 + i * 0.3, t1: (i < 4 ? i * 0.3 : 3 + i * 0.3) + 0.25 }));
  const made = C.wordsToCues(words, { maxChars: 20 });
  assert.equal(made[0].text, "This is a sentence.");
  assert.ok(made.every((c) => c.text.length <= 20 && c.t1 > c.t0));
  assert.equal(made.map((c) => c.text).join(" "), words.map((w) => w.w).join(" "));
  // on the timeline: a Captions track, no overlaps, replace removes the old ones
  let m = M.emptyScene();
  const r = C.captionsToClips(m, [{ t0: 0, t1: 2, text: "A" }, { t0: 1.5, t1: 3, text: "B" }]);
  m = r.model;
  assert.equal(M.videoTracks(m)[0].name, "Captions");
  const cl = r.ids.map((id) => m.clips[id]);
  assert.deepEqual(cl.map((c) => [c.start, c.dur, c.caption]), [[0, 1.5, true], [1.5, 1.5, true]]);
  assert.deepEqual(C.captionCues(m).map((c) => c.text), ["A", "B"]);
  const again = C.captionsToClips(m, [{ t0: 0, t1: 1, text: "C" }], { replace: true, style: "bold" });
  assert.deepEqual(C.captionCues(again.model).map((c) => c.text), ["C"]);
  assert.equal(M.videoTracks(again.model).filter((t) => t.name === "Captions").length, 1);
});
