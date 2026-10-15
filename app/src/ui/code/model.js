// Parse cache and project-wide lookups for the Code studio. Parsing is memoized by file text, so panels,
// the outline, the linter and the style panel can all ask for "the parsed index.html" without re-parsing.
import { parseHtml, parseCss, flattenRules, classesInSelector, elementPath } from "../../engine/web/index.js";

export function createModel(web) {
  const cache = new Map(); // path → { text, kind, parsed }
  let classCache = { rev: -1, list: [] };
  let varCache = { rev: -1, list: [] };

  function parsed(path, kind) {
    const text = web.text(path);
    if (text == null) return null;
    const hit = cache.get(path);
    if (hit && hit.text === text && hit.kind === kind) return hit.parsed;
    const p = kind === "html" ? parseHtml(text) : parseCss(text);
    cache.set(path, { text, kind, parsed: p });
    return p;
  }

  const model = {
    web,
    html: (path) => parsed(path, "html"),
    css: (path) => parsed(path, "css"),
    isHtml: (path) => /\.html?$/i.test(path),
    isCss: (path) => /\.css$/i.test(path),
    cssFiles: () => web.paths.filter((p) => /\.css$/i.test(p)),

    /** Every class name used in any stylesheet of the project (sorted). */
    classNames() {
      if (classCache.rev === web.rev) return classCache.list;
      const set = new Set();
      for (const p of model.cssFiles()) for (const r of flattenRules(model.css(p))) for (const c of classesInSelector(r.selector)) set.add(c);
      classCache = { rev: web.rev, list: [...set].sort((a, b) => a.localeCompare(b, "en-US")) };
      return classCache.list;
    },

    /** Custom properties (--x) declared anywhere in the project's stylesheets. */
    customProperties() {
      if (varCache.rev === web.rev) return varCache.list;
      const map = new Map();
      for (const p of model.cssFiles()) {
        for (const r of flattenRules(model.css(p))) for (const d of r.decls) if (d.prop.startsWith("--") && !map.has(d.prop)) map.set(d.prop, d.value);
      }
      varCache = { rev: web.rev, list: [...map].map(([name, value]) => ({ name, value })) };
      return varCache.list;
    },

    /** The stylesheet that styles the page: the first local <link rel=stylesheet> of `page`, else the first CSS file. */
    primaryStylesheet(page) {
      const p = model.html(page);
      if (p) {
        for (const el of p.elements) {
          if (el.tag !== "link") continue;
          const rel = (el.attrs.find((a) => a.name === "rel")?.value || "").toLowerCase();
          const href = el.attrs.find((a) => a.name === "href")?.value;
          if (rel.includes("stylesheet") && href && !/^([a-z]+:)?\/\//i.test(href)) {
            const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
            const guess = normalize(dir + href.split(/[?#]/)[0]);
            if (web.has(guess)) return guess;
          }
        }
      }
      return model.cssFiles()[0] || null;
    },

    /** Path of an element within its page (stable across edits that do not change the structure). */
    pathOf: (el) => elementPath(el),
  };
  web.on("tree", () => {
    for (const p of cache.keys()) if (!web.has(p)) cache.delete(p);
  });
  return model;
}

function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}
