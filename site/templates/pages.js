// Page bodies. Each function returns trusted HTML for layout(); copy comes from site/content, strings from site/i18n.
import { html, raw } from "../lib/html.js";
import { mdInline } from "../lib/content.js";
import { STUDIOS, SHIPPED } from "../lib/studios.js";
import { classifyAsset, formatSize } from "../assets/js/platforms.js";
import { GITHUB, icon, label, mark } from "./layout.js";

const two = (n) => String(n).padStart(2, "0");

/** Fills {placeholders} in rendered copy with build-time facts (installer size, start-up numbers, version). */
export const fill = (s, facts) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in facts ? facts[k] : m));

/** A screenshot in both themes; CSS shows the one that matches the page theme. */
export function shot(ctx, id, alt, { eager = false, sizes = "(min-width: 1240px) 1180px, 100vw", cls = "" } = {}) {
  const img = (theme) => html`<img class="shot__img shot__img--${theme}" src="${ctx.u.asset(`shots/${id}-${theme}.webp`)}"
    srcset="${ctx.u.asset(`shots/${id}-${theme}.webp`)} 1440w, ${ctx.u.asset(`shots/${id}-${theme}@2x.webp`)} 2880w"
    sizes="${sizes}" width="1440" height="900" alt="${alt}" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')} decoding="async">`;
  return html`<span class="shot ${cls}">${img("dark")}${img("light")}</span>`;
}

/** The launch artwork (app/assets/launch), with the launch screen's gradient as placeholder. */
export function artwork(ctx, alt = "", { eager = false, sizes = "(min-width: 1240px) 700px, 100vw" } = {}) {
  return html`<span class="art"><img src="${ctx.u.asset("img/artwork-1600.webp")}"
    srcset="${ctx.u.asset("img/artwork-800.webp")} 800w, ${ctx.u.asset("img/artwork-1600.webp")} 1600w" sizes="${sizes}"
    width="1600" height="670" alt="${alt}" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')} decoding="async"></span>`;
}

function studioCopy(ctx, id) {
  return ctx.content(`studios/${id}`);
}

// ------------------------------------------------------------------------------------------------ home

function strip(ctx) {
  const { u, lang } = ctx;
  return html`<ol class="strip" role="list">
    ${SHIPPED.map((s, i) => {
      const c = studioCopy(ctx, s.id).meta;
      return html`<li class="strip__item">
        <a class="strip__link" href="${u.page(lang, `studios/${s.id}/`)}">
          ${shot(ctx, s.id, "", { sizes: "(min-width: 760px) 70vw, 85vw" })}
          <span class="strip__v" aria-hidden="true"><span class="strip__n">${two(i + 1)}</span>${c.name}</span>
          <span class="strip__cap">
            <span class="strip__n">${two(i + 1)}</span>
            <span class="strip__name">${c.title}</span>
            <span class="strip__for">${c.for}</span>
          </span>
        </a>
      </li>`;
    })}
  </ol>`;
}

