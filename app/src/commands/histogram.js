// View ▸ clipping overlay commands (Histogram panel toggles share them). The overlay code loads on first use.
const hasDoc = (a) => !!a.doc;

export function registerHistogramCommands(app) {
  const toggle = (key) => (a) => {
    a.setPref(key, !a.prefs[key]);
    import("../ui/histogram/overlay.js").then((m) => {
      m.ensureClipOverlay(a).rebuild();
      a.requestOverlay();
    });
  };
  app.registerCommand("view.clipShadows", { label: "Show Shadow Clipping", run: toggle("histClipShadows"), enabled: hasDoc, checked: (a) => !!a.prefs.histClipShadows });
  app.registerCommand("view.clipHighlights", { label: "Show Highlight Clipping", run: toggle("histClipHighlights"), enabled: hasDoc, checked: (a) => !!a.prefs.histClipHighlights });
  if (app.prefs.histClipShadows || app.prefs.histClipHighlights) import("../ui/histogram/overlay.js").then((m) => m.ensureClipOverlay(app));
}
