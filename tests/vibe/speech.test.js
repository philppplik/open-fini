import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Sha256, verifyStream, planSpeech, speakableText, pickVoice, SPEECH_MODELS, normalizeVoice } from "../../app/src/vibe/speech.js";

test("streaming SHA-256 matches node:crypto for any chunking", () => {
  const data = new Uint8Array(10_000).map((_, i) => (i * 31 + 7) & 255);
  const want = createHash("sha256").update(data).digest("hex");
  for (const step of [1, 3, 55, 56, 63, 64, 65, 1000, 10_000]) {
    const h = new Sha256();
    for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
    assert.equal(h.hex(), want, `chunk ${step}`);
  }
  assert.equal(new Sha256().hex(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(new Sha256().update(new TextEncoder().encode("abc")).hex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("verifyStream accepts the right bytes and refuses wrong size or checksum", async () => {
  const bytes = new TextEncoder().encode("model bytes");
  const model = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  async function* chunks(b) {
    yield b.subarray(0, 4);
    yield b.subarray(4);
  }
  const seen = [];
  const r = await verifyStream(chunks(bytes), model, { onChunk: (c) => seen.push(c.length) });
  assert.equal(r.bytes, bytes.length);
  assert.deepEqual(seen, [4, bytes.length - 4]);
  await assert.rejects(verifyStream(chunks(bytes), { ...model, sha256: "0".repeat(64) }), /checksum/);
  await assert.rejects(verifyStream(chunks(bytes), { ...model, size: 4 }), /larger/);
  await assert.rejects(verifyStream(chunks(bytes), { ...model, size: 99 }), /incomplete/);
});

test("the model catalog is pinned and complete", () => {
  for (const m of SPEECH_MODELS) {
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
    assert.ok(m.size > 1e6);
    assert.match(m.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\//, "pinned to a commit");
  }
  assert.equal(normalizeVoice(null).stt, "system", "the microphone keeps working as before");
  assert.equal(normalizeVoice(null).tts, false);
});

test("speakable text drops code, links and markdown", () => {
  const s = speakableText("## Done\n\n- **Bold** item with `code` and [a link](https://x.y)\n\n```js\nlet x = 1;\n```\nSee https://example.org");
  assert.equal(s.includes("```"), false);
  assert.match(s, /Bold item with code and a link/);
  assert.match(s, /\(code omitted\)/);
  assert.match(s, /See a link/);
});

test("planSpeech gives questions, exclamations and pauses their own prosody", () => {
  const plan = planSpeech("Here is your logo. Do you like it? It looks great!\n\nNote: colors may vary…");
  assert.deepEqual(plan.map((p) => p.text), ["Here is your logo.", "Do you like it?", "It looks great!", "Note: colors may vary…"]);
  assert.ok(plan[1].pitch > 1 && plan[2].pitch > 1 && plan[2].rate > 1);
  assert.ok(plan[3].rate < 1);
  assert.ok(plan[2].pauseMs > plan[0].pauseMs, "paragraph end pauses longer");
  assert.ok(planSpeech("Do you like it?", { expressive: false }).every((p) => p.pitch === 1 && p.rate === 1));
  assert.deepEqual(planSpeech("```\ncode\n```"), [{ text: "(code omitted)", rate: 1, pitch: 1, volume: 1, pauseMs: 450 }]);
});

test("pickVoice prefers on-device voices for the UI language", () => {
  const voices = [
    { voiceURI: "net-de", lang: "de-DE", localService: false },
    { voiceURI: "local-en", lang: "en-US", localService: true, default: true },
    { voiceURI: "local-de", lang: "de-DE", localService: true },
  ];
  assert.equal(pickVoice(voices, { lang: "de" }).voiceURI, "local-de");
  assert.equal(pickVoice(voices, { lang: "de", voice: "net-de" }).voiceURI, "local-de", "network voices are skipped by default");
  assert.equal(pickVoice(voices, { lang: "de", voice: "net-de", localVoicesOnly: false }).voiceURI, "net-de");
  assert.equal(pickVoice(voices, { lang: "fr" }), null);
});