export function homePage(ctx) {
  const { t, u, lang, facts, release, changelog } = ctx;
  const c = ctx.content("home");
  const m = c.meta;
  const news = changelog;
  return html`
<section class="hero wrap">
  ${label(`${m.kicker} · MIT · ${t("label.version", { v: ctx.version })}`)}
  <h1 class="display hero__title">${raw(mdInline(m.headline))}</h1>
  <div class="hero__grid">
    <div class="hero__copy">
      <p class="lead">${m.lead}</p>
      <div class="actions">
        <a class="btn btn--primary" href="${u.page(lang, "download/")}" data-dl-cta="${t("cta.downloadFor")}">${icon(ctx, "download")}<span>${t("cta.download")}</span></a>
        <a class="btn" href="${GITHUB.repo}">${t("cta.github")}</a>
      </div>
      <ul class="hero__facts" role="list">
        <li>Windows · macOS · Linux · PWA</li>
        <li>${facts.installer ? `${facts.installer} · Windows x64` : ""}</li>
      </ul>
    </div>
    <figure class="launch" aria-hidden="true">
      ${artwork(ctx, "", { eager: true })}
      <span class="launch__bar"><span class="launch__fill"></span></span>
      <span class="launch__foot">${mark("launch__mark")}<span>OpenFini</span><span class="launch__ver">${ctx.version}</span></span>
    </figure>
  </div>
</section>

<section class="section wrap" aria-labelledby="strip-title">
  <div class="section__head">
    ${label(t("home.strip.label"))}
    <h2 class="display h2" id="strip-title">${m.strip_title}</h2>
    <p class="section__lead">${m.strip_lead}</p>
  </div>
  ${strip(ctx)}
  <p class="next-line">${icon(ctx, "bounding-box")}<span class="label label--inline">${t("home.proto.label")}</span>
    <span>${raw(mdInline(m.proto))}</span>
    <a href="${u.page(lang, "studios/proto/")}">${studioCopy(ctx, "proto").meta.title} →</a></p>
</section>

<section class="section wrap" aria-labelledby="proof-title">
  <div class="section__head">
    ${label(t("home.proof.label"))}
    <h2 class="display h2" id="proof-title">${m.proof_title}</h2>
  </div>
  <div class="proof">
    ${c.sections.map((s) => html`<div class="proof__col">
      <p class="proof__fig display">${fill(m.figures?.[s.id], facts)}</p>
      <p class="proof__cap">${m.captions?.[s.id]}</p>
      <h3 class="proof__h">${s.title}</h3>
      <div class="prose prose--sm">${raw(fill(s.html, facts))}</div>
    </div>`)}
  </div>
</section>

${news
  ? html`<section class="section wrap news" aria-labelledby="news-title">
  <div class="news__head">
    ${label(t("home.new.label"))}
    <h2 class="display h2" id="news-title">${t("home.new.title", { v: news.version })}</h2>
    <p class="section__lead">${news.title}</p>
    <a class="more" href="${u.page(lang, "changelog/")}#${news.version.replace(/[^\w]+/g, "-")}">${t("home.new.all")} →</a>
  </div>
  <ol class="news__list" role="list"${raw(lang === "en" ? "" : ' lang="en"')}>${news.items.map((it, i) => html`<li><span class="news__n">${two(i + 1)}</span>${it}</li>`)}</ol>
</section>`
  : ""}

<section class="section wrap cta" aria-labelledby="cta-title">
  <h2 class="display cta__title" id="cta-title">${m.cta_title}</h2>
  <p class="section__lead">${m.cta_lead}</p>
  <div class="actions">
    <a class="btn btn--primary btn--lg" href="${u.page(lang, "download/")}" data-dl-cta="${t("cta.downloadFor")}">${icon(ctx, "download")}<span>${t("cta.download")}</span></a>
    <a class="btn btn--lg" href="${u.page(lang, "studios/")}">${t("cta.studios")}</a>
  </div>
</section>`;
}

// ------------------------------------------------------------------------------------------------ studios

function switcher(ctx, current) {
  const { t, u, lang } = ctx;
  return html`<nav class="switcher" aria-label="${t("studio.switcher")}">
    <ol class="switcher__list wrap" role="list">
      ${STUDIOS.map((s) => {
        const c = studioCopy(ctx, s.id).meta;
        return html`<li><a href="${u.page(lang, `studios/${s.id}/`)}" title="${c.title}"${raw(s.id === current ? ' aria-current="page"' : "")}${raw(s.planned ? " data-planned" : "")}>${icon(ctx, s.icon)}<span>${c.name}</span></a></li>`;
      })}
    </ol>
  </nav>`;
}

export function studiosIndexPage(ctx) {
  const { t, u, lang } = ctx;
  const intro = ctx.content("home").meta;
  return html`
${switcher(ctx, null)}
<section class="page-head wrap">
  ${label(t("studios.label"))}
  <h1 class="display h1">${t("studios.title")}</h1>
  <p class="lead">${intro.strip_lead}</p>
</section>
<ol class="rows wrap" role="list">
  ${STUDIOS.map((s, i) => {
    const c = studioCopy(ctx, s.id).meta;
    return html`<li class="row${s.planned ? " row--planned" : ""}">
      <a class="row__link" href="${u.page(lang, `studios/${s.id}/`)}">
        <span class="row__n">${two(i + 1)}</span>
        <span class="row__body">
          <span class="row__name display">${c.title}${s.planned ? html` <span class="badge">${t("label.comingIn", { v: s.planned })}</span>` : ""}</span>
          <span class="row__for">${c.for}</span>
          <span class="row__out">${c.output}</span>
        </span>
        <span class="row__thumb" aria-hidden="true">${s.planned ? artwork(ctx, "", { sizes: "320px" }) : shot(ctx, s.id, "", { sizes: "320px" })}</span>
      </a>
    </li>`;
  })}
</ol>`;
}

