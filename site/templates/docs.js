// Docs section templates: sidebar, article, search box. The documentation is English; the German site links to it.
import { html, raw } from "../lib/html.js";
import { REPO_BLOB } from "../lib/docs.js";
import { label } from "./layout.js";

function searchBox(ctx) {
  const { t } = ctx;
  // the form searches GitHub when JavaScript is off; site.js turns it into an instant search over assets/search.json
  return html`<form class="docsearch" role="search" action="https://github.com/philppplik/open-fini/search" method="get" data-search="${ctx.u.asset("search.json")}" data-none="${t("docs.noResults")}">
    <label class="sr-only" for="docsearch-q">${t("docs.search")}</label>
    <input id="docsearch-q" name="q" type="search" placeholder="${t("docs.search")}" autocomplete="off" spellcheck="false">
    <input type="hidden" name="type" value="code">
    <button class="sr-only" type="submit">${t("docs.search")}</button>
    <ol class="docsearch__results" role="list" hidden></ol>
  </form>`;
}

export function sidebar(ctx, docs, current) {
  const { t, u } = ctx;
  const link = (p, text) => html`<li><a href="${u.page("en", p.path)}"${raw(current === p ? ' aria-current="page"' : "")}>${text}</a></li>`;
  const home = docs.pages.find((p) => p.path === "docs/");
  return html`<nav class="docnav" aria-label="${t("docs.nav")}">
    <details class="docnav__details">
      <summary>${t("docs.nav")}</summary>
      <ul class="docnav__top" role="list">${link(home, t("docs.manual"))}<li><a href="${u.page("en", "docs/dev/")}"${raw(current?.path === "docs/dev/" ? ' aria-current="page"' : "")}>${t("docs.dev")}</a></li></ul>
      ${docs.sidebar.map((g) => html`<p class="docnav__h">${g.title}</p>
        <ul role="list">${g.items.map((p) => link(p, ctx.titles.get(p.source)))}</ul>`)}
    </details>
  </nav>`;
}

/** One docs page: sidebar, article, and an "On this page" list for long pages. */
export function docPage(ctx, docs, page, doc) {
  const { t } = ctx;
  const toc = doc.headings.filter((h) => h.level === 2);
  const section = page.kind === "wiki" ? page.group || t("docs.manual") : t(`docs.group.${page.group}`);
  return html`<div class="wrap docs">
  ${sidebar(ctx, docs, page)}
  <article class="doc" lang="en">
    ${label(`${t("nav.docs")} / ${section}`)}
    ${searchBox(ctx)}
    ${doc.status ? html`<p class="badge doc__status">${doc.status}</p>` : ""}
    <div class="prose doc__body">${raw(doc.html)}</div>
    <p class="doc__edit"><a href="${REPO_BLOB}${page.source}">${t("docs.edit")} →</a> <span class="dim">${page.source}</span></p>
  </article>
  ${toc.length > 2
    ? html`<nav class="doctoc" aria-label="${t("features.index")}"><p class="label">${t("features.index")}</p><ol role="list">${toc.map((h) => html`<li><a href="#${h.id}">${h.text}</a></li>`)}</ol></nav>`
    : ""}
</div>`;
}

/** The developer docs index: guides, concepts and decision records with their status. */
export function devIndex(ctx, docs, rendered) {
  const { t, u } = ctx;
  const groups = ["guides", "concepts", "adr"];
  return html`<div class="wrap docs">
  ${sidebar(ctx, docs, { path: "docs/dev/" })}
  <article class="doc">
    ${label(`${t("nav.docs")} / ${t("docs.dev")}`)}
    ${searchBox(ctx)}
    <h1 class="display h1">${t("docs.dev")}</h1>
    <p class="lead">${t("docs.devLead")}</p>
    ${groups.map((g) => {
      const list = docs.pages.filter((p) => p.kind === "dev" && p.group === g).sort((a, b) => (g === "adr" ? a.slug.localeCompare(b.slug) : rendered.get(a.source).title.localeCompare(rendered.get(b.source).title)));
      return html`<section class="devgroup" aria-labelledby="g-${g}">
        <h2 class="display h3" id="g-${g}">${t(`docs.group.${g}`)}</h2>
        <ul class="devlist" role="list" lang="en">${list.map((p) => {
          const d = rendered.get(p.source);
          return html`<li><a href="${u.page("en", p.path)}">${d.title}</a>${d.status ? html` <span class="badge">${d.status}</span>` : ""}</li>`;
        })}</ul>
      </section>`;
    })}
  </article>
</div>`;
}

/** /de/docs/: the German entry to the English documentation. */
export function docsLanding(ctx, docs) {
  const { t, u } = ctx;
  return html`<section class="page-head wrap">
  ${label(t("nav.docs"))}
  <h1 class="display h1">${t("docs.title")}</h1>
  <p class="lead">${t("docs.englishOnly")}</p>
  <div class="actions"><a class="btn btn--primary" href="${u.page("en", "docs/")}">${t("docs.manual")} →</a><a class="btn" href="${u.page("en", "docs/dev/")}">${t("docs.dev")} →</a></div>
</section>
<div class="wrap landing-groups">
  ${docs.sidebar.map((g) => html`<section><h2 class="label">${g.title}</h2><ul role="list" lang="en">${g.items.map((p) => html`<li><a href="${u.page("en", p.path)}">${ctx.titles.get(p.source)}</a></li>`)}</ul></section>`)}
</div>`;
}
