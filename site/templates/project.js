// Project pages (docs/concepts/website.md, task W14): changelog, roadmap, community, press kit, privacy.
import { html, raw } from "../lib/html.js";
import { mdInline } from "../lib/content.js";
import { GITHUB, label } from "./layout.js";
import { artwork } from "./pages.js";

/** "1.2.0" -> "1-2-0", the stable anchor of a version on /changelog/. */
export const versionAnchor = (v) => v.replace(/[^\w]+/g, "-");

function proseSections(sections, cls = "") {
  return sections.map((s) => html`<section class="dl-info__sec ${cls}" id="${s.id}" aria-labelledby="${s.id}-h">
    <h2 class="display h3" id="${s.id}-h">${s.title}</h2>
    <div class="prose">${raw(s.html)}</div>
  </section>`);
}

export function changelogPage(ctx, versions) {
  const { t, release } = ctx;
  const dates = new Map((release?.history ?? []).map((h) => [h.tag.replace(/^v/, ""), h.publishedAt]));
  const fmt = new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long" });
  return html`<section class="page-head wrap">
  ${label(t("changelog.label"))}
  <h1 class="display h1">${t("changelog.title")}</h1>
  <p class="lead">${t("changelog.lead")}</p>
</section>
<div class="wrap with-index">
  <nav class="index" aria-labelledby="versions-title">
    <h2 class="label" id="versions-title">${t("changelog.versions")}</h2>
    <ol role="list">${versions.map((v) => html`<li><a href="#${versionAnchor(v.version)}">${v.version}</a></li>`)}</ol>
  </nav>
  <div class="feature-list" lang="en">
    ${versions.map((v) => {
      const date = dates.get(v.version);
      const latest = release && v.version === release.version;
      return html`<section class="release" id="${versionAnchor(v.version)}" aria-labelledby="${versionAnchor(v.version)}-h">
        <header class="release__head">
          <h2 class="display h2" id="${versionAnchor(v.version)}-h">${v.version}</h2>
          ${latest ? html`<span class="badge">${t("changelog.latest")}</span>` : ""}
          ${date ? html`<time class="release__date" datetime="${date}" lang="${ctx.lang}">${fmt.format(new Date(date))}</time>` : html`<span class="release__date" lang="${ctx.lang}">${t("changelog.unpublished")}</span>`}
        </header>
        ${v.title ? html`<p class="release__title">${v.title}</p>` : ""}
        <div class="prose release__body">${raw(v.html)}</div>
      </section>`;
    })}
  </div>
</div>`;
}

/**
 * The roadmap: the prioritized list of docs/concepts/roadmap-next-major.md as waves (columns) of items (cards).
 * @param {{ items: { id: string, title: string, theme: string, impact: number, effort: number, score: number, wave: string, href: string }[],
 *   notPlanned: string, limits: { text: string, href: string }[], sourceHref: string, intro: string }} road
 */
export function roadmapPage(ctx, road) {
  const { t } = ctx;
  const waves = [...new Set(road.items.map((i) => i.wave))].sort();
  const meter = (n) => html`<span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => html`<i class="${k <= n ? "on" : ""}"></i>`)}</span>`;
  return html`<section class="page-head wrap">
  ${label(t("roadmap.label"))}
  <h1 class="display h1">${t("roadmap.title")}</h1>
  <p class="lead">${t("roadmap.lead")}</p>
  <p class="dim small" lang="en">${road.intro}</p>
</section>
<div class="wrap waves" lang="en">
  ${waves.map((w) => html`<section class="wave" aria-labelledby="wave-${w}">
    <h2 class="wave__h" id="wave-${w}"><span class="label label--inline" lang="${ctx.lang}">${t("roadmap.wave", { n: w })}</span></h2>
    <ol class="wave__list" role="list">
      ${road.items.filter((i) => i.wave === w).map((i) => html`<li class="item">
        <a class="item__link" href="${i.href}">
          <span class="item__id">${i.id}</span>
          <span class="item__title">${i.title}</span>
          <span class="item__theme">${i.theme}</span>
          <span class="item__scores" lang="${ctx.lang}">
            <span>${t("roadmap.impact")} ${meter(i.impact)}<span class="sr-only"> ${i.impact}/5</span></span>
            <span>${t("roadmap.effort")} ${meter(i.effort)}<span class="sr-only"> ${i.effort}/5</span></span>
          </span>
        </a>
      </li>`)}
    </ol>
  </section>`)}
</div>
<div class="wrap dl-info">
  <section class="dl-info__sec" aria-labelledby="later-h">
    <h2 class="display h3" id="later-h">${t("roadmap.later")}</h2>
    <div class="prose" lang="en"><p>${raw(road.notPlanned)}</p></div>
  </section>
  <section class="dl-info__sec" aria-labelledby="limits-h">
    <h2 class="display h3" id="limits-h">${t("roadmap.limits")}</h2>
    <div class="prose">
      <p>${t("roadmap.limitsLead")}</p>
      <ul lang="en">${road.limits.map((l) => html`<li><a href="${l.href}">${l.text}</a></li>`)}</ul>
      <p><a class="more" href="${road.sourceHref}">${t("roadmap.source")} →</a></p>
    </div>
  </section>
</div>`;
}

