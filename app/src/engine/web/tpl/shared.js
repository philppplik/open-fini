// Shared building blocks of the starter templates: the site script and the CSS foundation.
// Every template composes its own style.css as: foundation + template rules, with exactly one media block
// per breakpoint (desktop-first cascade: 991px, 767px, 478px).
import { formatCss } from "../css.js";

export const MAIN_JS = `// Site script: mobile navigation, smooth anchors and the current year.
(function () {
  "use strict";

  // Mobile navigation
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  function closeNav() {
    if (!toggle || !nav) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav();
        toggle.focus();
      }
    });
  }

  // Smooth scrolling for in-page links
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.addEventListener("click", function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (!link) return;
    var id = decodeURIComponent(link.getAttribute("href").slice(1));
    var target = id ? document.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    try {
      history.pushState(null, "", "#" + id);
    } catch (error) {
      // Some embedded previews do not allow changing the address.
    }
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });

  // Current year
  var years = document.querySelectorAll("[data-year]");
  for (var i = 0; i < years.length; i++) years[i].textContent = String(new Date().getFullYear());
})();
`;

/** Inline SVG used for the mobile menu button. */
export const MENU_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

/**
 * Shared CSS. Templates define the custom properties used here in :root:
 * --bg --surface --text --muted --border --accent --accent-ink --radius --shadow --font-body --font-heading --container --header-bg
 */
export const CORE = {
  base: `*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  scroll-padding-top: 88px;
}

body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.65;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

img,
svg,
video {
  display: block;
  max-width: 100%;
  height: auto;
}

h1,
h2,
h3,
h4 {
  margin: 0 0 0.5em;
  font-family: var(--font-heading);
  line-height: 1.15;
  letter-spacing: -0.02em;
}

h1 { font-size: 3.5rem; }
h2 { font-size: 2.375rem; }
h3 { font-size: 1.375rem; }

p {
  margin: 0 0 1em;
}

a {
  color: var(--accent);
  text-underline-offset: 3px;
}

a:hover {
  text-decoration-thickness: 2px;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.skip-link {
  position: absolute;
  top: -100px;
  left: 16px;
  z-index: 100;
  padding: 0.6rem 1rem;
  border-radius: var(--radius);
  background: var(--text);
  color: var(--bg);
  font-weight: 600;
  text-decoration: none;
}

.skip-link:focus {
  top: 16px;
}

.container {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 24px;
}

.section {
  padding: 96px 0;
}

.eyebrow {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

.lead {
  font-size: 1.25rem;
  color: var(--muted);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.4rem;
  border: 2px solid transparent;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow);
  text-decoration: none;
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.btn-secondary {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}`,
  m991: `h1 { font-size: 2.875rem; }
  h2 { font-size: 2rem; }

  .section {
    padding: 72px 0;
  }`,
  m767: `h1 { font-size: 2.375rem; }
  h2 { font-size: 1.75rem; }

  .section {
    padding: 56px 0;
  }

  .lead {
    font-size: 1.125rem;
  }`,
  m478: `h1 { font-size: 2rem; }

  .container {
    padding: 0 16px;
  }`,
};

/** Site header, navigation and footer. */
export const CHROME = {
  base: `.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--border);
  background: var(--header-bg);
  backdrop-filter: saturate(160%) blur(10px);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 72px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--font-heading);
  font-size: 1.1875rem;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}

.nav-list {
  display: flex;
  align-items: center;
  gap: 28px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-list a:not(.btn) {
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
}

.nav-list a:not(.btn):hover,
.nav-list a[aria-current="page"] {
  color: var(--text);
}

.nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.site-footer {
  padding: 40px 0;
  border-top: 1px solid var(--border);
  font-size: 0.9375rem;
  color: var(--muted);
}`,
  m991: `.nav-toggle {
    display: inline-flex;
  }

  .nav {
    position: absolute;
    top: 100%;
    right: 0;
    left: 0;
    display: none;
    padding: 8px 24px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    box-shadow: var(--shadow);
  }

  .nav.is-open {
    display: block;
  }

  .nav-list {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .nav-list a:not(.btn) {
    display: block;
    padding: 12px 0;
  }

  .nav-list .btn {
    width: 100%;
  }`,
  m478: `.nav {
    padding: 8px 16px 20px;
  }`,
};

/** Core and chrome in one part (what most templates use). */
export const FOUNDATION = {
  base: `${CORE.base}

${CHROME.base}`,
  m991: `${CORE.m991}

  ${CHROME.m991}`,
  m767: CORE.m767,
  m478: `${CORE.m478}

  ${CHROME.m478}`,
};

export const REDUCED_MOTION = `@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;

/**
 * Composes a stylesheet from parts. Each part is { base, m991, m767, m478 } (any may be missing) and the result has
 * one block per breakpoint, ordered like a desktop-first cascade, followed by the reduced-motion block.
 * @param {...{ root?: string, base?: string, m991?: string, m767?: string, m478?: string }} parts
 * @returns {string}
 */
export function compose(...parts) {
  const out = [];
  for (const p of parts) if (p.root) out.push(p.root.trim());
  for (const p of parts) if (p.base) out.push(p.base.trim());
  for (const [key, query] of [["m991", "(max-width: 991px)"], ["m767", "(max-width: 767px)"], ["m478", "(max-width: 478px)"]]) {
    const body = parts.map((p) => p[key]).filter(Boolean).map((s) => s.trim()).join("\n\n  ");
    if (body) out.push(`@media ${query} {\n  ${body}\n}`);
  }
  out.push(REDUCED_MOTION);
  return compactCss(formatCss(out.join("\n\n")));
}

/**
 * Puts short rules on one line ("selector { a: b; c: d; }") and keeps runs of short rules together, so the shipped
 * stylesheets stay compact. Input must be the output of formatCss.
 * @param {string} css
 * @returns {string}
 */
export function compactCss(css) {
  const short = (m, indent, selector, body, whole = m) => {
    const decls = body.trim().split("\n").map((l) => l.trim());
    const line = `${indent}${selector} { ${decls.join(" ")} }`;
    return decls.length <= 5 && line.length <= 112 ? line : whole;
  };
  let out = css.replace(/^([ \t]*)((?:[^{}\s;][^{}\n;]*,\n[ \t]*)*[^{}\s;][^{}\n;]*) \{\n((?:[ \t]+[^{}\s][^{}\n]*;\n)+)[ \t]*\}$/gm, (m, indent, selector, body) =>
    short(m, indent, selector.replace(/,\n[ \t]*/g, ", "), body),
  );
  out = out.replace(/(^[ \t]*[^{}\s][^{}\n]* \{ [^{}\n]+ \}\n)\n(?=[ \t]*[^{}\s][^{}\n]* \{ [^{}\n]+ \}\n)/gm, "$1");
  return out;
}

/** Percent-encodes an SVG so it can be used inside a data: URI. */
export function svgUri(svg) {
  return "data:image/svg+xml," + svg.replace(/"/g, "'").replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\s+/g, " ");
}

/** Inline icon (24x24 stroke icon) from path markup. */
export const icon = (paths, cls = "icon") =>
  `<svg class="${cls}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** The standard document head for a template page. */
export const head = ({ title, description, css = "css/style.css" }) => `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="stylesheet" href="${css}">`;