export function studioPage(ctx, id) {
  const { t, u, lang } = ctx;
  const i = STUDIOS.findIndex((s) => s.id === id);
  const s = STUDIOS[i];
  const c = studioCopy(ctx, id);
  const m = c.meta;
  const prev = STUDIOS[(i + STUDIOS.length - 1) % STUDIOS.length];
  const next = STUDIOS[(i + 1) % STUDIOS.length];
  const nameOf = (x) => studioCopy(ctx, x.id).meta.title;
  return html`
${switcher(ctx, id)}
<article>
  <header class="page-head wrap">
    ${label(`${t("label.studio")} ${two(i + 1)} / ${m.name}${s.planned ? ` · ${t("label.comingIn", { v: s.planned })}` : ""}`, s.planned ? "label--accent" : "")}
    <h1 class="display h1">${m.title}</h1>
    <p class="lead">${m.lead}</p>
    <dl class="meta">
      <div><dt>${t("studio.for")}</dt><dd>${m.for}</dd></div>
      <div><dt>${t("studio.output")}</dt><dd>${m.output}</dd></div>
    </dl>
  </header>
  <figure class="figure wrap">
    ${s.planned ? artwork(ctx, m.alt, { eager: true, sizes: "(min-width: 1240px) 1180px, 100vw" }) : shot(ctx, id, m.alt, { eager: true })}
    <figcaption>${s.planned ? m.alt : t("studio.shotNote")}</figcaption>
  </figure>
  <section class="section wrap" aria-labelledby="what">
    ${label(s.planned ? t("studio.planned") : t("studio.features"))}
    <h2 class="sr-only" id="what">${s.planned ? t("studio.planned") : t("studio.features")}</h2>
    <div class="blocks">
      ${c.sections.map((sec, k) => html`<section class="block" id="${sec.id}">
        <span class="block__n">${two(k + 1)}</span>
        <h3 class="block__h">${sec.title}</h3>
        <div class="prose prose--sm">${raw(sec.html)}</div>
      </section>`)}
    </div>
  </section>
  <section class="section wrap aside-pair">
    <aside class="note" aria-labelledby="from">
      <h2 class="note__h" id="from">${t("studio.comingFrom")}</h2>
      <div class="prose prose--sm">${raw(ctx.md(m.coming_from))}</div>
    </aside>
    <aside class="note note--limits" aria-labelledby="limits">
      <h2 class="note__h" id="limits">${t("studio.limits")}</h2>
      <div class="prose prose--sm">${raw(ctx.md(m.limits))}</div>
      <p><a class="more" href="${s.planned ? u.page("en", "docs/dev/concepts/proto-studio/") : u.page("en", "docs/dev/known-limits/")}">${s.planned ? "docs/concepts/proto-studio.md" : t("studio.limitsMore")} →</a></p>
    </aside>
  </section>
  ${s.docs ? html`<p class="wrap docs-link"><a class="btn" href="${u.page("en", `docs/${s.docs.toLowerCase()}/`)}">${t("studio.docs")}: ${m.title} →</a></p>` : ""}
  <nav class="pager wrap" aria-label="${t("studio.more")}">
    <a class="pager__prev" href="${u.page(lang, `studios/${prev.id}/`)}" rel="prev"><span class="label">${t("studio.prev")}</span><span class="display">← ${nameOf(prev)}</span></a>
    <a class="pager__next" href="${u.page(lang, `studios/${next.id}/`)}" rel="next"><span class="label">${t("studio.next")}</span><span class="display">${nameOf(next)} →</span></a>
  </nav>
</article>`;
}

