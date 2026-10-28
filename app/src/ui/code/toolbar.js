// Toolbar of the Code studio (shown in the context bar): view switch, page, breakpoints, zoom, preview mode.
import { h, empty, optVal, optDecode } from "../../core/util.js";
import { BREAKPOINTS, sanitizeFileName } from "../../engine/web/index.js";
import { iconButton, segmented, button } from "../controls.js";
import { promptDialog } from "../dialogs.js";
import { starterContent } from "../../core/web.js";
import { ta } from "../../i18n/dom.js";
import { N_ } from "../../i18n/index.js";

const BP_ICONS = { "desktop-2xl": "display", "desktop-xl": "pc-display", desktop: "laptop", tablet: "tablet", "mobile-landscape": "phone-landscape", "mobile-portrait": "phone" };

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

  const pageSel = h("sl-select", { size: "small", hoist: true, class: "of-codebar__page", "aria-label": "Page shown in the preview", value: optVal(ws.page || "") });
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

  // zoom lives in the viewport bar above the preview (viewport-ui.js)

  // split arrangement (only in Split view): the filled half is the code editor
  const LAYOUT_BTNS = [
    { id: "codeLeft", label: N_("Code left, preview right"), svg: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="3" width="5.5" height="10" fill="currentColor" opacity=".55"/>' },
    { id: "codeRight", label: N_("Preview left, code right"), svg: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="8.5" y="3" width="5.5" height="10" fill="currentColor" opacity=".55"/>' },
    { id: "codeTop", label: N_("Code above, preview below"), svg: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="3" width="12" height="4.5" fill="currentColor" opacity=".55"/>' },
    { id: "codeBottom", label: N_("Preview above, code below"), svg: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="8.5" width="12" height="4.5" fill="currentColor" opacity=".55"/>' },
  ];
  const layoutEl = h("div.of-seg.of-codebar__layout", { role: "group", ...ta({ "aria-label": "Split layout" }) });
  const layoutBtns = LAYOUT_BTNS.map((l) => {
    const b = h("button.of-seg__btn", { type: "button", ...ta({ tip: l.label, "aria-label": l.label }) });
    // parsed as an SVG document (never innerHTML): the markup is a constant above, and this keeps scripts inert regardless
    b.append(document.importNode(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${l.svg}</svg>`, "image/svg+xml").documentElement, true));
    b.addEventListener("click", () => ws.app.run(`code.layout.${l.id}`));
    layoutEl.append(b);
    return b;
  });

  const measure = iconButton({ icon: "rulers", label: "Measure tool (M): hover to measure, Alt for distances, Esc to leave", onClick: () => ws.app.run("code.measure") });
  const mode = iconButton({ icon: "cursor", label: "Design mode — click to select and edit", onClick: () => ws.preview.setMode(!ws.preview.edit) });
  const reload = iconButton({ icon: "arrow-repeat", label: "Reload preview", onClick: () => ws.preview.rebuild() });
  const format = iconButton({ icon: "text-indent-left", label: "Format document (Shift+Alt+F)", onClick: () => ws.editors.format() });
  const palette = iconButton({ icon: "terminal", label: "Command palette (Ctrl+Shift+P)", onClick: () => ws.palette() });
  const bottomBtn = iconButton({ icon: "layout-text-window-reverse", label: "Console and problems (Ctrl+J)", onClick: () => ws.bottom.toggle() });
  const publish = button("Publish", () => import("../export-dialog.js").then((m) => m.exportDialog(ws.app, { tab: "publish" })), { variant: "primary", icon: "upload", title: "Publish the website to Netlify, Vercel, GitHub Pages, WebDAV or your own server" });
  const badge = h("span.of-codebar__badge.hidden");
  const bottomWrap = h("span.of-codebar__withbadge", bottomBtn, badge);

  el.append(
    h("div.of-codebar__group", view.el, layoutEl),
    h("span.of-sep"),
    h("div.of-codebar__group.of-codebar__design", pageSel, addPage),
    h("span.of-sep"),
    h("div.of-codebar__group.of-codebar__design", bps.el, bpLabel),
    h("span.of-sep"),
    h("div.of-codebar__group.of-codebar__design", measure, mode, reload),
    h("span.of-codebar__spacer"),
    h("div.of-codebar__group", format, bottomWrap, palette, publish),
  );

  function renderPages() {
    const pages = web.pages();
    empty(pageSel);
    for (const p of pages) pageSel.append(h("sl-option", { value: optVal(p) }, p));
    customElements.whenDefined("sl-select").then(() => {
      pageSel.value = optVal(ws.page && pages.includes(ws.page) ? ws.page : pages[0] || "");
    });
  }
  pageSel.addEventListener("sl-change", () => pageSel.value && optDecode(pageSel.value) !== ws.page && ws.showPage(optDecode(pageSel.value)));
  renderPages();
  web.on("tree", renderPages);
  ws.on("page", () => (pageSel.value = optVal(ws.page)));
  ws.preview.on("page", () => (pageSel.value = optVal(ws.page)));

  const sync = () => {
    const bp = ws.preview.bp;
    bps.set(bp.id);
    // the viewport can be any width: the segmented control highlights the breakpoint that matches it
    bpLabel.textContent = `${ws.preview.vw}px`;
    view.set(ws.view);
    layoutEl.classList.toggle("hidden", ws.view !== "split");
    LAYOUT_BTNS.forEach((l, i) => layoutBtns[i].setAttribute("aria-pressed", String(ws.layout === l.id)));
    measure.classList.toggle("active", ws.preview.measuring);
    measure.setAttribute("aria-pressed", String(ws.preview.measuring));
    mode.classList.toggle("active", ws.preview.edit);
    mode.setAttribute("data-tip", ws.preview.edit ? "Design mode — click to select and edit (click to switch to live preview)" : "Live preview — the page behaves normally (click to switch back to design mode)");
    mode.querySelector("sl-icon")?.setAttribute("name", ws.preview.edit ? "cursor" : "play-circle");
  };
  ws.preview.on("breakpoint", sync);
  ws.preview.on("viewport", sync);
  ws.preview.on("measure", sync);
  ws.preview.on("mode", sync);
  ws.on("layout", sync);
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