export function communityPage(ctx, issues) {
  const { t } = ctx;
  const c = ctx.content("community");
  const m = c.meta;
  return html`<section class="page-head wrap">
  ${label(t("footer.contribute"))}
  <h1 class="display h1">${m.headline}</h1>
  <p class="lead">${m.lead}</p>
  <div class="actions"><a class="btn btn--primary" href="${GITHUB.repo}">${t("cta.github")}</a><a class="btn" href="${GITHUB.blob("CONTRIBUTING.md")}">CONTRIBUTING.md</a></div>
</section>
<div class="wrap dl-info">
  <section class="dl-info__sec" id="good-first" aria-labelledby="good-first-h">
    <h2 class="display h3" id="good-first-h">${m.issues_title}</h2>
    <div class="prose">
      ${issues.length
        ? html`<ul lang="en">${issues.map((i) => html`<li><a href="${i.url}">#${i.number} ${i.title}</a></li>`)}</ul>`
        : html`<p>${raw(mdInline(m.issues_empty, ctx.resolve))}</p>`}
    </div>
  </section>
  ${proseSections(c.sections)}
</div>`;
}

export function pressPage(ctx, kit) {
  const { t, u } = ctx;
  const c = ctx.content("press");
  const m = c.meta;
  const facts = [
    [t("press.fact.name"), "OpenFini"],
    [t("press.fact.what"), t("press.fact.whatValue")],
    [t("press.fact.license"), "MIT"],
    [t("press.fact.platforms"), "Windows x64 / ARM64 · macOS Apple Silicon / Intel · Linux x64 / ARM64 · PWA"],
    [t("press.fact.version"), ctx.version],
    ...(kit.firstRelease ? [[t("press.fact.first"), new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long" }).format(new Date(kit.firstRelease))]] : []),
    [t("press.fact.source"), GITHUB.repo],
  ];
  return html`<section class="page-head wrap">
  ${label(t("footer.press"))}
  <h1 class="display h1">${m.headline}</h1>
  <p class="lead">${m.lead}</p>
  <div class="actions"><a class="btn btn--primary" href="${u.base}${kit.zip}" download>${m.download}</a><span class="dim small">${kit.size}</span></div>
</section>
<div class="wrap">
  <figure class="figure press-art">${artwork(ctx, t("press.artworkAlt"))}<figcaption>${t("press.artworkCaption")}</figcaption></figure>
  <ul class="press-logos" role="list">
    ${kit.logos.map((l) => html`<li><a href="${u.base}${l.path}" download><span class="press-logos__img press-logos__img--${l.bg}"><img src="${u.base}${l.path}" alt="" width="96" height="96" loading="lazy"></span><span>${l.name}</span></a></li>`)}
  </ul>
</div>
<div class="wrap dl-info">
  <section class="dl-info__sec" aria-labelledby="facts-h">
    <h2 class="display h3" id="facts-h">${t("press.facts")}</h2>
    <div class="prose"><table><tbody>${facts.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table></div>
  </section>
  <section class="dl-info__sec" aria-labelledby="text-h">
    <h2 class="display h3" id="text-h">${t("press.text")}</h2>
    <div class="prose">
      <p class="label">${t("press.short")}</p><blockquote><p>${m.boilerplate_short}</p></blockquote>
      <p class="label">${t("press.long")}</p><blockquote><p>${m.boilerplate_long}</p></blockquote>
    </div>
  </section>
  ${proseSections(c.sections)}
</div>`;
}

export function privacyPage(ctx) {
  const { t } = ctx;
  const c = ctx.content("privacy");
  const m = c.meta;
  return html`<section class="page-head wrap">
  ${label(t("footer.privacy"))}
  <h1 class="display h1">${m.headline}</h1>
  <p class="lead">${m.lead}</p>
</section>
<div class="wrap dl-info">${proseSections(c.sections)}</div>`;
}
