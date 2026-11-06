// Speech for Vibe (pure, no DOM): settings, the catalog of local speech-to-text models, expressive text-to-speech
// planning (sentences with prosody), and a streaming SHA-256 used to verify model downloads chunk by chunk.
// The browser side (playback, microphone, model storage) is speech-runtime.js. docs/vibe-voice.md.

export const DEFAULT_VOICE = () => ({
  tts: false, // speak Vibe's replies
  voice: "", // SpeechSynthesisVoice.voiceURI ("" = the first on-device voice for the UI language)
  localVoicesOnly: true, // only voices that run on this device (voice.localService)
  rate: 1,
  pitch: 1,
  expressive: true, // vary pitch, rate and pauses by sentence type
  stt: "system", // off | system (the browser's or OS recognizer, as the microphone button always used; Chromium sends audio to an online service) | local (downloaded model)
  sttModel: "", // id from SPEECH_MODELS for stt = local
  voiceMode: false, // voice chat: speak replies and send dictated messages when you stop talking
});
export const normalizeVoice = (v) => ({ ...DEFAULT_VOICE(), ...(v || {}) });

const HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";

/**
 * Local speech-to-text models (whisper.cpp GGML files, MIT license, pinned to one repository commit). Size and SHA-256
 * come from the repository's LFS metadata; a download that does not match is discarded.
 */
export const SPEECH_MODELS = [
  { id: "whisper-tiny-q5_1", label: "Whisper tiny (multilingual, quantized)", file: "ggml-tiny-q5_1.bin", size: 32152673, sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7", languages: "99 languages", license: "MIT" },
  { id: "whisper-tiny.en-q5_1", label: "Whisper tiny (English, quantized)", file: "ggml-tiny.en-q5_1.bin", size: 32166155, sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b", languages: "English", license: "MIT" },
  { id: "whisper-base-q5_1", label: "Whisper base (multilingual, quantized)", file: "ggml-base-q5_1.bin", size: 59707625, sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", languages: "99 languages", license: "MIT" },
  { id: "whisper-small-q5_1", label: "Whisper small (multilingual, quantized)", file: "ggml-small-q5_1.bin", size: 190085487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", languages: "99 languages", license: "MIT" },
].map((m) => ({ ...m, url: `${HF}/${m.file}`, runtime: "whisper.cpp" }));

// ------------------------------------------------------------------ expressive text-to-speech

/** Text that should be read aloud: no code, links reduced to their label, no markdown symbols. */
export function speakableText(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?(```|$)/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Sentences with prosody for an expressive reading: questions rise, exclamations are brighter and a little faster,
 * trailing ellipses slow down, paragraph ends pause longer. Values are multipliers of the user's rate and pitch.
 * @returns {{text:string, rate:number, pitch:number, volume:number, pauseMs:number}[]}
 */
export function planSpeech(markdown, { expressive = true } = {}) {
  const text = speakableText(markdown);
  if (!text) return [];
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const parts = para.replace(/\n/g, " ").match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) || [];
    parts.forEach((raw, i) => {
      const s = raw.trim();
      if (!s || !/[\p{L}\p{N}]/u.test(s)) return;
      const seg = { text: s, rate: 1, pitch: 1, volume: 1, pauseMs: i === parts.length - 1 ? 450 : 150 };
      if (expressive) {
        if (/\?["”’)]*$/.test(s)) Object.assign(seg, { pitch: 1.12, rate: 0.98 });
        else if (/!["”’)]*$/.test(s)) Object.assign(seg, { pitch: 1.15, rate: 1.06, volume: 1 });
        else if (/(\.\.\.|…)["”’)]*$/.test(s)) Object.assign(seg, { rate: 0.9, pitch: 0.97, pauseMs: seg.pauseMs + 250 });
        else if (s.length > 160) seg.rate = 1.04; // long explanations a touch quicker
        if (/^(note|warning|careful|important)\b/i.test(s)) Object.assign(seg, { rate: 0.94, pitch: 0.95 });
      }
      out.push(seg);
    });
  }
  return out;
}

/** Picks a voice: the chosen one, else an on-device voice for the language, else any for the language. */
export function pickVoice(voices, { voice = "", lang = "en", localVoicesOnly = true } = {}) {
  const pool = (voices || []).filter((v) => !localVoicesOnly || v.localService);
  const chosen = pool.find((v) => v.voiceURI === voice);
  if (chosen) return chosen;
  const base = String(lang).split("-")[0].toLowerCase();
  const same = pool.filter((v) => String(v.lang).toLowerCase().split(/[-_]/)[0] === base);
  return same.find((v) => v.default) || same[0] || null;
}

// ------------------------------------------------------------------ SHA-256 (streaming)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Incremental SHA-256: update(bytes) any number of times, then hex(). Memory stays constant for any file size. */
export class Sha256 {
  #h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  #buf = new Uint8Array(64);
  #n = 0; // bytes in #buf
  #len = 0; // total bytes
  #w = new Uint32Array(64);

  update(bytes) {
    let i = 0;
    this.#len += bytes.length;
    if (this.#n) {
      const take = Math.min(64 - this.#n, bytes.length);
      this.#buf.set(bytes.subarray(0, take), this.#n);
      this.#n += take;
      i = take;
      if (this.#n === 64) {
        this.#block(this.#buf, 0);
        this.#n = 0;
      }
    }
    for (; i + 64 <= bytes.length; i += 64) this.#block(bytes, i);
    if (i < bytes.length) {
      this.#buf.set(bytes.subarray(i), 0);
      this.#n = bytes.length - i;
    }
    return this;
  }

  hex() {
    const bits = this.#len * 8;
    const pad = new Uint8Array((this.#n < 56 ? 56 : 120) - this.#n + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    dv.setUint32(pad.length - 4, bits >>> 0);
    this.#len -= pad.length; // padding does not count as message length
    this.update(pad);
    return [...this.#h].map((x) => x.toString(16).padStart(8, "0")).join("");
  }

  #block(b, o) {
    const w = this.#w;
    for (let t = 0; t < 16; t++) w[t] = (b[o + 4 * t] << 24) | (b[o + 4 * t + 1] << 16) | (b[o + 4 * t + 2] << 8) | b[o + 4 * t + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = this.#h;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    const H = this.#h;
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
}

/**
 * Streams a model download through `onChunk` while hashing; rejects on a size or checksum mismatch.
 * @param {ReadableStream<Uint8Array>|AsyncIterable<Uint8Array>} stream
 * @param {{size:number, sha256:string}} model
 * @param {{onChunk?:(bytes:Uint8Array)=>Promise<void>|void, onProgress?:(done:number,total:number)=>void, signal?:AbortSignal}} [o]
 */
export async function verifyStream(stream, model, { onChunk, onProgress, signal } = {}) {
  const hash = new Sha256();
  let done = 0;
  const iter = stream.getReader ? readerIterable(stream.getReader()) : stream;
  for await (const chunk of iter) {
    if (signal?.aborted) throw signal.reason || new Error("Cancelled.");
    done += chunk.length;
    if (done > model.size) throw new Error("The download is larger than expected; it was discarded.");
    hash.update(chunk);
    await onChunk?.(chunk);
    onProgress?.(done, model.size);
  }
  if (done !== model.size) throw new Error(`The download is incomplete (${done} of ${model.size} bytes); it was discarded.`);
  const hex = hash.hex();
  if (hex !== model.sha256) throw new Error("The checksum of the download does not match; it was discarded.");
  return { bytes: done, sha256: hex };
}

async function* readerIterable(reader) {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}
