// Scene Studio export dialog (Sequence ▸ Export Video…, File ▸ Export in the Scene Studio): format, size, frame
// rate, quality, range and sound, with progress and Cancel. Only formats this browser can encode are offered
// (scene/export.js ▸ exportSupport); the reasons for missing ones are shown.
import { h, downloadName } from "../core/util.js";
import { t } from "../i18n/index.js";
import { platform } from "../platform/index.js";
import { openDialog } from "../ui/dialogs.js";
import { duration, timecode } from "./model.js";
import { exportScene, exportSupport, defaultBitrate } from "./export.js";
import { captionCues, formatSrt, formatVtt } from "./captions.js";

const FORMATS = [
  { id: "mp4", label: "MP4 video (H.264)", need: "mp4", filter: "MP4" },
  { id: "webm", label: "WebM video (VP9)", need: "webm", filter: "WebM" },
  { id: "gif", label: "Animated GIF", need: "gif", filter: "GIF" },
  { id: "frames", label: "PNG image sequence (ZIP)", need: "frames", filter: "ZIP" },
  { id: "wav", label: "Sound only (WAV)", need: "wav", filter: "WAV" },
  { id: "png", label: "Current frame (PNG)", need: "frames", filter: "PNG" },
];

export async function sceneExportDialog(app) {
  const ui = app.sceneUI;
  if (!ui) return;
  ui.pause();
  const model = ui.model();
  const support = await exportSupport();
  const sel = (options, value) => {
    const s = h("select.of-scene-insp__sel", options.map((o) => h("option", { value: String(o.value), ...(o.disabled ? { disabled: true } : {}) }, o.label)));
    s.value = String(value);
    return s;
  };
  const format = sel(FORMATS.map((f) => ({ value: f.id, label: t(f.label), disabled: !support[f.need] })), support.mp4 ? "mp4" : support.webm ? "webm" : "gif");
  const size = sel([1, 0.75, 0.5, 0.25].map((s) => ({ value: s, label: `${Math.round(model.width * s)} × ${Math.round(model.height * s)}${s === 1 ? ` (${t("full size")})` : ""}` })), 1);
  const fps = sel([...new Set([model.fps, 30, 25, 24, 15, 12].filter((f) => f <= model.fps))].map((f) => ({ value: f, label: t("{n} frames per second", { n: f }) })), model.fps);
  const quality = h("input.of-scene-insp__range", { type: "range", min: "0.1", max: "1", step: "0.05", value: "0.7", "aria-label": t("Quality") });
  const range = sel([{ value: "all", label: t("Whole sequence ({time})", { time: timecode(model, duration(model)) }) }, { value: "io", label: model.range ? t("In to Out ({time})", { time: timecode(model, model.range.out - model.range.in) }) : t("In to Out (not set)"), disabled: !model.range }], "all");
  const sound = h("input", { type: "checkbox" });
  sound.checked = true;
  const estimate = h("p.of-scene-insp__hint");
  const bar = h("sl-progress-bar", { value: "0", style: "display:none" });
  const status = h("p.of-scene-insp__hint", { role: "status" });
  const row = (label, control) => h("label.of-scene-insp__row", h("span", label), h("div.of-scene-insp__ctl", control));
  const refresh = () => {
    const f = format.value;
    const video = f === "mp4" || f === "webm";
    quality.disabled = !video;
    sound.disabled = !video;
    fps.disabled = f === "wav" || f === "png";
    size.disabled = f === "wav";
    range.disabled = f === "png";
    const secs = range.value === "io" && model.range ? model.range.out - model.range.in : duration(model);
    if (video) {
      const s = +size.value;
      const bits = defaultBitrate(model.width * s, model.height * s, +fps.value, +quality.value) + 160000;
      estimate.textContent = t("About {size} MB.", { size: Math.max(0.1, Math.round(((bits * secs) / 8 / 1e6) * 10) / 10) });
    } else estimate.textContent = f === "gif" ? t("GIF has 256 colors and no sound. Keep it short and small.") : "";
  };
  for (const c of [format, size, fps, quality, range]) c.addEventListener("input", refresh);
  refresh();
  const cues = captionCues(model);
  const subs = (ext, fmt) => {
    const b = h("button.of-scene-insp__btn", { type: "button" }, t("Save subtitles as .{ext}", { ext }));
    b.addEventListener("click", async () => {
      await platform.saveFile({ suggestedName: downloadName(app.doc.name, ext), bytes: new TextEncoder().encode(fmt(cues)), mime: ext === "srt" ? "application/x-subrip" : "text/vtt", filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }).catch(() => {});
    });
    return b;
  };
  const body = h("div.of-scene-export",
    row(t("Format"), format), row(t("Size"), size), row(t("Frame rate"), fps), row(t("Quality"), quality), row(t("Range"), range),
    h("label.of-scene-insp__chk", sound, t("Include sound")),
    estimate,
    support.reason ? h("p.of-scene-insp__hint", t(support.reason)) : null,
    cues.length ? h("div.of-scene-insp__btns", subs("srt", formatSrt), subs("vtt", formatVtt)) : null,
    bar, status);
  let abort = null;
  let busy = false;
  const { dlg } = openDialog({
    title: t("Export Video"),
    body,
    width: 460,
    buttons: [
      { label: "Cancel", onClick: (close) => (abort ? abort.abort() : close()) },
      {
        label: "Export",
        variant: "primary",
        onClick: async (close) => {
          if (busy) return;
          busy = true;
          abort = new AbortController();
          bar.style.display = "";
          status.textContent = t("Rendering…");
          const f = FORMATS.find((x) => x.id === format.value);
          try {
            const res = await exportScene(ui.store, ui.model(), {
              format: f.id,
              scale: +size.value,
              fps: +fps.value,
              quality: +quality.value,
              audio: sound.checked,
              range: f.id === "png" ? { in: ui.state.t, out: ui.state.t + 1 } : range.value === "io" && model.range ? model.range : null,
              signal: abort.signal,
              onProgress: (p) => (bar.value = Math.round(p * 100)),
            });
            status.textContent = t("Saving…");
            await platform.saveFile({ suggestedName: downloadName(app.doc.name, res.ext), bytes: res.bytes, mime: res.mime, filters: [{ name: f.filter, extensions: [res.ext] }] });
            for (const n of res.notes) app.toast(t(n), "warning", 7000);
            close();
          } catch (err) {
            status.textContent = err.name === "AbortError" ? t("Export cancelled.") : t("The export failed: {message}", { message: err.message });
            bar.style.display = "none";
          } finally {
            busy = false;
            abort = null;
          }
        },
      },
    ],
    onClose: () => abort?.abort(),
  });
  return dlg;
}
