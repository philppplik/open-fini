// Toolbar of the Code studio (shown in the context bar): view switch, page, breakpoints, zoom, preview mode.
import { h, empty } from "../../core/util.js";
import { BREAKPOINTS, sanitizeFileName } from "../../engine/web/index.js";
import { iconButton, segmented } from "../controls.js";
import { promptDialog } from "../dialogs.js";
import { starterContent } from "../../core/web.js";

const BP_ICONS = { "desktop-2xl": "display", "desktop-xl": "pc-display", desktop: "laptop", tablet: "tablet", "mobile-landscape": "phone-landscape", "mobile-portrait": "phone" };
const ZOOMS = [{ value: "fit", label: "Fit" }, ...[25, 50, 75, 100, 125, 150, 200].map((n) => ({ value: String(n / 100), label: `${n}%` }))];

export function createToolbar(ws) {
  const { web } = ws;
  const el = h("div.of-codebar__inner");

  const view = segmented(
    [
      { value: "design", label: "Design — visual canvas", icon: "palette2" },
      { value: "split", label: "Split — code and canvas", icon: "layout-split" },
      { value: "code", label: "Code — editor only", icon: "code-slash" },
    ],
    ws.view,
    (v) => ws.setView(v),
  );

  const pageSel = h("sl-select", { size: "small", hoist: true, class: "of-codebar__page", "aria-label": "Page shown in the preview", value: ws.page || "" });
  const addPage = iconButton({ icon: "file-earmark-plus", label: "New page…", onClick: async () => {
    const name = await promptDialog({ title: "New page", label: "File name", value: "about.html", ok: "Create" });
    if (!name) return;
    try {
      const clean = sanitizeFileName(name.replace(/\.html?$/i, "")) + ".html";
      const f = web.create(clean, starterContent(clean));
      ws.openFile(f.path, { focus: true });
      ws.showPage(f.path);
    } catch (err) {
      ws.app.toast(err.message, "warning");
    }
  } });

  const bps = segmented(
    ["desktop-2xl", "desktop-xl", "desktop", "tablet", "mobile-landscape", "mobile-portrait"]
      .map((id) => BREAKPOINTS.find((b) => b.id === id))
      .filter(Boolean)
      .map((b) => ({ value: b.id, label: `${b.label} — ${b.width} px`, icon: BP_ICONS[b.id] || "window" })),
    ws.preview.bp.id,
    (v) => ws.preview.setBreakpoint(v),
    { cls: "of-codebar__bps" },
  );
  const bpLabel = h("span.of-codebar__bplabel");

  const zoomSel = h("sl-select", { size: "small", hoist: true, class: "of-codebar__zoom", value: String(ws.preview.zoomSetting), "aria-label": "Zoom" });
  for (const z of ZOOMS) zoomSel.append(h("sl-option", { value: z.value }, z.label));
  zoomSel.addEventListener("sl-change", () => ws.preview.setZoom(zoomSel.value === "fit" ? "fit" : Number(zoomSel.value)));

  const mode = iconButton({ icon: "cursor", label: "Design mode — click to select and edit", onClick: () => ws.preview.setMode(!ws.preview.edit) });
  const reload = iconButton({ icon: "arrow-repeat", label: "Reload preview", onClick: () => ws.preview.rebuild() });
  const format = iconButton({ icon: "text-indent-left", label: "Format document (Shift+Alt+F)", onClick: () => ws.editors.format() });
  const palette = iconButton({ icon: "terminal", label: "Command palette (Ctrl+Shift+P)", onClick: () => ws.palette() });
  const bottomBtn = iconButton({ icon: "layout-text-window-reverse", label: "Console and problems (Ctrl+J)", onClick: () => ws.bottom.toggle() });
  const badge = h("span.of-codebar__badge.hidden");
  const bottomWrap = h("span.of-codebar__withbadge", bottomBtn, badge);

  el.append(
    h("div.of-codebar__group", view.el),
    h("span.of-sep"),
    h("div.of-codebar__group", pageSel, addPage),
    h("span.of-sep"),
    h("div.of-codebar__group", bps.el, bpLabel, zoomSel),
    h("span.of-sep"),
    h("div.of-codebar__group", mode, reload),
    h("span.of-codebar__spacer"),
    h("div.of-codebar__group", format, bottomWrap, palette),
  );

  function renderPages() {
    const pages = web.pages();
    empty(pageSel);
    for (const p of pages) pageSel.append(h("sl-option", { value: p }, p));
    customElements.whenDefined("sl-select").then(() => {
      pageSel.value = ws.page && pages.includes(ws.page) ? ws.page : pages[0] || "";
    });
  }
  pageSel.addEventListener("sl-change", () => pageSel.value && pageSel.value !== ws.page && ws.showPage(pageSel.value));
  renderPages();
  web.on("tree", renderPages);
  ws.on("page", () => (pageSel.value = ws.page));
  ws.preview.on("page", () => (pageSel.value = ws.page));

  const sync = () => {
    const bp = ws.preview.bp;
    bps.set(bp.id);
    bpLabel.textContent = `${bp.width}px`;
    view.set(ws.view);
    mode.classList.toggle("active", ws.preview.edit);
    mode.setAttribute("data-tip", ws.preview.edit ? "Design mode — click to select and edit (click to switch to live preview)" : "Live preview — the page behaves normally (click to switch back to design mode)");
    mode.querySelector("sl-icon")?.setAttribute("name", ws.preview.edit ? "cursor" : "play-circle");
  };
  ws.preview.on("breakpoint", sync);
  ws.preview.on("mode", sync);
  ws.on("view", sync);
  sync();

  const updateBadge = () => {
    const n = ws.problemCount?.() || 0;
    badge.textContent = String(n);
    badge.classList.toggle("hidden", !n);
  };
  ws.on("problems", updateBadge);
  return { el, sync, renderPages };
}
