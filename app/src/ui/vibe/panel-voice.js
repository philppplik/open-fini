// Settings ▸ Artificial intelligence ▸ Voice: spoken replies (on-device voices, expressive reading), speech input
// engine (off, system recognizer with a disclosure, local model) and the local model manager (download with approval
// and checksum, delete). Logic: ../../vibe/speech.js (pure) and ../../vibe/speech-runtime.js. docs/vibe-voice.md.
import { h, empty, formatBytes } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";
import { DEFAULT_VOICE, normalizeVoice, SPEECH_MODELS } from "../../vibe/speech.js";

const STT = [
  ["off", N_("Off")],
  ["system", N_("System speech recognition")],
  ["local", N_("Local model (on this device)")],
];

// catalog texts (vibe/speech.js keeps English data; shown translated here)
const MODEL_LABELS = {
  "whisper-tiny-q5_1": N_("Whisper tiny (multilingual, quantized)"),
  "whisper-tiny.en-q5_1": N_("Whisper tiny (English, quantized)"),
  "whisper-base-q5_1": N_("Whisper base (multilingual, quantized)"),
  "whisper-small-q5_1": N_("Whisper small (multilingual, quantized)"),
};
const LANGS = { "99 languages": N_("99 languages"), English: N_("English") };
const label = (m) => (MODEL_LABELS[m.id] ? t(MODEL_LABELS[m.id]) : m.label);

