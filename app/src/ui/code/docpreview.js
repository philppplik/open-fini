// Live preview of Markdown, LaTeX and BibTeX files in the Code studio. The right half of the split view shows this
// instead of the website canvas while such a file is open. Markdown is rendered by engine/web/markdown.js, LaTeX by the
// subset converter in engine/web/latex.js (a preview, not a TeX engine); formulas are typeset by KaTeX, loaded on demand.
import { h, empty, debounce } from "../../core/util.js";
import {
  renderMarkdown, convertLatex, parseBib, formatReference, buildDocumentPage, MARKDOWN_PAGE_CSS, LATEX_PREVIEW_CSS, languageOf, resolveRef, dirname,
  joinPath, mimeOf, basename, sanitizeFileName,
} from "../../engine/web/index.js";
import { iconButton } from "../controls.js";
import { platform } from "../../platform/index.js";

/** "markdown" | "latex" | "bib" | null for a project path. */
export function docKind(path) {
  if (!path) return null;
  const lang = languageOf(path);
  if (lang === "markdown") return "markdown";
  if (lang === "latex") return /\.bib$/i.test(path) ? "bib" : /\.(tex|latex)$/i.test(path) ? "latex" : null;
  return null;
}

const KATEX_VERSION = "0.19.0";
let katexPromise = null;

/** Loads KaTeX (JS and CSS) once; rejects when the vendored files are missing. */
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = import("../../../vendor/katex/katex.mjs")
      .then((m) => {
        if (!document.querySelector("link[data-of-katex]")) {
          const link = h("link", { rel: "stylesheet", href: new URL("../../../vendor/katex/katex.min.css", import.meta.url).href });
          link.dataset.ofKatex = "1";
          document.head.append(link);
        }
        return m.default || m;
      })
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

/** Typesets every `.tex-math` placeholder below `root`. Returns the number of formulas that KaTeX rejected. */
export async function typesetMath(root) {
  const nodes = [...root.querySelectorAll(".tex-math")];
  if (!nodes.length) return 0;
  const katex = await loadKatex();
  let failed = 0;
  for (const el of nodes) {
    const tex = el.dataset.tex ?? el.textContent;
    try {
      katex.render(tex, el, { displayMode: el.dataset.display === "true", throwOnError: true, strict: "ignore", trust: false, output: "htmlAndMathml", maxExpand: 1000, maxSize: 50 });
      el.classList.remove("tex-error");
    } catch (err) {
      failed++;
      el.classList.add("tex-error");
      el.title = String(err.message || err).replace(/^KaTeX parse error: /, "");
      el.textContent = tex;
    }
  }
  return failed;
}

export class DocPreview {
  /** @param {import("./workspace.js").CodeWorkspace} ws */
  constructor(ws) {
    this.ws = ws;
    this.app = ws.app;
    this.web = ws.web;
    this.path = null;
    this.kind = null;
    this.blobs = new Map(); // path → { bytes, url }
    this.result = null;
    this.seq = 0;
    this.title = h("span.of-docbar__title");
    this.status = h("span.of-docbar__status");
    this.actions = h("div.of-docbar__actions");
    this.notice = h("div.of-docnotice.hidden", { role: "note" });
    this.problems = h("details.of-docproblems.hidden");
    this.page = h("article.of-docpage");
    this.scroll = h("div.of-docscroll", { tabindex: "0", role: "region", "aria-label": "Document preview" }, this.page);
    this.el = h("div.of-docpreview.hidden", h("div.of-docbar", this.title, this.status, this.actions), this.notice, this.problems, this.scroll);
    this.refreshSoon = debounce(() => this.refresh(), 250);
    this.#wire();
  }

  #wire() {
    this.web.on("text", ({ path }) => {
      if (!this.path || this.el.classList.contains("hidden")) return;
      if (path === this.path || this.#dependsOn(path)) this.refreshSoon();
    });
    this.web.on("tree", () => {
      if (this.path && !this.web.has(this.path)) return;
      if (!this.el.classList.contains("hidden")) this.refreshSoon();
    });
    this.page.addEventListener("click", (e) => this.#click(e));
    this.ws.on("cursor", (c) => this.#syncScroll(c));
  }

  #dependsOn(path) {
    return /\.(bib|tex|md|png|jpe?g|gif|svg|webp)$/i.test(path);
  }

  get visible() {
    return !this.el.classList.contains("hidden");
  }

  show(path) {
    this.path = path;
    this.kind = docKind(path);
    this.el.classList.remove("hidden");
    this.#buildBar();
    this.refresh();
  }
  hide() {
    this.el.classList.add("hidden");
  }

  #buildBar() {
    empty(this.actions);
    const k = this.kind;
    this.title.textContent = k === "markdown" ? "Markdown preview" : k === "latex" ? "LaTeX preview" : "Bibliography";
    const add = (b) => this.actions.append(b);
    if (k === "markdown" || k === "latex") {
      add(iconButton({ icon: "code-slash", label: "Export as an HTML page (added to the project)", onClick: () => this.exportToProject() }));
      add(iconButton({ icon: "download", label: "Download the HTML page", onClick: () => this.downloadHtml() }));
      add(iconButton({ icon: "file-earmark-text", label: k === "latex" ? "Print or save as PDF (the preview, not a TeX engine)" : "Print or save as PDF", onClick: () => this.print() }));
    }
    add(iconButton({ icon: "box-arrow-up-right", label: "Save this file to your computer…", onClick: () => this.saveSource() }));
    this.notice.classList.toggle("hidden", k !== "latex");
    if (k === "latex") {
      empty(this.notice);
      this.notice.append(h("strong", "Preview only. "), "This is a simplified converter, not a TeX engine: layout, fonts, page breaks and many packages are not reproduced. Unsupported commands are highlighted.");
    }
  }