// ------------------------------------------------------------------------------------------------ features

export function featuresPage(ctx) {
  const { t } = ctx;
  const c = ctx.content("features");
  const m = c.meta;
  return html`
<section class="page-head wrap">
  ${label(t("features.label"))}
  <h1 class="display h1">${m.headline}</h1>
  <p class="lead">${m.lead}</p>
</section>
<div class="wrap with-index">
  <nav class="index" aria-labelledby="index-title">
    <h2 class="label" id="index-title">${t("features.index")}</h2>
    <ol role="list">${c.sections.map((s) => html`<li><a href="#${s.id}">${s.title}</a></li>`)}</ol>
  </nav>
  <div class="feature-list">
    ${c.sections.map((s, i) => html`<section class="feature" id="${s.id}" aria-labelledby="${s.id}-h">
      <div class="feature__icon">${s.icon ? icon(ctx, s.icon) : ""}<span class="feature__n">${two(i + 1)}</span></div>
      <div>
        <h2 class="feature__h display" id="${s.id}-h">${s.title}</h2>
        <div class="prose">${raw(s.html)}</div>
      </div>
    </section>`)}
  </div>
</div>`;
}

// ------------------------------------------------------------------------------------------------ download

function osLabel(t, info) {
  if (info.os === "web" || info.os === "any") return t(`os.${info.os}`);
  const arch = info.os === "macos" ? t(`arch.mac.${info.arch}`) : t(`arch.${info.arch}`);
  return `${t(`os.${info.os}`)} ${arch}`;
}

export function downloadPage(ctx) {
  const { t, lang, release } = ctx;
  const c = ctx.content("download");
  const m = c.meta;
  const groups = ["windows", "macos", "linux", "web", "any"];
  const rows = (release?.assets ?? [])
    .map((a) => ({ ...a, info: classifyAsset(a.name) }))
    .filter((a) => a.info)
    .sort((a, b) => a.info.order - b.info.order);
  const date = release ? new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long" }).format(new Date(release.publishedAt)) : "";
  // what site.js needs to pick and re-render; strings travel with it so the script needs no dictionary of its own
  const data = {
    repo: "philppplik/open-fini",
    tag: release?.tag ?? null,
    assets: release?.assets ?? [],
    locale: ctx.locale,
    strings: Object.fromEntries(
      ["dl.detected", "dl.otherFiles", "dl.archUnknown", "dl.mobile", "dl.newer", "dl.copy", "dl.copied", "cta.downloadFor", "dl.release",
        "os.windows", "os.macos", "os.linux", "os.web", "os.any", "os.android", "os.ios", "os.chromeos",
        "arch.x64", "arch.arm64", "arch.mac.arm64", "arch.mac.x64",
        "kind.exe", "kind.msi", "kind.dmg", "kind.appimage", "kind.deb", "kind.rpm", "kind.pwa", "kind.relay"].map((k) => [k, t(k)]),
    ),
  };
  const table = html`<table class="files">
    <caption class="sr-only">${t("dl.all")}</caption>
    <thead><tr><th scope="col">${t("dl.col.file")}</th><th scope="col">${t("dl.col.system")}</th><th scope="col" class="num">${t("dl.col.size")}</th><th scope="col">${t("dl.col.sha")}</th></tr></thead>
    ${groups.map((g) => {
      const list = rows.filter((r) => r.info.os === g);
      if (!list.length) return "";
      return html`<tbody data-os="${g}">
        <tr class="files__group"><th scope="rowgroup" colspan="4">${t(`os.${g}`)}</th></tr>
        ${list.map((r) => html`<tr>
          <td><a class="files__name" href="${r.url}">${r.name}</a></td>
          <td>${osLabel(t, r.info)} <span class="dim">· ${t(`kind.${r.info.kind}`)}</span></td>
          <td class="num">${formatSize(r.size, lang)}</td>
          <td>${r.sha256 ? html`<code class="sha" title="${r.sha256}">${r.sha256}</code>` : html`<span class="dim">–</span>`}</td>
        </tr>`)}
      </tbody>`;
    })}
  </table>`;
  return html`
<section class="page-head wrap">
  ${label(release ? `${t("dl.release", { v: release.version })} · ${t("dl.published", { date })}` : t("dl.label"))}
  <h1 class="display h1">${m.headline}</h1>
  <p class="lead">${m.lead}</p>
</section>
<section class="wrap dl" aria-label="${t("dl.label")}">
  <div class="dl__primary" data-dl aria-live="polite">
    <p class="dl__hint">${t("dl.detecting")}</p>
  </div>
  <p class="dl__notice" data-dl-notice hidden></p>
  ${release
    ? html`<div class="table-wrap">${table}</div>
      <p class="dim small">${t("dl.sumsNote")} <a href="${release.url}">${t("dl.notes")} →</a></p>`
    : html`<p>${t("dl.none")} <a href="${GITHUB.releases}">GitHub →</a></p>`}
  <script type="application/json" id="release-data">${raw(JSON.stringify(data).replace(/</g, "\\u003c"))}</script>
</section>
<div class="wrap dl-info">
  ${c.sections.map((s) => html`<section class="dl-info__sec" id="${s.id}" aria-labelledby="${s.id}-h">
    <h2 class="display h3" id="${s.id}-h">${s.title}</h2>
    <div class="prose">${raw(s.html)}</div>
  </section>`)}
</div>`;
}

