// Vibe tools for tonal analysis: get_histogram and auto_correct_suggestion (read-only).
import { tool, S, nodesById, requireDoc } from "./helpers.js";
import { summarize, channelHistogram, rebin, assess, autoCorrectSuggestion, HIST_CHANNELS, CHANNEL_LABELS, tonalShares } from "../../engine/pixel/histogram-analysis.js";

const SOURCES = ["composite", "layer", "selection", "upto"];
const r1 = (v) => Math.round(v * 10) / 10;

async function analyze(app, a) {
  requireDoc(app);
  const { resolveSource, analyzeSource } = await import("../../ui/histogram/source.js");
  const node = a.layerId ? nodesById(app, [a.layerId])[0] : null;
  const src = resolveSource(app, a.source || (node ? "layer" : "composite"), node);
  const res = analyzeSource(src);
  return { src, res };
}

export function pixelAnalysisTools(app) {
  const common = {
    source: S.str("What to measure: composite (all visible layers, default), layer (one layer's own pixels), selection (composite inside the current pixel selection), upto (the result up to and including a layer)", { enum: SOURCES }),
    layerId: S.str("Layer id from list_layers for source 'layer' or 'upto' (default: the active layer)"),
  };
  return [
    tool("get_histogram", "Measures the tonal distribution of the image: statistics (mean, median, standard deviation, min/max, percent of shadows and highlights clipped), 64-bin histogram data and a plain-language assessment (underexposed, overexposed, low contrast, clipping, color cast) with suggested adjustments whose params can be passed to apply_adjustment. Call this first when retouching or color-correcting a photo.", {
      ...common,
      channel: S.str("Channel for the statistics and bins: luma (default), rgb (all channels), r, g, b or lab (CIE L*)", { enum: HIST_CHANNELS }),
    }, [], async (a) => {
      const ch = a.channel && HIST_CHANNELS.includes(a.channel) ? a.channel : "luma";
      const { src, res } = await analyze(app, a);
      const an = res.a;
      const st = summarize(an, ch);
      const h64 = rebin(channelHistogram(an, ch), 64);
      const total = h64.reduce((s, v) => s + v, 0) || 1;
      const ass = assess(an);
      return {
        source: src.label,
        notes: src.note,
        approximate: res.approx,
        channel: CHANNEL_LABELS[ch],
        pixels: st.pixels,
        stats: { mean: r1(st.mean), median: st.median, stddev: r1(st.stddev), min: st.min, max: st.max, p1: st.p1, p99: st.p99, shadowsClippedPercent: r1(st.shadowsClipped), highlightsClippedPercent: r1(st.highlightsClipped) },
        tonalSharePercent: { shadows: Math.round(tonalShares(channelHistogram(an, ch))[0]), darkMidtones: Math.round(tonalShares(channelHistogram(an, ch))[1]), lightMidtones: Math.round(tonalShares(channelHistogram(an, ch))[2]), highlights: Math.round(tonalShares(channelHistogram(an, ch))[3]) },
        bins64: { description: "64 bins of 4 levels each (bin i covers levels 4i..4i+3); values are percent of samples", percent: Array.from(h64, (v) => r1((v / total) * 100)) },
        assessment: { exposure: ass.exposure, contrast: ass.contrast, colorCast: ass.cast, clipping: { shadowsPercent: r1(ass.clipping.shadows), highlightsPercent: r1(ass.clipping.highlights), shadows: ass.clipping.shadowsLevel, highlights: ass.clipping.highlightsLevel, channels: ass.clipping.channels }, issues: ass.issues, summary: ass.summary },
        suggestions: ass.suggestions.map((s) => ({ ...s, apply: `apply_adjustment kind "adjustment" id "${s.id}" with these params` })),
      };
    }, { readOnly: true }),

    tool("auto_correct_suggestion", "Recommends Levels, Curves, color-correction (per-channel Levels) and Exposure parameters for the image, computed from its histogram. Nothing is changed: pass the returned objects as params to apply_adjustment (kind 'adjustment', id 'levels' or 'curves' or 'exposure').", {
      ...common,
      clip: S.num("Percent of pixels ignored at each end when finding the black and white points (default 0.3)", { minimum: 0, maximum: 5 }),
    }, [], async (a) => {
      const { src, res } = await analyze(app, a);
      const s = autoCorrectSuggestion(res.a, { clip: a.clip ?? 0.3 });
      return {
        source: src.label,
        approximate: res.approx,
        levels: { id: "levels", params: s.levels, note: "Black point, white point and midtone gamma (contrast stretch)." },
        curves: { id: "curves", params: s.curves, note: "Master curve points [[x,y],...] in 0..1: stretch plus a gentle S-curve." },
        colorLevels: { id: "levels", params: s.colorLevels, note: "Per-channel gamma and black/white points that neutralize a color cast (only if assess says there is one)." },
        exposure: { id: "exposure", params: s.exposure, note: "Exposure in EV that moves the median to a mid tone; use for clearly dark or bright images." },
        notes: s.notes,
      };
    }, { readOnly: true }),
  ];
}
