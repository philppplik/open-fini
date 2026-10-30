// Builds the documents that run inside the sandboxed frames: a strict Content-Security-Policy, the runtime,
// the extension's scripts (delivered as data: URLs, because inline scripts are blocked by the app's CSP) and
// for panels the extension's HTML with its relative scripts, styles and images inlined. Pure string work.

export const FRAME_CSP = "default-src 'none'; script-src data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", css: "text/css", js: "text/javascript", json: "application/json", txt: "text/plain" };

const BASE_CSS = `:root{color-scheme:light dark}html,body{margin:0}body{padding:10px;font:12px/1.45 var(--of-font,system-ui,sans-serif);color:var(--of-text,#222);background:var(--of-bg-panel,#fff)}
button,input,select,textarea{font:inherit;color:var(--of-text,#222);background:var(--of-bg-input,#fff);border:1px solid var(--of-border,#bbb);border-radius:var(--of-radius-sm,4px);padding:4px 8px;box-sizing:border-box}
button{cursor:pointer;background:var(--of-bg-raised,#f4f4f4)}button:hover{background:var(--of-hover,#eee)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--of-accent,#6b58e8);outline-offset:1px}
button.primary{background:var(--of-accent,#6b58e8);border-color:transparent;color:#fff}h1,h2,h3{margin:0 0 6px;font-size:13px}p{margin:0 0 8px;color:var(--of-text-dim,#555)}a{color:var(--of-accent,#6b58e8)}`;

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const ext = (p) => (p.split(".").pop() || "").toLowerCase();
const text = (bytes) => new TextDecoder().decode(bytes);

export const scriptUrl = (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
export const dataUri = (path, bytes) => `data:${MIME[ext(path)] || "application/octet-stream"};base64,${b64(bytes)}`;

/** Resolves a relative reference against the package (and the HTML file's folder). */
export function resolveRef(ref, fromPath, files) {
  if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const parts = fromPath.split("/").slice(0, -1);
  for (const seg of ref.split(/[?#]/)[0].split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const p = parts.join("/");
  return files[p] ? p : null;
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** The head every frame gets: CSP first, then base styles, then the runtime. */
function head(configJs, runtimeSrc) {
  return `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escAttr(FRAME_CSP)}"><style id="ofx-base">${BASE_CSS}</style><script src="${scriptUrl(`${configJs}\n${runtimeSrc}`)}"></script>`;
}

/**
 * The background frame only allows a blob: worker on top of FRAME_CSP. A worker made from a blob: URL inherits the
 * frame's policy (connect-src 'none', no nested workers) and its opaque origin.
 */
export const MAIN_CSP = FRAME_CSP.replace("worker-src 'none'", "worker-src blob:");

/**
 * The relay that runs in the background frame: it starts a dedicated worker with config + runtime (PRE) and the
 * extension's script (MAIN), forwards messages both ways, terminates the worker on `{t:"kill"}`, and falls back to
 * running the script in the frame itself when no worker can be started. The worker loads MAIN with importScripts in
 * try/catch, so a syntax error is reported as a start error. Written as a function so it is syntax-checked; serialized
 * with toString() and never run in the app.
 */
/* eslint-disable no-undef */
function relay(PRE, MAIN) {
  const url = (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  let w = null;
  let started = false;
  const up = (m) => parent.postMessage(m, "*");
  const fallback = (why) => {
    w = null;
    up({ ofx: 1, t: "log", level: "warn", text: `Running in the frame without a worker (${why}); a runaway loop cannot be stopped.` });
    for (const src of [url(PRE), url(MAIN), url("__ofxBoot()")]) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      document.head.append(s);
    }
  };
  try {
    const src = `self.window = self;\n${PRE}\ntry { importScripts(${JSON.stringify(url(MAIN))}); } catch (e) { self.__ofxLoadError = e; }\n__ofxBoot();\n`;
    w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  } catch (e) {
    return fallback(String((e && e.message) || e));
  }
  w.onmessage = (e) => {
    started = true;
    up(e.data);
  };
  w.onerror = (e) => {
    if (started) return void up({ ofx: 1, t: "log", level: "error", text: String(e.message || "Worker error") });
    e.preventDefault();
    w.terminate();
    fallback(String(e.message || "the worker failed to start"));
  };
  addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== parent || !w) return;
    if (d && d.ofx === 1 && d.t === "kill") {
      w.terminate();
      w = null;
      return;
    }
    w.postMessage(d);
  });
}
/* eslint-enable no-undef */

/** Document of an extension's background frame: a relay that runs the script in a worker (see relay()). */
export function buildMainDocument({ config, runtimeSrc, mainCode }) {
  const cfg = `const __OFX_CFG = ${JSON.stringify(config).replace(/</g, "\\u003c")};`;
  const relaySrc = `(${relay.toString()})(${JSON.stringify(`${cfg}\n${runtimeSrc}`)}, ${JSON.stringify(mainCode || "")});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escAttr(MAIN_CSP)}"><script src="${scriptUrl(relaySrc)}"></script></head><body></body></html>`;
}

/** Applies a removal until nothing changes, so nested fragments (`<ba<base>se>`) cannot reassemble into a tag. */
function removeAll(s, re) {
  let prev;
  do {
    prev = s;
    s = s.replace(re, "");
  } while (s !== prev);
  return s;
}

/** Document of a panel frame: the extension's HTML with local resources inlined. */
export function buildPanelDocument({ config, runtimeSrc, html, htmlPath, files }) {
  const cfg = `const __OFX_CFG = ${JSON.stringify({ ...config, panel: true }).replace(/</g, "\\u003c")};`;
  // Note: this is not a sanitizer. The extension's own panel scripts are meant to run; they are inlined as data: URLs and the frame
  // is sandboxed with a CSP that only allows data: scripts and no network. The removals below only drop tags that would escape that.
  let out = removeAll(removeAll(String(html), /<base\b[^>]*>/gi), /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi)
    .replace(/<script\b([^>]*?)\bsrc\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>\s*<\/script\b[^>]*>/gi, (m, a, _q, d, s, b) => {
      const p = resolveRef(d ?? s, htmlPath, files);
      return p ? `<script${a}src="${scriptUrl(text(files[p]))}"${b}></script>` : "";
    })
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi, (m, a, code) => (/\bsrc\s*=/i.test(a) ? m : `<script${a} src="${scriptUrl(code)}"></script>`))
    .replace(/<link\b[^>]*>/gi, (m) => {
      if (!/rel\s*=\s*["']?stylesheet/i.test(m)) return "";
      const p = resolveRef(/href\s*=\s*["']([^"']*)["']/i.exec(m)?.[1], htmlPath, files);
      return p ? `<style>${text(files[p])}</style>` : "";
    })
    .replace(/<(img|source)\b([^>]*?)\bsrc\s*=\s*"([^"]*)"/gi, (m, tag, a, src) => {
      const p = resolveRef(src, htmlPath, files);
      return p ? `<${tag}${a}src="${dataUri(p, files[p])}"` : m;
    });
  const h = head(cfg, runtimeSrc);
  const boot = `<script src="${scriptUrl("__ofxBoot()")}"></script>`;
  if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, (m) => m + h);
  else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${h}</head>`);
  else out = `<!doctype html><html><head>${h}</head><body>${out}</body></html>`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${boot}</body>`) : out + boot;
}
