// Speech in the browser and the desktop web view: expressive playback with the Web Speech API (on-device voices by
// default), the system speech recognizer, and the local model manager (downloads verified chunk by chunk with SHA-256,
// stored in the origin-private file system). Pure parts: speech.js. docs/vibe-voice.md.
//
// Honest status: the local speech-to-text RUNTIME (whisper.cpp compiled to WebAssembly, run in a worker) is not bundled
// in this version. Models can be downloaded, verified, listed and deleted, and `transcribeLocal` reports that the
// runtime is missing. See docs/vibe-voice.md ▸ Local models.
import { planSpeech, pickVoice, verifyStream, SPEECH_MODELS, normalizeVoice } from "./speech.js";

const DIR = "speech-models";
let playing = null; // { stop }

// ------------------------------------------------------------------ text-to-speech

export const ttsAvailable = () => !!globalThis.speechSynthesis && !!globalThis.SpeechSynthesisUtterance;

/** Voices once the browser has loaded them (Chrome loads them asynchronously). */
export function voices() {
  if (!ttsAvailable()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Stops the current reading. */
export function stopSpeaking() {
  playing?.stop();
  playing = null;
}

export const isSpeaking = () => !!playing;

/**
 * Reads markdown aloud sentence by sentence with the prosody from planSpeech. Resolves when finished or stopped.
 * @param {string} markdown @param {object} settings vibe voice settings @param {string} lang UI language
 */
export async function speak(markdown, settings, lang = "en", { onState } = {}) {
  stopSpeaking();
  if (!ttsAvailable()) throw new Error("Speech output is not available here.");
  const s = normalizeVoice(settings);
  const voice = pickVoice(await voices(), { voice: s.voice, lang, localVoicesOnly: s.localVoicesOnly });
  if (!voice) throw new Error(s.localVoicesOnly ? "No on-device voice for this language. Install one in your operating system, or allow online voices in Settings ▸ Artificial intelligence ▸ Voice." : "No voice for this language is installed.");
  const plan = planSpeech(markdown, { expressive: s.expressive });
  let stopped = false;
  let timer = 0;
  const ctl = {
    stop() {
      stopped = true;
      clearTimeout(timer);
      speechSynthesis.cancel();
    },
  };
  playing = ctl;
  onState?.(true);
  try {
    for (const seg of plan) {
      if (stopped) break;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(seg.text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = Math.min(2, Math.max(0.5, s.rate * seg.rate));
        u.pitch = Math.min(2, Math.max(0, s.pitch * seg.pitch));
        u.volume = seg.volume;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
      if (!stopped && seg.pauseMs) await new Promise((r) => (timer = setTimeout(r, seg.pauseMs)));
    }
  } finally {
    if (playing === ctl) playing = null;
    onState?.(false);
  }
}

// ------------------------------------------------------------------ speech-to-text (system recognizer)

export const systemSttAvailable = () => !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);

/**
 * Starts the browser's or operating system's recognizer. Chromium-based browsers send the audio to an online service;
 * the Voice settings say so before this engine can be chosen.
 * @returns {{stop:()=>void}}
 */
export function listen({ lang = "en-US", continuous = true, onText, onEnd, onError }) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) throw new Error("Speech input is not available here.");
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = continuous; // false: ends after one utterance (voice chat)
  rec.onresult = (e) => onText?.([...e.results].map((r) => r[0].transcript).join(""), [...e.results].every((r) => r.isFinal));
  rec.onend = () => onEnd?.();
  rec.onerror = (e) => {
    onError?.(new Error(e.error === "not-allowed" ? "Microphone access was denied." : `Speech input failed (${e.error}).`));
    rec.stop();
  };
  rec.start();
  return { stop: () => rec.stop() };
}

// ------------------------------------------------------------------ local models (download, verify, store)

async function modelDir(create = true) {
  if (!navigator.storage?.getDirectory) throw new Error("This browser cannot store local models (no origin-private file system).");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

/** Installed (downloaded and verified) models: [{ id, bytes, sha256, time }]. */
export async function installedModels() {
  let dir;
  try {
    dir = await modelDir(false);
  } catch {
    return [];
  }
  const out = [];
  for (const m of SPEECH_MODELS) {
    try {
      const meta = JSON.parse(await (await (await dir.getFileHandle(`${m.id}.json`)).getFile()).text());
      if (meta.sha256 === m.sha256) out.push({ id: m.id, ...meta });
    } catch {
      /* not installed */
    }
  }
  return out;
}

/**
 * Downloads a model from the catalog, hashing while writing; a mismatch deletes the partial file. The caller asks
 * the user first (size, source, license). Offline mode blocks it.
 */
export async function downloadModel(app, id, { onProgress, signal } = {}) {
  const m = SPEECH_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model ${id}.`);
  app?.network?.assert?.("other", m.url);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est?.quota && est.quota - est.usage < m.size * 1.1) throw new Error("Not enough storage space for this model.");
  const dir = await modelDir(true);
  const fh = await dir.getFileHandle(m.file, { create: true });
  const out = await fh.createWritable();
  try {
    const res = await fetch(m.url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal });
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
    const r = await verifyStream(res.body, m, { onChunk: (c) => out.write(c), onProgress, signal });
    await out.close();
    const meta = await (await dir.getFileHandle(`${m.id}.json`, { create: true })).createWritable();
    await meta.write(JSON.stringify({ bytes: r.bytes, sha256: r.sha256, time: Date.now() }));
    await meta.close();
    return r;
  } catch (err) {
    await out.abort?.().catch(() => {});
    await dir.removeEntry(m.file).catch(() => {});
    throw err;
  }
}

export async function deleteModel(id) {
  const m = SPEECH_MODELS.find((x) => x.id === id);
  if (!m) return;
  const dir = await modelDir(false).catch(() => null);
  if (!dir) return;
  await dir.removeEntry(`${m.id}.json`).catch(() => {});
  await dir.removeEntry(m.file).catch(() => {});
}

/** The local runtime (whisper.cpp in WebAssembly) is not bundled in this version. */
export const localRuntimeAvailable = () => false;

export async function transcribeLocal() {
  throw new Error("Local speech recognition is not built into this version yet: models can be downloaded and verified, but the whisper.cpp runtime is not bundled. Use the system recognizer or type.");
}
