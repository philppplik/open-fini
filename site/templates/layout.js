// The page shell: head, header, footer. Every page works without JavaScript; site.js only adds the theme toggle,
// the German-language hint and the download detection.
import { html, raw } from "../lib/html.js";
import { LANGS, LOCALES } from "../lib/i18n.js";

const REPO_URL = "https://github.com/philppplik/open-fini";
export const GITHUB = {
  repo: REPO_URL,
  blob: (path) => `${REPO_URL}/blob/main/${path}`,
  // the manual is read from the repository until the docs section of the site exists (website.md, task W13)
  wiki: (page = "Home") => `${REPO_URL}/blob/main/wiki/${page}.md`,
  releases: `${REPO_URL}/releases`,
};

/** The OpenFini mark (app/index.html), in currentColor. */
export const MARK_PATH =
  "M144 0C147.314 0 150 2.68629 150 6V15C150 18.3137 147.314 21 144 21H86.9999V67H110C113.314 67 116 69.6863 116 73V82C116 85.3137 113.314 88 110 88H86.9999V127.713C98.1852 125.167 108.29 119.127 115.83 110.439C123.774 101.287 128.412 89.7309 129.001 77.626C129.492 67.527 127.141 57.5343 122.272 48.7627C120.664 45.8654 121.265 42.133 123.967 40.2139L131.251 35.0391C133.952 33.1202 137.721 33.7438 139.418 36.5898C146.955 49.2307 150.63 63.8543 149.911 78.6426C149.094 95.4348 142.66 111.466 131.64 124.162C120.619 136.859 105.652 145.484 89.1415 148.654C72.6311 151.824 55.5344 149.356 40.5956 141.644C25.6566 133.931 13.7421 121.423 6.76453 106.127C-0.212936 90.8312 -1.84911 73.6349 2.11902 57.2979C6.08724 40.9607 15.4296 26.4298 28.6464 16.0391C41.732 5.75148 57.8643 0.112781 74.4999 0.00195312V0H144ZM65.9999 21.6895C57.1329 23.1865 48.7289 26.8805 41.5848 32.4971C32.0573 39.9874 25.3233 50.4623 22.4628 62.2393C19.6023 74.0161 20.7815 86.4123 25.8114 97.4385C30.8413 108.465 39.4301 117.482 50.1991 123.041C55.1968 125.621 60.5298 127.385 65.9999 128.309V21.6895Z";

export const mark = (cls = "mark") => html`<svg class="${cls}" viewBox="0 0 150 150" aria-hidden="true" focusable="false"><path fill="currentColor" d="${MARK_PATH}"/></svg>`;

/** An icon from the generated sprite (assets/icons.svg). */
export const icon = (ctx, name, cls = "i") => html`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="${ctx.u.asset("icons.svg")}#${name}"/></svg>`;

/** A small mono section label such as "STUDIO 03 / LAYOUT". */
export const label = (text, extra = "") => html`<p class="label ${extra}">${text}</p>`;

// Applied before the first paint so a chosen theme never flashes; the toggle itself lives in site.js.
const THEME_BOOT = `try{var t=localStorage.getItem("of-site-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function header(ctx, path, section, single) {
  const { t, u, lang } = ctx;
  const nav = [
    ["studios", t("nav.studios"), u.page(lang, "studios/")],
    ["features", t("nav.features"), u.page(lang, "features/")],
    ["docs", t("nav.docs"), GITHUB.wiki()],
  ];
  return html`<header class="top">
  <div class="top__in wrap">
    <a class="brand" href="${u.page(lang)}" aria-label="${t("nav.home")}">${mark()}<span class="brand__word">OpenFini</span></a>
    <nav class="nav" aria-label="${t("nav.label")}">
      <ul>${nav.map(([id, text, href]) => html`<li><a href="${href}"${raw(section === id ? ' aria-current="page"' : "")}>${text}</a></li>`)}</ul>
    </nav>
    <div class="top__tools">
      <div class="seg" role="group" aria-label="${t("lang.switch")}">
        ${LANGS.map((l) => html`<a href="${u.page(l, single && l !== lang ? "" : path)}" hreflang="${l}" lang="${l}"${raw(l === lang ? ' aria-current="true"' : "")}>${l.toUpperCase()}</a>`)}
      </div>
      <button class="icon-btn theme-toggle" type="button" hidden aria-label="${t("theme.toggle")}" title="${t("theme.toggle")}">${icon(ctx, "circle-half")}</button>
      <a class="btn btn--primary btn--sm" href="${u.page(lang, "download/")}"${raw(section === "download" ? ' aria-current="page"' : "")}>${icon(ctx, "download")}<span>${t("nav.download")}</span></a>
    </div>
  </div>
