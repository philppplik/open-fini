// Code Snippets & Formatter: snippet pack, snippet helpers and API-driven file operations.
// Formatters live in lib-format.js (packed in front of this file). Imports of ./lib-*.js and ../../_shared/*.js are
// dropped when packed; `export` is stripped.
import { detectLanguage, formatCode, minifyCode, sortCssProperties } from "./lib-format.js";

export const STRINGS = {
  title: "Code Tools",
  noProject: "Open a website project in the Code studio first.",
  formatted: "Formatted {path}.",
  unchanged: "{path} is already formatted.",
  minified: "Wrote {path} ({before} to {after} bytes).",
  sorted: "Sorted CSS properties in {path}.",
  failed: "Could not process {path}: {error}",
  snippetSaved: "Snippet saved.",
};

/** Built-in snippet pack. Mirrored into the manifest by `node extensions/code-tools/build-manifest.mjs`. */
export const SNIPPETS = [
  { language: "html", label: "html5", detail: "HTML5 boilerplate", body: '<!doctype html>\n<html lang="${1:en}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${2:Page title}</title>\n  <link rel="stylesheet" href="${3:style.css}">\n</head>\n<body>\n  ${4}\n  <script src="${5:main.js}" defer></script>\n</body>\n</html>' },
  { language: "html", label: "form-contact", detail: "Accessible contact form", body: '<form action="${1:#}" method="post">\n  <div>\n    <label for="name">Name</label>\n    <input id="name" name="name" type="text" autocomplete="name" required>\n  </div>\n  <div>\n    <label for="email">Email</label>\n    <input id="email" name="email" type="email" autocomplete="email" required>\n  </div>\n  <div>\n    <label for="message">Message</label>\n    <textarea id="message" name="message" rows="5" required></textarea>\n  </div>\n  <button type="submit">${2:Send}</button>\n</form>' },
  { language: "html", label: "form-login", detail: "Login form", body: '<form class="login" action="${1:#}" method="post">\n  <h2>${2:Sign in}</h2>\n  <label for="user">Email</label>\n  <input id="user" name="user" type="email" autocomplete="username" required>\n  <label for="pass">Password</label>\n  <input id="pass" name="pass" type="password" autocomplete="current-password" required>\n  <button type="submit">Sign in</button>\n</form>' },
  { language: "html", label: "form-fieldset", detail: "Radio group with fieldset", body: '<fieldset>\n  <legend>${1:Choose one}</legend>\n  <label><input type="radio" name="${2:choice}" value="a" checked> ${3:Option A}</label>\n  <label><input type="radio" name="${2:choice}" value="b"> ${4:Option B}</label>\n</fieldset>' },
  { language: "html", label: "a11y-skip-link", detail: "Skip to content link", body: '<a class="skip-link" href="#${1:main}">Skip to content</a>' },
  { language: "html", label: "a11y-landmarks", detail: "Page with landmark regions", body: '<header>\n  <nav aria-label="${1:Main}">\n    <ul>\n      <li><a href="#">${2:Home}</a></li>\n    </ul>\n  </nav>\n</header>\n<main id="${3:main}">\n  <h1>${4:Title}</h1>\n  ${5}\n</main>\n<footer>\n  <p>&copy; ${6:2026} ${7:Company}</p>\n</footer>' },
  { language: "html", label: "a11y-dialog", detail: "Modal dialog element", body: '<button type="button" onclick="document.getElementById(\'${1:dlg}\').showModal()">${2:Open dialog}</button>\n<dialog id="${1:dlg}" aria-labelledby="${1:dlg}-title">\n  <h2 id="${1:dlg}-title">${3:Dialog title}</h2>\n  <p>${4:Content}</p>\n  <form method="dialog"><button>Close</button></form>\n</dialog>' },
  { language: "html", label: "a11y-accordion", detail: "Accordion with details", body: '<details>\n  <summary>${1:Question}</summary>\n  <p>${2:Answer}</p>\n</details>' },
  { language: "html", label: "a11y-tabs", detail: "ARIA tabs", body: '<div class="tabs">\n  <div role="tablist" aria-label="${1:Sections}">\n    <button role="tab" id="tab-1" aria-controls="panel-1" aria-selected="true">${2:One}</button>\n    <button role="tab" id="tab-2" aria-controls="panel-2" aria-selected="false" tabindex="-1">${3:Two}</button>\n  </div>\n  <div role="tabpanel" id="panel-1" aria-labelledby="tab-1">${4}</div>\n  <div role="tabpanel" id="panel-2" aria-labelledby="tab-2" hidden>${5}</div>\n</div>' },
  { language: "html", label: "a11y-img", detail: "Figure with caption and alt text", body: '<figure>\n  <img src="${1:image.jpg}" alt="${2:Describe the image}" width="${3:800}" height="${4:600}" loading="lazy">\n  <figcaption>${5:Caption}</figcaption>\n</figure>' },
  { language: "html", label: "meta-social", detail: "SEO and social meta tags", body: '<meta name="description" content="${1:Description}">\n<meta property="og:title" content="${2:Title}">\n<meta property="og:description" content="${1:Description}">\n<meta property="og:image" content="${3:/og.png}">\n<meta name="twitter:card" content="summary_large_image">' },
  { language: "html", label: "table-data", detail: "Accessible data table", body: '<table>\n  <caption>${1:Caption}</caption>\n  <thead>\n    <tr><th scope="col">${2:Column}</th><th scope="col">${3:Column}</th></tr>\n  </thead>\n  <tbody>\n    <tr><th scope="row">${4:Row}</th><td>${5:Value}</td></tr>\n  </tbody>\n</table>' },
  { language: "css", label: "reset", detail: "Modern CSS reset", body: '*, *::before, *::after { box-sizing: border-box; }\nbody { margin: 0; line-height: 1.5; -webkit-font-smoothing: antialiased; }\nimg, picture, video, canvas, svg { display: block; max-width: 100%; }\ninput, button, textarea, select { font: inherit; }\np, h1, h2, h3, h4 { overflow-wrap: break-word; }' },
  { language: "css", label: "flex-center", detail: "Center with flexbox", body: 'display: flex;\njustify-content: center;\nalign-items: center;' },
  { language: "css", label: "flex-row-wrap", detail: "Wrapping flex row with gap", body: 'display: flex;\nflex-wrap: wrap;\ngap: ${1:16px};' },
  { language: "css", label: "flex-space-between", detail: "Space between, centered vertically", body: 'display: flex;\njustify-content: space-between;\nalign-items: center;\ngap: ${1:16px};' },
  { language: "css", label: "grid-auto-fit", detail: "Responsive grid", body: 'display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(${1:240px}, 1fr));\ngap: ${2:24px};' },
  { language: "css", label: "grid-holy-grail", detail: "Header, sidebar, main, footer layout", body: 'display: grid;\ngrid-template: "header header" auto "nav main" 1fr "footer footer" auto / ${1:220px} 1fr;\nmin-height: 100vh;' },
  { language: "css", label: "grid-center", detail: "Center with grid", body: 'display: grid;\nplace-items: center;' },
  { language: "css", label: "sticky-footer", detail: "Footer sticks to the bottom", body: 'body {\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n}\nmain { flex: 1; }' },
  { language: "css", label: "fluid-type", detail: "Fluid typography with clamp()", body: 'font-size: clamp(${1:1rem}, ${2:1rem + 1vw}, ${3:1.5rem});' },
  { language: "css", label: "visually-hidden", detail: "Hide visually, keep for screen readers", body: '.visually-hidden {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  margin: -1px;\n  padding: 0;\n  overflow: hidden;\n  clip: rect(0 0 0 0);\n  white-space: nowrap;\n  border: 0;\n}' },
  { language: "css", label: "focus-visible", detail: "Clear focus ring", body: ':focus-visible {\n  outline: 3px solid ${1:#2563eb};\n  outline-offset: 2px;\n}' },
  { language: "css", label: "media-mobile", detail: "Max-width media query", body: '@media (max-width: ${1:640px}) {\n  ${2}\n}' },
  { language: "css", label: "media-tablet-up", detail: "Min-width media query", body: '@media (min-width: ${1:768px}) {\n  ${2}\n}' },
  { language: "css", label: "media-dark", detail: "Dark mode", body: '@media (prefers-color-scheme: dark) {\n  :root {\n    --bg: ${1:#111};\n    --text: ${2:#eee};\n  }\n}' },
  { language: "css", label: "media-reduced-motion", detail: "Respect reduced motion", body: '@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n  }\n}' },
  { language: "css", label: "anim-fade-in", detail: "Fade in keyframes", body: '@keyframes fade-in {\n  from { opacity: 0; transform: translateY(8px); }\n  to { opacity: 1; transform: none; }\n}\n.${1:fade-in} { animation: fade-in ${2:400ms} ease-out both; }' },
  { language: "css", label: "anim-spin", detail: "Spinner rotation", body: '@keyframes spin { to { transform: rotate(360deg); } }\n.${1:spinner} { animation: spin 1s linear infinite; }' },
  { language: "css", label: "anim-pulse", detail: "Pulse animation", body: '@keyframes pulse {\n  0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.06); }\n}\n.${1:pulse} { animation: pulse 2s ease-in-out infinite; }' },
  { language: "css", label: "transition-hover", detail: "Smooth hover transition", body: 'transition: ${1:transform} 200ms ease, ${2:box-shadow} 200ms ease;' },
  { language: "css", label: "card", detail: "Simple card", body: '.card {\n  padding: ${1:1.25rem};\n  border: 1px solid ${2:#e5e7eb};\n  border-radius: ${3:12px};\n  background: ${4:#fff};\n  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);\n}' },
  { language: "css", label: "vars-theme", detail: "Design tokens", body: ':root {\n  --color-bg: ${1:#ffffff};\n  --color-text: ${2:#111827};\n  --color-accent: ${3:#2563eb};\n  --radius: ${4:12px};\n  --space: ${5:1rem};\n}' },
  { language: "javascript", label: "fetch-json", detail: "Fetch JSON with error handling", body: 'async function ${1:load}(url) {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(`Request failed: ${res.status}`);\n  return res.json();\n}' },
  { language: "javascript", label: "debounce", detail: "Debounce helper", body: 'function debounce(fn, wait = ${1:250}) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}' },
  { language: "javascript", label: "throttle", detail: "Throttle helper", body: 'function throttle(fn, wait = ${1:200}) {\n  let last = 0;\n  return (...args) => {\n    const now = Date.now();\n    if (now - last >= wait) {\n      last = now;\n      fn(...args);\n    }\n  };\n}' },
  { language: "javascript", label: "observer-reveal", detail: "IntersectionObserver reveal on scroll", body: 'const observer = new IntersectionObserver((entries) => {\n  for (const entry of entries) {\n    if (entry.isIntersecting) {\n      entry.target.classList.add("${1:visible}");\n      observer.unobserve(entry.target);\n    }\n  }\n}, { threshold: 0.15 });\ndocument.querySelectorAll("${2:.reveal}").forEach((el) => observer.observe(el));' },
  { language: "javascript", label: "event-delegation", detail: "Delegated click handler", body: 'document.addEventListener("click", (event) => {\n  const target = event.target.closest("${1:[data-action]}");\n  if (!target) return;\n  ${2}\n});' },
  { language: "javascript", label: "storage-json", detail: "localStorage JSON helpers", body: 'const store = {\n  get: (key, fallback = null) => {\n    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }\n  },\n  set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),\n};' },
  { language: "javascript", label: "try-catch", detail: "Async try/catch", body: 'try {\n  ${1}\n} catch (error) {\n  console.error(error);\n}' },
  { language: "javascript", label: "dom-ready", detail: "Run when the DOM is ready", body: 'document.addEventListener("DOMContentLoaded", () => {\n  ${1}\n});' },
  { language: "javascript", label: "class", detail: "ES class", body: 'class ${1:Thing} {\n  constructor(${2}) {\n    ${3}\n  }\n}' },
  { language: "javascript", label: "array-group-by", detail: "Group array items", body: 'const groupBy = (items, key) => items.reduce((acc, item) => {\n  (acc[item[key]] ||= []).push(item);\n  return acc;\n}, {});' },
  { language: "javascript", label: "theme-toggle", detail: "Dark mode toggle with persistence", body: 'const root = document.documentElement;\nroot.dataset.theme = localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");\ndocument.querySelector("${1:#theme-toggle}")?.addEventListener("click", () => {\n  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";\n  localStorage.setItem("theme", root.dataset.theme);\n});' },
];

