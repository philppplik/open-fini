// Compiling LaTeX projects to PDF (lazy; see docs/latex.md). The desktop app runs a TeX engine installed on this
// computer through the latex_compile command (src-tauri/src/latex.rs: allow-listed arguments, no shell, timeout).
// The web build can only compile through a remote service the user configured (Settings ▸ Code studio ▸ LaTeX);
// there is no default service, so nothing leaves the device unless the user sets one up.
import { findMainTex, parseLatexLog, LATEX_ENGINES } from "../../engine/web/index.js";
import { invokeNet, nativeNetAvailable, bytesToBase64 } from "../../platform/native-net.js";

export class LatexUnavailableError extends Error {}

let enginesCache = null;

/** The TeX engines found on this computer ([] on the web). */
export async function installedEngines({ refresh = false } = {}) {
  if (!nativeNetAvailable()) return [];
  if (!enginesCache || refresh) enginesCache = await invokeNet("latex_engines").catch(() => []);
  return enginesCache;
}

/** The main .tex file for `path`: the file itself when it has \documentclass, else the project's main file. */
export function mainFileFor(web, path) {
  if (path && /\.(tex|latex)$/i.test(path) && /\\documentclass/.test(web.text(path) || "")) return path;
  return findMainTex(web.paths, (p) => web.text(p));
}

const base64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Project files as [{ path, data: base64 }] (skips big binaries that TeX cannot use). */
function projectFiles(web) {
  const out = [];
  for (const p of web.paths) {
    if (/\.(mp4|webm|mp3|wav|zip|psd)$/i.test(p)) continue;
    const bytes = web.isText(p) ? new TextEncoder().encode(web.text(p)) : web.bytes(p);
    if (bytes) out.push({ path: p, data: bytesToBase64(bytes) });
  }
  return out;
}

/**
 * Compiles the project. Resolves { ok, main, engine, via, log, problems, pdf: Uint8Array | null, timedOut }.
 * Throws LatexUnavailableError (with a message for people) when no engine or service is available.
 */
export async function compileLatex(app, web, path, { timeoutSecs = 120 } = {}) {
  const main = mainFileFor(web, path);
  if (!main) throw new LatexUnavailableError("This project has no .tex file with \\documentclass to compile.");
  const files = projectFiles(web);
  let res;
  let engine;
  let via;
  if (nativeNetAvailable()) {
    const engines = await installedEngines({ refresh: true });
    const pref = app.prefs.latexEngine;
    engine = pref && pref !== "auto" && engines.includes(pref) ? pref : LATEX_ENGINES.find((e) => engines.includes(e));
    if (!engine) throw new LatexUnavailableError("No TeX engine was found on this computer. Install TeX Live, MiKTeX, MacTeX or Tectonic (make sure pdflatex, latexmk or tectonic is on the PATH), then try again. The approximate preview keeps working without one.");
    via = "local";
    res = await invokeNet("latex_compile", { engine, main, files, timeoutSecs });
  } else {
    const url = app.prefs.latexRemoteUrl;
    if (!url) throw new LatexUnavailableError("Compiling LaTeX to PDF needs the OpenFini desktop app with a TeX distribution installed. In the browser you can set an optional remote compile service in Settings ▸ Code studio ▸ LaTeX. The approximate preview works everywhere.");
    app.network?.assert("other", url);
    engine = app.prefs.latexEngine === "auto" ? "pdflatex" : app.prefs.latexEngine;
    via = "remote";
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine, main, files }), credentials: "omit" });
    if (/application\/pdf/.test(r.headers.get("content-type") || "")) res = { ok: r.ok, log: "", pdf: bytesToBase64(new Uint8Array(await r.arrayBuffer())) };
    else {
      const j = await r.json().catch(() => ({}));
      res = { ok: r.ok && !!j.pdf, log: String(j.log || (r.ok ? "" : `HTTP ${r.status}`)), pdf: j.pdf || null };
    }
  }
  const problems = parseLatexLog(res.log, main);
  return { ok: !!res.ok, main, engine, via, log: res.log || "", problems, pdf: res.pdf ? base64ToBytes(res.pdf) : null, timedOut: !!res.timedOut };
}

/** Renders a PDF into `container` (one canvas per page, at most 60 pages) with the bundled pdf.js. */
export async function renderPdfInto(container, bytes, { scale = 1.4 } = {}) {
  const { openPdf } = await import("../../core/pdf-source.js");
  const src = await openPdf(bytes);
  container.replaceChildren();
  try {
    for (let i = 1; i <= Math.min(src.pages, 60); i++) {
      const page = await src.doc.getPage(i);
      const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
      canvas.className = "of-texpdf__page";
      container.append(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
  } finally {
    src.destroy();
  }
  return src.pages;
}