</header>`;
}

function footer(ctx) {
  const { t, u, lang, version } = ctx;
  const col = (title, links) => html`<div class="foot__col"><h2 class="foot__h">${title}</h2><ul>${links.map(([text, href]) => html`<li><a href="${href}">${text}</a></li>`)}</ul></div>`;
  return html`<footer class="foot">
  <div class="wrap foot__grid">
    <div class="foot__brand">
      <a class="brand" href="${u.page(lang)}">${mark()}<span class="brand__word">OpenFini</span></a>
      <p class="foot__ver">${t("label.version", { v: version })}</p>
    </div>
    ${col(t("footer.product"), [
      [t("nav.studios"), u.page(lang, "studios/")],
      [t("nav.features"), u.page(lang, "features/")],
      [t("nav.download"), u.page(lang, "download/")],
      [t("nav.docs"), GITHUB.wiki()],
    ])}
    ${col(t("footer.project"), [
      [t("footer.source"), GITHUB.repo],
      [t("footer.changelog"), GITHUB.blob("CHANGELOG.md")],
      [t("footer.roadmap"), GITHUB.blob("docs/roadmap.md")],
      [t("footer.contribute"), GITHUB.blob("CONTRIBUTING.md")],
    ])}
    ${col(t("footer.about"), [
      [t("footer.license"), GITHUB.blob("LICENSE")],
      [t("footer.cleanroom"), GITHUB.blob("docs/clean-room.md")],
      [t("footer.security"), GITHUB.blob("SECURITY.md")],
      [t("footer.conduct"), GITHUB.blob("CODE_OF_CONDUCT.md")],
    ])}
  </div>
  <div class="wrap foot__note">
    <p>${t("footer.note")}</p>
    <p>${t("footer.site")}</p>
  </div>
</footer>`;
}

/**
 * @param {object} ctx { t, u, lang, version }
 * @param {{ path: string, title: string, description: string, body: any, section?: string, bodyClass?: string,
 *   noindex?: boolean, fallback?: boolean, head?: any }} page
 */
export function layout(ctx, { path, title, description, body, section = "", bodyClass = "", noindex = false, fallback = false, head = "", single = false }) {
  const { t, u, lang } = ctx;
  const fullTitle = path === "" ? title : `${title} · OpenFini`;
  return `<!doctype html>\n${html`<html lang="${LOCALES[lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e9eaee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1d1e22" media="(prefers-color-scheme: dark)">
${noindex ? raw('<meta name="robots" content="noindex">') : html`<link rel="canonical" href="${u.absolute(lang, path)}">
${LANGS.map((l) => html`<link rel="alternate" hreflang="${l}" href="${u.absolute(l, path)}">\n`)}<link rel="alternate" hreflang="x-default" href="${u.absolute("en", path)}">`}
<link rel="icon" href="${u.base}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${u.base}apple-touch-icon.png">
<link rel="preload" href="${u.asset("fonts/inter-latin-wght-normal.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${u.asset(`site.css?v=${ctx.cacheKey}`)}">
<script>${raw(THEME_BOOT)}</script>
<script type="module" src="${u.asset(`js/site.js?v=${ctx.cacheKey}`)}"></script>
${head}
</head>
<body class="${bodyClass}" data-lang="${lang}">
<a class="skip" href="#main">${t("skip")}</a>
${header(ctx, path, section, single)}
<main id="main" tabindex="-1">
${fallback ? html`<p class="wrap fallback" role="note">${t("fallback.note")}</p>` : ""}
${body}
</main>
${footer(ctx)}
</body>
</html>`.value}\n`;
}
