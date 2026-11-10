// Speech in the browser and the desktop web view: expressive playback with the Web Speech API (on-device voices by
// default), the system speech recognizer, and the local model manager (downloads verified chunk by chunk with SHA-256,
// stored in the origin-private file system). Pure parts: speech.js. docs/vibe-voice.md.
//
// Honest status: no local speech-to-text engine is bundled (whisper.cpp in WebAssembly is not built here). Models can
// be downloaded, verified, listed and deleted; `listenLocal` uses a local `stt` engine from the engine registry when an
// extension provides one and otherwise says that none is installed. See docs/vibe-voice.md ▸ Local models.
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

/** A downloaded and verified model as a File (for local engines), or null. */
export async function openModel(id) {
  const m = SPEECH_MODELS.find((x) => x.id === id);
  if (!m || !(await installedModels()).some((x) => x.id === id)) return null;
  const dir = await modelDir(false);
  return (await dir.getFileHandle(m.file)).getFile();
}

// ------------------------------------------------------------------ local recognizers (engine registry)
// No local recognizer is bundled (whisper.cpp WebAssembly needs a reproducible build and a size decision, see
// docs/vibe-voice.md). Any `stt` engine with `local: true` from an extension plugs in here (platform/engines.js).

const localEngine = async () => {
  const { ensureBuiltinEngines } = await import("../platform/builtin-engines.js");
  return ensureBuiltinEngines().pick("stt", { local: true });
};

/** True when a local speech-to-text engine is registered. */
export const localRuntimeAvailable = async () => !!(await localEngine());

/**
 * Recognizes speech with the first local engine. Streaming engines (`listen`) are used directly; batch engines
 * (`transcribe`) get one utterance recorded from the microphone (speech-capture.js) and the chosen model.
 * Same callbacks as listen(); returns { stop }.
 */
export async function listenLocal({ lang = "en-US", continuous = true, model = "", onText, onEnd, onError }) {
  const engine = await localEngine();
  if (!engine) throw new Error("No local speech recognizer is installed. OpenFini does not bundle one yet; an extension can add one (docs/engines.md). Downloaded models are kept for it. Use the system recognizer or type.");
  if (engine.listen) return engine.listen({ lang, continuous, onText, onEnd, onError, model });
  const ctl = new AbortController();
  (async () => {
    try {
      const { recordUtterance, CAPTURE } = await import("./speech-capture.js");
      const pcm = await recordUtterance({ signal: ctl.signal });
      if (pcm.length && !ctl.signal.aborted) {
        const file = model ? await openModel(model) : null;
        const r = await engine.transcribe(pcm, { lang, sampleRate: CAPTURE.rate, signal: ctl.signal, model: file ? { id: model, file } : null });
        const text = String(r?.text ?? "").trim();
        if (text) onText?.(text, true);
      }
    } catch (err) {
      if (!ctl.signal.aborted) onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      onEnd?.();
    }
  })();
  return { stop: () => ctl.abort() };
}
