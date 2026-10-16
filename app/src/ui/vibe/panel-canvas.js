// Vibe Studio side panels: Canvas (live view of the document the assistant works on) and Activity (plan, undo).
import { h, empty, debounce } from "../../core/util.js";
import { exportRaster } from "../../core/io.js";
import { iconEl } from "../toolbox.js";

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
    info.replaceChildren(h("strong", doc.name), h("span", `${doc.pages.length > 1 ? `${page.name} · ` : ""}${Math.round(page.w)} × ${Math.round(page.h)} px`), doc.web ? h("span", `${doc.web.files.size} website files`) : null);
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
          makeScriptUrl: (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(app.prefs.previewScripts === false ? "" : code)}`,
          makeAssetUrl: toDataUrl,
        });
        site.srcdoc = res.html;
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

export function createActivityPanel(vs) {
  const { app, session } = vs;
  const plan = h("div.of-vplan");
  const runs = h("div.of-vruns");
  const el = h("div.of-vactivity", h("h3", "Plan"), plan, h("h3", "Changes"), runs, h("p.of-hint", "Every change Vibe makes is a normal OpenFini edit: you can also undo it step by step with Ctrl+Z."));

  function renderPlan() {
    empty(plan);
    if (!session.plan.length) return plan.append(h("div.of-empty", "Vibe shows its plan here for multi-step work."));
    for (const s of session.plan) plan.append(h("div.of-vplan__step", { class: s.status }, iconEl(s.status === "done" ? "check-circle-fill" : s.status === "active" ? "arrow-right-circle-fill" : "circle"), h("span", s.text)));
  }
  function renderRuns() {
    empty(runs);
    if (!session.runs.length) return runs.append(h("div.of-empty", "No AI changes in this chat yet."));
    for (const r of session.runs.slice().reverse()) runs.append(h("div.of-vruns__row", h("span", `“${r.title}” — ${r.doc.history.index - r.marker} edit${r.doc.history.index - r.marker === 1 ? "" : "s"} in ${r.doc.name}`)));
    runs.append(h("button.of-btn.of-btn--primary", { type: "button", onclick: () => { const n = session.undoLastRun(); app.toast(`Undid ${n} change${n === 1 ? "" : "s"}.`, "success", 1600); } }, iconEl("arrow-counterclockwise"), "Undo last AI run"));
  }
  session.on("plan", renderPlan);
  session.on("runs", renderRuns);
  session.on("chat", () => { renderPlan(); renderRuns(); });
  renderPlan();
  renderRuns();
  return { el };
}
