// Shared helpers for the framework templates (no build step: ES modules, import maps and CDN-delivered runtimes).

/**
 * Source text of template files is written inside JS template literals, so a backtick is written as "@~" and
 * "${" as "@{" and converted here.
 * @param {string} s
 */
export const fx = (s) => s.replace(/@~/g, "`").replace(/@\{/g, "${");

export const CDN = {
  tailwind: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11",
  bootstrapCss: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  bootstrapJs: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
  alpine: "https://cdn.jsdelivr.net/npm/@alpinejs/csp@3.14.9/dist/cdn.min.js",
  htmx: "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js",
  vue: "https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js",
  preact: "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js",
  react: "https://cdn.jsdelivr.net/npm/react@18.3.1/+esm",
  reactDom: "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm",
  htm: "https://cdn.jsdelivr.net/npm/htm@3.1.1/+esm",
  lit: "https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm",
  three: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
};

/** An HTML page with the usual head. `head` and `body` are inserted as written. */
export function page({ title, description, head = "", body, bodyAttrs = "" }) {
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
${head}</head>
<body${bodyAttrs}>
${body}
</body>
</html>
`;
}

export const importMap = (imports) => `  <script type="importmap">\n${JSON.stringify({ imports }, null, 2).replace(/^/gm, "  ")}\n  </script>\n`;

/** A small, readable stylesheet for the templates that do not bring a CSS framework. */
export const BASE_CSS = `:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #f5f6f8;
  --text: #1b1e24;
  --muted: #5a6270;
  --border: #dfe3e9;
  --accent: #4f46e5;
  --accent-ink: #ffffff;
  --radius: 12px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --surface: #1e2127;
    --text: #e8eaee;
    --muted: #a0a8b5;
    --border: #2f343c;
    --accent: #8b87ff;
    --accent-ink: #14161a;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.6 var(--font);
}

.skip-link {
  position: absolute;
  left: 8px;
  top: -48px;
  padding: 8px 14px;
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 8px;
  z-index: 10;
}

.skip-link:focus { top: 8px; }

.container { width: min(100% - 2rem, 960px); margin-inline: auto; }
main { padding: 2rem 0 4rem; }
h1, h2, h3 { line-height: 1.2; }
h1 { font-size: clamp(1.9rem, 4vw, 2.8rem); margin: 0 0 0.5rem; }
a { color: var(--accent); }
.lead { color: var(--muted); font-size: 1.15rem; max-width: 40rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem; }
.grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.muted { color: var(--muted); }

button, .btn {
  font: inherit;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

button:hover { border-color: var(--accent); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
input[type="text"], input[type="search"] {
  font: inherit;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}

.site-header { border-bottom: 1px solid var(--border); }
.site-header .container { display: flex; align-items: center; justify-content: space-between; min-height: 64px; }
.brand { font-weight: 700; text-decoration: none; color: var(--text); }
.done { text-decoration: line-through; color: var(--muted); }
ul.plain { list-style: none; padding: 0; margin: 0.75rem 0; display: grid; gap: 0.5rem; }

@media (max-width: 767px) {
  main { padding: 1.25rem 0 3rem; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

export const header = (name) => `  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="index.html">${name}</a>
      <span class="muted">No build step</span>
    </div>
  </header>`;