export function createVoicePanel(vs) {
  const { app } = vs;
  const el = h("div.of-vweb");
  const get = () => normalizeVoice(vibeStore.settings.voice);
  const save = (patch) => vibeStore.saveSettings({ voice: { ...get(), ...patch } });
  const field = (label, control, hint) => h("label.of-vfield", h("span", label), control, hint ? h("small", hint) : null);
  const downloads = new Map(); // id -> { pct, ctl }

  let gen = 0;
  async function render() {
    const my = ++gen;
    const R = await import("../../vibe/speech-runtime.js");
    const v = get();
    const all = await R.voices();
    const installed = v.stt === "local" ? await R.installedModels() : [];
    if (my !== gen) return; // a newer render started meanwhile
    empty(el);

    // ---- spoken replies
    const tts = h("sl-switch", { size: "small", disabled: !R.ttsAvailable() }, t("Read Vibe's replies aloud"));
    tts.checked = v.tts;
    tts.addEventListener("sl-change", () => save({ tts: tts.checked }).then(render));
    const pool = all.filter((x) => !v.localVoicesOnly || x.localService);
    const voiceSel = h("select.of-vfield__in", { "aria-label": t("Voice") }, h("option", { value: "" }, t("Automatic (language of the interface)")), ...pool.map((x) => h("option", { value: x.voiceURI, selected: x.voiceURI === v.voice }, `${x.name} (${x.lang})${x.localService ? "" : ` · ${t("online")}`}`)));
    voiceSel.addEventListener("change", () => save({ voice: voiceSel.value }));
    const local = h("sl-switch", { size: "small" }, t("Only voices that run on this device"));
    local.checked = v.localVoicesOnly;
    local.addEventListener("sl-change", () => save({ localVoicesOnly: local.checked }).then(render));
    const expr = h("sl-switch", { size: "small" }, t("Expressive reading"));
    expr.checked = v.expressive;
    expr.addEventListener("sl-change", () => save({ expressive: expr.checked }));
    const slider = (key, min, max, label) => {
      const r = h("input", { type: "range", min, max, step: "0.05", value: String(v[key]), "aria-label": label });
      r.addEventListener("change", () => save({ [key]: Number(r.value) }));
      return field(label, r);
    };
    const test = h("button.of-btn", { type: "button" }, iconEl("volume-up"), t("Test voice"));
    test.addEventListener("click", () => R.speak(t("Hello! I am Vibe. Shall we make something nice today? Let's go."), get(), app.i18n?.locale?.() || "en").catch((e) => app.toast(e.message, "warning", 4000)));
    el.append(h("div.of-vcard", h("strong", t("Spoken replies")),
      h("p.of-hint", t("Vibe reads its answers sentence by sentence with the speech engine of your system. On-device voices keep the text on this device; online voices (offered by some browsers) send it to the browser vendor.")),
      R.ttsAvailable() ? tts : h("p.of-hint", t("Speech output is not available here.")),
      field(t("Voice"), voiceSel, pool.length ? null : t("No voice found. Install voices in your operating system's speech settings.")),
      local, expr, h("small.of-hint", t("Questions rise, exclamations sound brighter, pauses follow sentences and paragraphs; code is skipped.")),
      slider("rate", "0.5", "2", t("Speed")), slider("pitch", "0.5", "1.5", t("Pitch")), h("div.of-vmem__row", test, h("button.of-btn", { type: "button", onclick: () => R.stopSpeaking() }, iconEl("stop-fill"), t("Stop")))));

    // ---- speech input
    const sttSel = h("select.of-vfield__in", { "aria-label": t("Speech input") }, ...STT.map(([k, l]) => h("option", { value: k, selected: k === v.stt, disabled: k === "system" && !R.systemSttAvailable() }, t(l))));
    sttSel.addEventListener("change", async () => {
      if (sttSel.value === "system" && !(await confirmDialog({ title: t("System speech recognition"), message: t("In Chrome, Edge and other Chromium-based browsers the system recognizer sends your voice to the browser vendor's online service. Safari and some systems recognize on the device. Use it anyway?"), ok: t("Use it") }))) return render();
      save({ stt: sttSel.value }).then(render);
    });
    const card = h("div.of-vcard", h("strong", t("Speech input")), h("p.of-hint", t("Used by the microphone button and voice chat. The system recognizer is the default, as before; choose Off to hide the microphone.")), field(t("Engine"), sttSel));
    if (v.stt === "local") {
      // engines from extensions plug in through the engine registry (platform/engines.js, docs/engines.md)
      const { ensureBuiltinEngines } = await import("../../platform/builtin-engines.js");
      const eng = ensureBuiltinEngines().pick("stt", { local: true });
      card.append(eng
        ? h("div.of-vnote.info", iconEl("check-circle"), h("span", t("Local recognizer: {name}. The audio stays on this device.", { name: eng.origin?.name ? `${eng.label} (${eng.origin.name})` : eng.label })))
        : h("div.of-vnote.info", iconEl("info-circle"), h("span", t("No local recognizer is installed. OpenFini does not bundle one yet (whisper.cpp in WebAssembly); an extension can add one. You can already download and verify a model for it; dictation stays unavailable until a recognizer is installed."))));
      const list = h("div.of-vmem__list", { role: "list" });
      for (const m of SPEECH_MODELS) {
        const have = installed.find((x) => x.id === m.id);
        const dl = downloads.get(m.id);
        const pick = h("input", { type: "radio", name: "of-stt-model", checked: v.sttModel === m.id, disabled: !have, "aria-label": t("Use {model}", { model: label(m) }) });
        pick.addEventListener("change", () => save({ sttModel: m.id }));
        const act = dl
          ? h("button.of-btn.of-btn--sm", { type: "button", onclick: () => dl.ctl.abort(new Error(t("Download cancelled."))) }, `${dl.pct} % · ${t("Cancel")}`)
          : have
            ? h("button.of-btn.of-btn--sm", { type: "button", onclick: () => R.deleteModel(m.id).then(render) }, iconEl("trash3"), t("Delete"))
            : h("button.of-btn.of-btn--sm", { type: "button", onclick: () => download(R, m) }, iconEl("cloud-download"), t("Download…"));
        list.append(h("div.of-vmem__item", { role: "listitem" }, pick, h("div.of-vmem__text", h("span", label(m)), h("small", `${formatBytes(m.size)} · ${LANGS[m.languages] ? t(LANGS[m.languages]) : m.languages} · ${m.license}${have ? ` · ${t("verified")}` : ""}`)), h("div.of-vmem__acts", act)));
      }
      card.append(list);
    }
    el.append(card);

    const mode = h("sl-switch", { size: "small" }, t("Voice chat in the composer"));
    mode.checked = v.voiceMode;
    mode.addEventListener("sl-change", () => save({ voiceMode: mode.checked }));
    el.append(h("div.of-vcard", h("strong", t("Voice chat")), h("p.of-hint", t("Shows the voice chat button in the composer: speak, Vibe sends when you stop talking and reads the answer aloud. Typing or pressing the button again stops the reading.")), mode, h("button.of-btn", { type: "button", onclick: () => save({ ...DEFAULT_VOICE() }).then(render) }, t("Reset to defaults"))));
  }

  async function download(R, m) {
    const ok = await confirmDialog({
      title: t("Download a speech model"),
      message: t("Download “{model}” ({size}) from {host}? License: {license}. The file is checked against its SHA-256 checksum and stored only on this device.", { model: label(m), size: formatBytes(m.size), host: new URL(m.url).host, license: m.license }),
      ok: t("Download"),
    });
    if (!ok) return;
    const ctl = new AbortController();
    downloads.set(m.id, { pct: 0, ctl });
    render();
    let last = 0;
    try {
      await R.downloadModel(app, m.id, { signal: ctl.signal, onProgress: (d, total) => {
        const pct = Math.floor((d / total) * 100);
        downloads.get(m.id).pct = pct;
        if (pct !== last) {
          last = pct;
          const b = el.querySelector(`input[aria-label="${CSS.escape(t("Use {model}", { model: label(m) }))}"]`)?.closest(".of-vmem__item")?.querySelector(".of-vmem__acts button");
          if (b) b.textContent = `${pct} % · ${t("Cancel")}`;
        }
      } });
      await save({ sttModel: get().sttModel || m.id });
      app.toast(t("Model downloaded and verified."), "success", 2000);
    } catch (err) {
      app.toast(err.message || String(err), "danger", 5000);
    } finally {
      downloads.delete(m.id);
      render();
    }
  }

  render();
  return { el, show: render };
}
