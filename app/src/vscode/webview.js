// Webviews of VS Code web extensions (createWebviewPanel, registerWebviewViewProvider): turns the HTML an extension
// sets into the document of a sandboxed frame. Pure (no DOM), tested in tests/vscode/webview.test.js.
//
// Public API
//   prepareWebviewHtml(html, { extId, files, state, vars, dark })  -> srcdoc text
//   WEBVIEW_CSP                                                    the frame's base policy
//   themeVariables(get)                                            OpenFini theme values -> { "--vscode-…": value }
//
// Invariants
// - The frame is `sandbox="allow-scripts"` (opaque origin, no same-origin access, no top navigation, no popups) and its
//   policy forbids every network request (connect-src, frame-src, form-action 'none'; images, fonts and scripts only
//   from data: or inline). The extension's own CSP <meta> still applies on top.
// - Extension files are referenced as `openfini-ext://<extension id>/<path>` (Webview.asWebviewUri returns the URI it is
//   given); every such reference to a file of the package becomes a data: URI here (stylesheets get their relative
//   url(…) references inlined too). Unknown files become an empty data: URI. Nothing else is fetched.
// - acquireVsCodeApi() is defined by a small inline script that talks to the host with postMessage only; the host
//   checks that messages come from this frame.

export const WEBVIEW_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", html: "text/html", wasm: "application/wasm" };
const MAX_INLINE = 8 * 1024 * 1024;

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}

