// Vibe Studio side panels: Canvas (live view of the document the assistant works on).
import { h, empty, debounce } from "../../core/util.js";
import { scriptsBlocked } from "../../core/security.js";
import { withOfflinePreviewCsp } from "../../core/network.js";
import { exportRaster } from "../../core/io.js";

const STUDIO_BUTTONS = [["vector", "Vector"], ["pixel", "Pixel"], ["layout", "Layout"], ["code", "Code"]];

export function createCanvasPanel(vs) {
  const { app, session } = vs;
  const img = h("img.of-vcanvas__img", { alt: "Current page", draggable: "false" });
  const info = h("div.of-vcanvas__info");
  const site = h("iframe.of-vcanvas__site", { sandbox: "allow-scripts", title: "Website preview", referrerpolicy: "no-referrer" });
  const frame = h("div.of-vcanvas__frame", img, site);
  const empty0 = h("div.of-empty", "Open or create a document — Vibe's changes appear here live.");
  const actions = h("div.of-vcanvas__actions");
  const el = h("div.of-vcanvas", frame, info, actions, empty0);
  let url = null;
  let busy = false;
  let again = false;

  async function refresh() {
    const doc = app.doc;
    empty(actions);
    frame.classList.toggle("hidden", !doc);
    empty0.classList.toggle("hidden", !!doc);
    if (!doc) return (info.textContent = "");
    const page = app.page;
    info.replaceChildren(...[h("strong", doc.name), h("span", `${doc.pages.length > 1 ? `${page.name} · ` : ""}${Math.round(page.w)} × ${Math.round(page.h)} px`), doc.web ? h("span", `${doc.web.files.size} website files`) : null].filter(Boolean));
    for (const [id, label] of STUDIO_BUTTONS) actions.append(h("button.of-btn", { type: "button", class: app.studio === id ? "of-btn--primary" : "", onclick: () => app.setStudio(id) }, label));
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      if (doc.web && !page.root.children.length) {
        // a sandboxed, script-free-from-the-app view of the site (data: scripts like the Code studio preview)
        const [{ buildPreview }, { toDataUrl }] = await Promise.all([import("../../engine/web/index.js"), import("../code/preview.js")]);
        const entry = doc.web.settings?.page && doc.web.has(doc.web.settings.page) ? doc.web.settings.page : doc.web.entry;
        const res = buildPreview(doc.web.source, entry, {
          config: { mode: "preview" },
          makeScriptUrl: (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(scriptsBlocked(app.prefs, doc) ? "" : code)}`,
          makeAssetUrl: toDataUrl,
        });
        site.srcdoc = withOfflinePreviewCsp(res.html, app.network?.offline);
        frame.classList.add("web");
        return;
      }
      frame.classList.remove("web");
      const k = Math.min(1, 520 / Math.max(page.w, page.h));
      const r = await exportRaster(app, { page, format: "png", scale: k });
      const next = URL.createObjectURL(new Blob([r.bytes], { type: "image/png" }));
      img.src = next;
      if (url) URL.revokeObjectURL(url);
      url = next;
    } catch {
      /* the page may be empty or mid-edit */
    } finally {
      busy = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }
  const schedule = debounce(refresh, 350);
  for (const ev of ["docchange", "doc", "page", "studio", "selection"]) app.on(ev, schedule);
  session.on("event", (e) => e.type === "tool_end" && schedule());
  return { el, show: refresh };
}
