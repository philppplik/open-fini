// The engines OpenFini ships, registered once in the app-wide registry (platform/engines.js). Each one loads its
// implementation on first use, so registering costs nothing at start-up. docs/engines.md.
import { engines } from "./engines.js";

let done = false;

/** Registers the built-in engines (idempotent). Returns the registry. */
export function ensureBuiltinEngines(registry = engines) {
  if (done && registry === engines) return registry;
  if (registry === engines) done = true;
  const speech = () => import("../vibe/speech-runtime.js");
  // Chromium-based browsers and WebView2 send the audio to the vendor's online recognizer: not local
  registry.register("stt", { id: "system", label: "System speech recognition", local: false, listen: async (o) => (await speech()).listen(o) });
  // the Voice settings keep it to on-device voices unless the user allows online voices
  registry.register("tts", { id: "system", label: "System voices", local: true, speak: async (text, o = {}) => (await speech()).speak(text, o.settings || {}, o.lang || "en"), stop: async () => (await speech()).stopSpeaking() });
  registry.register("rag-loader", {
    id: "pdf",
    label: "PDF text layer",
    local: true,
    extensions: [".pdf"],
    mimes: ["application/pdf"],
    load: async (bytes, o = {}) => {
      const { loadPdfText } = await import("../vibe/rag-pdf.js");
      return loadPdfText(bytes, { ...o, ocr: o.ocr === undefined ? registry.pick("ocr") : o.ocr });
    },
  });
  return registry;
}