const dirOf = (p) => p.split("/").slice(0, -1).join("/");
function joinRel(dir, ref) {
  const out = dir ? dir.split("/") : [];
  for (const part of ref.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** A data: URI for a package file; stylesheets have their relative url() references inlined as well. */
function dataUri(files, path, depth = 0) {
  const bytes = files[path];
  const ext = (/\.([^./]+)$/.exec(path)?.[1] || "").toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  if (!bytes || bytes.length > MAX_INLINE) return `data:${mime};base64,`;
  if (ext === "css" && depth < 2) {
    const css = new TextDecoder().decode(bytes).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
      if (/^(data:|https?:|#|\/\/)/i.test(ref)) return m;
      const target = joinRel(dirOf(path), ref.split(/[?#]/)[0]);
      return `url("${dataUri(files, target, depth + 1)}")`;
    });
    return `data:text/css;base64,${base64(new TextEncoder().encode(css))}`;
  }
  return `data:${mime};base64,${base64(bytes)}`;
}

/** OpenFini theme values -> the CSS variables VS Code webviews style themselves with. `get(name)` reads `--of-*`. */
export function themeVariables(get) {
  const v = (n, d = "") => (get(n) || d).trim();
  const fg = v("--of-text", "#ddd");
  const bg = v("--of-bg-panel", "#1e1e1e");
  const accent = v("--of-accent", "#4f8cff");
  const border = v("--of-border", "#444");
  const input = v("--of-bg-input", bg);
  const font = v("--of-font", "system-ui, sans-serif");
  const mono = v("--of-mono", "ui-monospace, monospace");
  return {
    "--vscode-font-family": font,
    "--vscode-font-size": "13px",
    "--vscode-font-weight": "normal",
    "--vscode-foreground": fg,
    "--vscode-descriptionForeground": v("--of-text-dim", fg),
    "--vscode-disabledForeground": v("--of-text-faint", fg),
    "--vscode-errorForeground": v("--of-danger", "#f14c4c"),
    "--vscode-focusBorder": accent,
    "--vscode-editor-background": v("--of-editor-bg", bg),
    "--vscode-editor-foreground": fg,
    "--vscode-editor-font-family": mono,
    "--vscode-editor-font-size": "13px",
    "--vscode-sideBar-background": bg,
    "--vscode-sideBar-foreground": fg,
    "--vscode-panel-background": bg,
    "--vscode-panel-border": border,
    "--vscode-widget-border": border,
    "--vscode-button-background": accent,
    "--vscode-button-foreground": v("--of-on-accent", "#fff"),
    "--vscode-button-hoverBackground": v("--of-accent-strong", accent),
    "--vscode-button-secondaryBackground": v("--of-bg-raised", bg),
    "--vscode-button-secondaryForeground": fg,
    "--vscode-input-background": input,
    "--vscode-input-foreground": fg,
    "--vscode-input-border": border,
    "--vscode-input-placeholderForeground": v("--of-text-faint", fg),
    "--vscode-dropdown-background": input,
    "--vscode-dropdown-foreground": fg,
    "--vscode-dropdown-border": border,
    "--vscode-checkbox-background": input,
    "--vscode-checkbox-border": border,
    "--vscode-list-hoverBackground": v("--of-hover", "rgba(128,128,128,.15)"),
    "--vscode-list-activeSelectionBackground": v("--of-accent-soft", accent),
    "--vscode-list-activeSelectionForeground": fg,
    "--vscode-textLink-foreground": accent,
    "--vscode-textLink-activeForeground": accent,
    "--vscode-textCodeBlock-background": v("--of-bg-raised", bg),
    "--vscode-badge-background": accent,
    "--vscode-badge-foreground": v("--of-on-accent", "#fff"),
    "--vscode-scrollbarSlider-background": v("--of-scroll-thumb", "rgba(128,128,128,.4)"),
    "--vscode-editorWidget-background": v("--of-bg-raised", bg),
    "--vscode-notifications-background": v("--of-bg-raised", bg),
    "--vscode-charts-red": v("--of-danger", "#f14c4c"),
    "--vscode-charts-green": v("--of-ok", "#89d185"),
    "--vscode-charts-yellow": v("--of-warn", "#cca700"),
    "--vscode-charts-blue": accent,
  };
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The inline script that defines acquireVsCodeApi() (state is kept by the host across reloads of the frame). */
function shim(state) {
  const init = JSON.stringify(state ?? null).replace(/</g, "\\u003c");
  return `(function(){var state=${init};var taken=false;var post=function(t,d){parent.postMessage({vsxw:1,t:t,d:d},"*");};var api=Object.freeze({postMessage:function(m){post("msg",m);},getState:function(){return state;},setState:function(s){state=s;post("state",s);return s;}});window.acquireVsCodeApi=function(){if(taken)throw new Error("An instance of the VS Code API has already been acquired");taken=true;return api;};document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");if(/^https?:/i.test(h)){e.preventDefault();post("link",h);}else if(h&&h.charAt(0)!=="#"){e.preventDefault();}},true);})();`;
}

/**
 * The srcdoc of a webview frame.
 * @param {string} html what the extension set as `webview.html`
 * @param {{ extId: string, files: Record<string, Uint8Array>, state?: unknown, vars?: Record<string, string>, dark?: boolean, scripts?: boolean }} o
 */
export function prepareWebviewHtml(html, { extId, files = {}, state = null, vars = {}, dark = true, scripts = true } = {}) {
  let doc = String(html || "").slice(0, 5 * 1024 * 1024);
  const id = String(extId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // openfini-ext://<id>/<path> (also with an encoded or doubled slash) -> data: URIs of the package files
  doc = doc.replace(new RegExp(`openfini-ext://${id}/+([^"'\\s)<>?#]*)(?:[?#][^"'\\s)<>]*)?`, "gi"), (m, p) => {
    let path = p;
    try {
      path = decodeURIComponent(p);
    } catch {
      /* keep */
    }
    return dataUri(files, path.replace(/^\/+/, ""));
  });
  const css = Object.entries(vars)
    .filter(([k, v]) => /^--vscode-[\w-]+$/.test(k) && !/[<>{};]/.test(String(v)))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  const kind = dark ? "vscode-dark" : "vscode-light";
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escAttr(scripts ? WEBVIEW_CSP : WEBVIEW_CSP.replace("script-src 'unsafe-inline' data:", "script-src 'none'"))}"><style>:root{${css}}html,body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);margin:0;padding:0 8px}a{color:var(--vscode-textLink-foreground)}</style>${scripts ? `<script>${shim(state)}</script>` : ""}`;
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  else doc = `<!doctype html><html><head>${head}</head><body>${doc}</body></html>`;
  // the body class VS Code sets (vscode-dark / vscode-light), as markup so no script is needed
  doc = doc.replace(/<body([^>]*)>/i, (m, attrs) => (/class\s*=/.test(attrs) ? `<body${attrs.replace(/class\s*=\s*(["'])/, `class=$1${kind} `)}>` : `<body class="${kind}"${attrs}>`));
  return doc;
}