  // ------------------------------------------------------------ rendering

  /** Blob URL for a project file (cached per file content). */
  #fileUrl(path) {
    const bytes = this.web.bytes(path);
    if (!bytes) return null;
    const hit = this.blobs.get(path);
    if (hit && hit.bytes === bytes) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
    this.blobs.set(path, { bytes, url });
    return url;
  }

  #allowRemote() {
    try {
      return this.app.network ? this.app.network.allowed("cdn") !== false : true;
    } catch {
      return true;
    }
  }

  async refresh() {
    const path = this.path;
    if (!path || !this.web.has(path)) return;
    const text = this.web.text(path) ?? "";
    const seq = ++this.seq;
    const scrollTop = this.scroll.scrollTop;
    let html = "";
    let diagnostics = [];
    let stats = "";
    let hasMath = false;
    try {
      if (this.kind === "markdown") {
        const res = renderMarkdown(text, {
          math: this.app.prefs.markdownMath !== false,
          mdx: /\.mdx$/i.test(path),
          lineMarkers: true,
          frontMatter: "table",
          resolveUrl: (url, kind) => {
            if (/^(https?:)?\/\//i.test(url)) return kind === "image" && !this.#allowRemote() ? null : url;
            if (/^(#|mailto:|tel:|data:|blob:)/i.test(url)) return url;
            const ref = resolveRef(path, url);
            if (!ref) return url;
            if (kind === "image") return this.#fileUrl(ref.path) ?? url;
            return url;
          },
        });
        html = res.html;
        hasMath = res.hasMath;
        stats = `${res.words} words`;
        this.result = res;
      } else if (this.kind === "latex") {
        const dir = dirname(path);
        const read = (p) => this.web.text(joinPath(dir, p)) ?? this.web.text(p);
        const res = convertLatex(text, {
          readFile: read,
          resolveImage: (p) => {
            const full = joinPath(dir, p);
            return this.web.has(full) ? this.#fileUrl(full) : this.web.has(p) ? this.#fileUrl(p) : null;
          },
        });
        html = `<div class="tex-doc">${res.html}</div>`;
        diagnostics = res.diagnostics.filter((d) => d.severity !== "info");
        hasMath = res.stats.math > 0;
        stats = `${res.stats.words} words · ${res.stats.math} formula${res.stats.math === 1 ? "" : "s"}${res.unsupported.length ? ` · ${res.unsupported.length} unsupported` : ""}`;
        this.result = res;
      } else {
        const entries = parseBib(text);
        html = `<div class="tex-doc"><h2>Bibliography</h2><ol class="tex-bib">${entries.map((e) => `<li><code>${escapeHtml(e.key)}</code> ${escapeHtml(formatReference(e))}</li>`).join("")}</ol>${entries.length ? "" : "<p>No entries found.</p>"}</div>`;
        stats = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
        this.result = { entries };
      }
    } catch (err) {
      console.error(err);
      html = `<p class="of-docerror">The preview failed: ${escapeHtml(err.message)}</p>`;
    }
    if (seq !== this.seq) return;
    this.page.className = `of-docpage ${this.kind === "markdown" ? "of-md" : "of-tex"}`;
    this.page.innerHTML = html;
    this.status.textContent = stats;
    this.#renderProblems(diagnostics);
    this.scroll.scrollTop = scrollTop;
    if (hasMath) {
      try {
        const failed = await typesetMath(this.page);
        if (seq === this.seq && failed) this.status.textContent = `${stats} · ${failed} formula${failed === 1 ? "" : "s"} KaTeX could not read`;
      } catch (err) {
        this.status.textContent = `${stats} · math could not be typeset (${err.message})`;
      }
    }
  }

  #renderProblems(list) {
    empty(this.problems);
    this.problems.classList.toggle("hidden", !list.length);
    if (!list.length) return;
    this.problems.append(h("summary", `${list.length} note${list.length === 1 ? "" : "s"} about this preview`));
    const ul = h("ul");
    for (const d of list.slice(0, 80)) {
      const b = h("button.of-linkbtn", { type: "button" }, `Line ${d.line}`);
      b.addEventListener("click", () => this.ws.editors.openFile(this.path, { line: d.line, focus: true }));
      ul.append(h("li", { class: d.severity }, b, ` ${d.message}`));
    }
    this.problems.append(ul);
  }

  #syncScroll(c) {
    if (this.kind !== "markdown" || !c || c.path !== this.path || !this.visible || !this.ws.editors.hasFocus()) return;
    let best = null;
    for (const el of this.page.querySelectorAll("[data-line]")) {
      if (Number(el.dataset.line) <= c.line) best = el;
      else break;
    }
    if (best) {
      const box = this.scroll.getBoundingClientRect();
      const r = best.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) this.scroll.scrollTop += r.top - box.top - 24;
    }
  }

  #click(e) {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    e.preventDefault();
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const target = this.page.querySelector(`[id="${CSS.escape(id)}"]`) || this.page.querySelector(`[id="md-${CSS.escape(id)}"]`);
      target?.scrollIntoView({ block: "start", behavior: this.app.prefs.reduceMotion ? "auto" : "smooth" });
      return;
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) return this.ws.openExternal(href);
    const ref = resolveRef(this.path, href);
    if (ref && this.web.has(ref.path)) return this.ws.openFile(ref.path, { focus: false });
    this.app.toast(`“${href}” is not a file in this project.`, "warning", 2400);
  }

  // ------------------------------------------------------------ export

  /** Standalone HTML of the current preview (math pre-rendered; KaTeX CSS from the CDN when `online`). */
  async standaloneHtml({ forPrint = false } = {}) {
    const res = this.result;
    let body = this.page.innerHTML;
    const hasMath = !!this.page.querySelector(".katex");
    const title = (this.kind === "markdown" ? res?.title : res?.title) || basename(this.path).replace(/\.[^.]+$/, "");
    const css = this.kind === "latex" ? `${MARKDOWN_PAGE_CSS}\n${LATEX_PREVIEW_CSS}` : MARKDOWN_PAGE_CSS;
    // blob: image URLs do not survive outside the app: embed project images as data URLs
    body = await inlineBlobImages(body);
    body = body.replace(/ data-line="\d+"/g, "");
    const katexCss = forPrint ? new URL("../../../vendor/katex/katex.min.css", import.meta.url).href : `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
    const head = hasMath ? `<link rel="stylesheet" href="${katexCss}">\n` : "";
    return buildDocumentPage({ html: body, title, css, head });
  }

  async exportToProject() {
    try {
      const html = await this.standaloneHtml();
      const name = sanitizeFileName(basename(this.path).replace(/\.[^.]+$/, "")) || "document";
      const dir = dirname(this.path);
      const target = `${dir ? `${dir}/` : ""}${name}.html`;
      if (this.web.has(target)) this.web.setText(target, html, "api");
      else this.web.create(target, html);
      this.app.toast(`Exported ${target}. Math in the page uses the KaTeX stylesheet from a CDN.`, "success", 3500);
      this.ws.openFile(target, { keepPage: true });
    } catch (err) {
      this.app.toast(err.message, "danger", 5000);
    }
  }

  async downloadHtml() {
    const html = await this.standaloneHtml();
    const name = `${sanitizeFileName(basename(this.path).replace(/\.[^.]+$/, "")) || "document"}.html`;
    await platform.saveFile({ suggestedName: name, bytes: new TextEncoder().encode(html), mime: "text/html", filters: [{ name: "HTML page", extensions: ["html"] }] });
  }

  async saveSource() {
    const text = this.web.text(this.path) ?? "";
    const name = basename(this.path);
    const ext = name.split(".").pop();
    await platform.saveFile({ suggestedName: name, bytes: new TextEncoder().encode(text), mime: mimeOf(this.path), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  }

  async print() {
    const html = await this.standaloneHtml({ forPrint: true });
    const frame = h("iframe", { title: "Print preview", style: { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" } });
    frame.addEventListener("load", () => {
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (err) {
          this.app.toast(`Printing is not available here: ${err.message}. Use “Download the HTML page” and print it from a browser.`, "warning", 5000);
        }
        setTimeout(() => frame.remove(), 60000);
      }, 400);
    });
    frame.srcdoc = html;
    document.body.append(frame);
  }

  destroy() {
    for (const { url } of this.blobs.values()) URL.revokeObjectURL(url);
    this.blobs.clear();
  }
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function inlineBlobImages(html) {
  const urls = [...new Set([...html.matchAll(/src="(blob:[^"]+)"/g)].map((m) => m[1]))];
  let out = html;
  for (const u of urls) {
    try {
      const blob = await (await fetch(u)).blob();
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      out = out.split(u).join(data);
    } catch {
      /* leave the URL; the image just will not show */
    }
  }
  return out;
}