// ------------------------------------------------------------------------------------------------ 404 and style guide

export function notFoundPage(ctx) {
  const { t, u, lang } = ctx;
  const other = lang === "en" ? "de" : "en";
  const links = (l, tt) => [
    [tt("nav.home"), u.page(l)],
    [tt("nav.studios"), u.page(l, "studios/")],
    [tt("nav.features"), u.page(l, "features/")],
    [tt("nav.download"), u.page(l, "download/")],
  ];
  return html`<section class="page-head wrap notfound">
  ${label("404")}
  <h1 class="display h1">${t("notfound.title")}</h1>
  <p class="lead">${t("notfound.lead")}</p>
  <ul class="link-list" role="list">${links(lang, t).map(([text, href]) => html`<li><a href="${href}">${text} →</a></li>`)}</ul>
  <p class="dim" lang="${other}">${ctx.tOther("notfound.title")}: ${links(other, ctx.tOther).map(([text, href], i) => html`${i ? " · " : ""}<a href="${href}">${text}</a>`)}</p>
</section>`;
}

export function styleguidePage(ctx) {
  const tokens = ["bg", "bar", "panel", "raised", "canvas", "border", "border-soft", "text", "dim", "faint", "accent", "link", "on-accent"];
  return html`<section class="page-head wrap">
  ${label("Style guide · not linked")}
  <h1 class="display h1">Tokens and components</h1>
  <p class="lead">Every token and component of the site in the current theme. Switch the theme with the button in the header to check both.</p>
</section>
<section class="section wrap">
  <h2 class="display h2">Colors</h2>
  <ul class="swatches" role="list">${tokens.map((k) => html`<li><span class="swatch" style="background:var(--${k})"></span><code>--${k}</code></li>`)}</ul>
</section>
<section class="section wrap">
  <h2 class="display h2">Type</h2>
  <p class="display h1">Display, heading 1</p>
  <p class="display h2">Display, heading 2</p>
  <p class="display h3">Display, heading 3</p>
  <p class="lead">Lead paragraph in the text face, used under page titles.</p>
  <div class="prose"><p>Body text with a <a href="#">link</a>, <code>inline code</code> and a shortcut chip <kbd>Ctrl+K</kbd>.</p></div>
  ${label("Studio 03 / Layout")}
</section>
<section class="section wrap">
  <h2 class="display h2">Controls</h2>
  <div class="actions"><a class="btn btn--primary" href="#">Primary</a><a class="btn" href="#">Secondary</a><a class="btn btn--sm" href="#">Small</a><span class="badge">Badge</span></div>
  <div class="seg" role="group" aria-label="Example"><a href="#" aria-current="true">One</a><a href="#">Two</a></div>
  <aside class="note"><h3 class="note__h">Note</h3><div class="prose prose--sm"><p>Notes have a hairline border, like the app's panels.</p></div></aside>
</section>`;
}