/** Plain text of a snippet body: placeholders ${1:x} become x, bare ${n} disappear. */
export function snippetText(body) {
  return String(body).replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\{\d+\}/g, "");
}

/** Validates a user snippet. Returns an error message or null. */
export function snippetError(s) {
  if (!s || typeof s !== "object") return "Invalid snippet.";
  if (!["html", "css", "javascript"].includes(s.language)) return "Language must be html, css or javascript.";
  if (!/^[A-Za-z][\w-]{1,39}$/.test(s.label || "")) return "The trigger must be 2-40 characters: letters, digits, - or _, starting with a letter.";
  if (!s.body || String(s.body).length > 20000) return "The snippet body is empty or too long.";
  return null;
}

/** Custom snippets matching a language (and, for html, searching label/detail by query). */
export function filterSnippets(list, { language, query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter((s) => (!language || s.language === language) && (!q || `${s.label} ${s.detail || ""}`.toLowerCase().includes(q)));
}

// ---- API-driven operations (take the `openfini` object so tests can pass a mock) ----------------------------------

/** Text files of the open website project: [{path, lang}] for the languages the formatter understands. */
export async function projectFiles(api) {
  const res = await api.document.callTool("list_files", {});
  return res.files.map((f) => ({ path: f.path, lang: detectLanguage(f.path), bytes: f.bytes })).filter((f) => f.lang);
}

export async function readProjectFile(api, path) {
  const out = await api.document.callTool("read_file", { path });
  return String(out).split("\n").slice(1).map((l) => l.replace(/^\d+\t/, "")).join("\n");
}

/** mode: "format" | "minify" | "sort". Returns { path, before, after, changed, target }. Minify writes `name.min.ext`. */
export async function processFile(api, path, mode) {
  const lang = detectLanguage(path);
  if (!lang) throw new Error("This file type is not supported.");
  const text = await readProjectFile(api, path);
  let result;
  let target = path;
  if (mode === "format") result = formatCode(lang, text);
  else if (mode === "sort") {
    if (lang !== "css") throw new Error("Sorting works on CSS files.");
    result = sortCssProperties(text);
  } else {
    result = minifyCode(lang, text);
    target = path.replace(/(\.[^./]+)$/, ".min$1");
  }
  if (result !== text || target !== path) await api.document.callTool("write_file", { path: target, content: result });
  return { path, target, before: text.length, after: result.length, changed: result !== text };
}

/** Inserts a snippet into the page. HTML goes into the body through insert_html; CSS/JS are appended to a project file. */
export async function insertSnippet(api, snippet, { file } = {}) {
  const text = snippetText(snippet.body);
  if (snippet.language === "html" && !file) return api.document.callTool("insert_html", { html: text });
  if (!file) throw new Error("Choose a file to add this snippet to.");
  const current = await readProjectFile(api, file);
  await api.document.callTool("write_file", { path: file, content: `${current.replace(/\s+$/, "")}\n\n${text}\n` });
  return { file };
}
