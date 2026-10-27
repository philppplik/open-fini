// Vibe Studio side panel "Canvas": a live preview of the active document with zoom and pan, a page switcher, a layers
// outline (select, show/hide, lock, drag onto the composer), rings around the layers the AI just touched, a before /
// after slider for the chat's last run, "Open in studio" and "Export…" shortcuts and document info. Website projects
// show their live preview frame with device presets.
//
// Public API: createCanvasPanel(vs) → { el, show, compare(runId) } (vs.canvas is set to it)
// Performance invariants: the page is rendered only when the panel is visible, debounced (350 ms) after a change,
// at a bounded resolution (longest side ≤ MAX_RENDER px); nothing runs while idle (no animation loops).
import { h, empty, debounce } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { showContextMenu } from "../menus.js";
import { scriptsBlocked } from "../../core/security.js";
import { withOfflinePreviewCsp } from "../../core/network.js";
import { exportRaster } from "../../core/io.js";
import { layerIcon } from "./layer-icons.js";
import { layerBounds } from "./composer-mentions.js";

const MAX_RENDER = 1800;
const MAX_OUTLINE = 600;
const ZOOMS = [["fit", "Fit"], [0.5, "50%"], [1, "100%"], [2, "200%"]];
const DEVICES = [["desktop", "Desktop", 1280, "display"], ["tablet", "Tablet", 768, "tablet"], ["phone", "Phone", 390, "phone"]];
const STUDIOS = [["vector", "Vector", "vector-pen"], ["pixel", "Pixel", "brush"], ["layout", "Layout", "layout-text-window"], ["code", "Code", "code-slash"], ["office", "Office", "file-earmark-text"]];
const LAYER_DRAG = "application/x-openfini-layer";

const studioFor = (doc) => (doc?.web && !doc.pages?.[0]?.root?.children?.length ? "code" : doc?.office ? "office" : ["vector", "pixel", "layout"].includes(doc?.studio) ? doc.studio : "vector");

export function createCanvasPanel(vs) {
  const { app, session } = vs;
  const btn = (icon, label, onClick, extra = {}) => {
    const b = h("button.of-vcv__btn", { type: "button", "aria-label": t(label), "data-tip": t(label), ...extra }, iconEl(icon));
    b.addEventListener("click", (e) => onClick(b, e));
    return b;
  };

  // ---- toolbar
  const pageSel = h("select.of-vcv__pages", { "aria-label": t("Page") });
  const zoomLabel = h("span.of-vcv__zoomlabel", { "aria-live": "polite" });
  const zoomOut = btn("zoom-out", "Zoom out", () => zoomBy(1 / 1.25));
  const zoomIn = btn("zoom-in", "Zoom in", () => zoomBy(1.25));
  const zoomMenu = h("button.of-vcv__zoom", { type: "button", "aria-haspopup": "menu", "aria-label": t("Zoom level") }, zoomLabel, iconEl("chevron-down"));
  const compareBtn = btn("layout-split", "Before / after the last AI run", () => (comparing ? stopCompare() : compare()), { "aria-pressed": "false" });
  const outlineBtn = btn("layers", "Show the layers outline", () => toggleOutline(), { "aria-pressed": "true" });
  const openMain = h("button.of-btn.of-btn--sm.of-vcv__open", { type: "button" });
  const openMore = h("button.of-btn.of-btn--sm.of-vcv__openmore", { type: "button", "aria-haspopup": "menu", "aria-label": t("Open in another studio") }, iconEl("chevron-down"));
  const exportBtn = btn("download", "Export…", () => app.run("file.export"));
  const deviceBar = h("div.of-vcv__devices", { role: "group", "aria-label": t("Preview size") });
  const toolbar = h("div.of-vcv__bar", { role: "toolbar", "aria-label": t("Canvas") }, pageSel, h("span.of-vcv__group", zoomOut, zoomMenu, zoomIn), deviceBar, compareBtn, outlineBtn, h("span.of-vcv__spacer"), h("span.of-vcv__split", openMain, openMore), exportBtn);

  // ---- stage
  const img = h("img.of-vcv__img", { alt: "", draggable: "false" });
  const beforeImg = h("img.of-vcv__before", { alt: "", draggable: "false" });
  const rings = h("div.of-vcv__rings", { "aria-hidden": "true" });
  const paper = h("div.of-vcv__paper", img, beforeImg, rings);
  const slider = h("input.of-vcv__slider.hidden", { type: "range", min: "0", max: "100", value: "50", "aria-label": t("Before / after position") });
  const site = h("iframe.of-vcv__site", { sandbox: "allow-scripts", title: t("Website preview"), referrerpolicy: "no-referrer" });
  const siteWrap = h("div.of-vcv__sitewrap.hidden", site);
  const stage = h("div.of-vcv__stage", { tabindex: "0", role: "img", "aria-label": t("Page preview. Use + and − to zoom, arrow keys to pan, 0 to fit.") }, paper, siteWrap, slider);
  const touched = h("div.of-vcv__touched", { role: "list", "aria-label": t("Touched by AI") });
  const info = h("div.of-vcv__info");
  const outline = h("div.of-vcv__outline", { role: "tree", "aria-label": t("Layers") });
  const outlineWrap = h("section.of-vcv__outwrap", h("h3", t("Layers")), outline);
  const emptyEl = h("div.of-vcv__empty");
  const el = h("div.of-vcv", toolbar, stage, touched, info, outlineWrap, emptyEl);

  let url = null;
  let busy = false;
  let again = false;
  let zoom = "fit"; // "fit" or a factor (screen px per page px)
  let pan = { x: 0, y: 0 };
  let device = "desktop";
  let comparing = null; // runId
  let showOutline = true;
  const collapsed = new Set();
  const visible = () => el.isConnected && el.offsetParent !== null;

  // ---- geometry
  function fitScale() {
    const p = app.page;
    if (!p) return 1;
    const r = stage.getBoundingClientRect();
    return Math.max(0.02, Math.min((r.width - 16) / p.w, (r.height - 16) / p.h));
  }
  const scaleNow = () => (zoom === "fit" ? fitScale() : zoom);
  function applyView() {
    const p = app.page;
    if (!p) return;
    const k = scaleNow();
    const r = stage.getBoundingClientRect();
    if (zoom === "fit") pan = { x: (r.width - p.w * k) / 2, y: (r.height - p.h * k) / 2 };
    paper.style.width = `${p.w}px`;
    paper.style.height = `${p.h}px`;
    paper.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${k})`;
    paper.style.setProperty("--inv", String(1 / k));
    zoomLabel.textContent = zoom === "fit" ? `${t("Fit")} · ${Math.round(k * 100)}%` : `${Math.round(k * 100)}%`;
  }
  function setZoom(z, at = null) {
    const p = app.page;
    if (!p) return;
    const old = scaleNow();
    const next = z === "fit" ? "fit" : Math.max(0.05, Math.min(8, z));
    if (next !== "fit") {
      const r = stage.getBoundingClientRect();
      const c = at || { x: r.width / 2, y: r.height / 2 };
      if (zoom === "fit") pan = { x: (r.width - p.w * old) / 2, y: (r.height - p.h * old) / 2 };
      pan = { x: c.x - ((c.x - pan.x) * next) / old, y: c.y - ((c.y - pan.y) * next) / old };
    }
    zoom = next;
    applyView();
    scheduleRender(); // a sharper render when zooming in (bounded by MAX_RENDER)
  }
  const zoomBy = (f, at) => setZoom(scaleNow() * f, at);
  zoomMenu.addEventListener("click", () => {
    const r = zoomMenu.getBoundingClientRect();
    showContextMenu(app, r.left, r.bottom + 4, ZOOMS.map(([z, label]) => ({ label: t(label), checked: zoom === z, run: () => setZoom(z) })));
  });
  stage.addEventListener("wheel", (e) => {
    if (siteWrap.classList.contains("hidden") === false) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  // pan: drag with the mouse (any button; Space + drag works the same way)
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target === slider || !app.page || !siteWrap.classList.contains("hidden")) return;
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
      drag.moved = true;
      stage.classList.add("panning");
      if (zoom === "fit") zoom = fitScale(); // pan keeps the current scale; the label switches from Fit to a percentage
    }
    pan = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y };
    applyView();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("keydown", (e) => {
    const step = 40;
    const k = { "+": () => zoomBy(1.25), "=": () => zoomBy(1.25), "-": () => zoomBy(0.8), 0: () => setZoom("fit"), 1: () => setZoom(1), ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0), ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step) }[e.key];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    k();
  });
  function panBy(dx, dy) {
    if (zoom === "fit") zoom = fitScale();
    pan = { x: pan.x + dx, y: pan.y + dy };
    applyView();
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(() => visible() && (zoom === "fit" ? applyView() : null)).observe(stage);

  // ---- render (debounced, bounded, only while visible)
  async function render() {
    const doc = app.doc;
    paintChrome();
    if (!doc || !visible()) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const page = app.page;
      if (doc.web && !page.root.children.length) {
        paper.classList.add("hidden");
        siteWrap.classList.remove("hidden");
        const [{ buildPreview }, { toDataUrl }] = await Promise.all([import("../../engine/web/index.js"), import("../code/preview.js")]);
        const entry = doc.web.settings?.page && doc.web.has(doc.web.settings.page) ? doc.web.settings.page : doc.web.entry;
        const res = buildPreview(doc.web.source, entry, {
          config: { mode: "preview" },
          makeScriptUrl: (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(scriptsBlocked(app.prefs, doc) ? "" : code)}`,
          makeAssetUrl: toDataUrl,
        });
        site.srcdoc = withOfflinePreviewCsp(res.html, app.network?.offline);
        sizeSite();
        return;
      }
      siteWrap.classList.add("hidden");
      paper.classList.remove("hidden");
      if (doc.office && !page.root.children.length) return;
      const want = Math.min(2, scaleNow() * (devicePixelRatio || 1));
      const k = Math.min(want, MAX_RENDER / Math.max(page.w, page.h));
      const r = await exportRaster(app, { page, format: "png", scale: Math.max(0.02, k) });
      const next = URL.createObjectURL(new Blob([r.bytes], { type: "image/png" }));
      img.src = next;
      if (url) URL.revokeObjectURL(url);
      url = next;
      applyView();
      paintRings();
    } catch {
      /* the page may be empty or mid-edit */
    } finally {
      busy = false;
      if (again) {
        again = false;
        scheduleRender();
      }
    }
  }
  const scheduleRender = debounce(render, 350);
  function sizeSite() {
    const w = DEVICES.find((d) => d[0] === device)[2];
    const r = stage.getBoundingClientRect();
    const k = Math.min(1, (r.width - 8) / w);
    site.style.width = `${w}px`;
    site.style.height = `${Math.max(200, (r.height - 8) / k)}px`;
    site.style.transform = `scale(${k})`;
  }

  // ---- chrome: page list, studio buttons, info, outline, empty state
  function paintChrome() {
    const doc = app.doc;
    el.classList.toggle("is-empty", !doc);
    el.classList.toggle("is-web", !!(doc?.web && !app.page?.root.children.length));
    if (!doc) return paintEmpty();
    const page = app.page;
    empty(pageSel);
    doc.pages.forEach((p, i) => pageSel.append(h("option", { value: String(i), selected: p === page }, `${i + 1}. ${p.name || t("Page")}`)));
    pageSel.classList.toggle("hidden", doc.pages.length < 2);
    const main = studioFor(doc);
    const m = STUDIOS.find((s) => s[0] === main);
    openMain.replaceChildren(iconEl(m[2]), h("span", t("Open in {studio}", { studio: t(m[1]) })));
    openMain.onclick = () => app.setStudio(main);
    empty(deviceBar);
    if (el.classList.contains("is-web")) for (const [id, label, , icon] of DEVICES) deviceBar.append(btn(icon, label, () => { device = id; paintChrome(); sizeSite(); }, { "aria-pressed": String(device === id) }));
    let layers = 0;
    for (const p of doc.pages) (function count(n) { for (const c of n.children || []) { layers++; count(c); } })(p.root);
    info.replaceChildren(...[h("strong", doc.name), h("span", `${Math.round(page.w)} × ${Math.round(page.h)} px`), h("span", t("{n} page(s)", { n: String(doc.pages.length) })), h("span", t("{n} layer(s)", { n: String(layers) })), doc.web ? h("span", t("{n} website file(s)", { n: String(doc.web.files.size) })) : null].filter(Boolean));
    paintOutline();
    paintTouched();
  }
  pageSel.addEventListener("change", () => {
    const p = app.doc?.pages[Number(pageSel.value)];
    if (p) app.setActivePage(p);
  });
  openMore.addEventListener("click", () => {
    const r = openMore.getBoundingClientRect();
    const doc = app.doc;
    showContextMenu(app, r.left, r.bottom + 4, STUDIOS.filter(([id]) => (id !== "office" || doc?.office) && (id !== "code" || doc?.web)).map(([id, label, icon]) => ({ label: t("Open in {studio}", { studio: t(label) }), icon, run: () => app.setStudio(id) })));
  });

  function paintEmpty() {
    const ideas = [
      ["Design a logo", "Design a clean logo for a coffee roaster called “Ember & Oak” with three color variations."],
      ["Make a poster", "Make a 1080×1350 poster for a jazz night on Friday at 8 pm."],
      ["Build a landing page", "Create a landing page for a note-taking app called Fieldnote."],
    ];
    emptyEl.replaceChildren(
      iconEl("easel"),
      h("p", t("Open or create a document: Vibe's changes appear here live.")),
      h("div.of-vcv__ideas", ideas.map(([label, prompt]) => h("button.of-btn.of-btn--sm", { type: "button", onclick: () => vs.chat?.setInput(prompt) }, t(label)))),
      h("button.of-btn.of-btn--sm", { type: "button", onclick: () => app.emit("dialog", { id: "new", studio: "vector" }) }, iconEl("file-earmark-plus"), t("New document…")),
    );
  }

  // outline: a tree of the active page (newest on top like the Layers panel)
  function paintOutline() {
    outlineWrap.classList.toggle("hidden", !showOutline || !app.page?.root.children.length);
    if (!showOutline || !visible()) return;
    const page = app.page;
    const sel = new Set(app.selection);
    const touchedIds = new Set(lastTouched().map((c) => c.id));
    const focusId = outline.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    empty(outline);
    let n = 0;
    const row = (node, depth, group) => {
      if (++n > MAX_OUTLINE) return;
      const kids = node.children || [];
      const open = !collapsed.has(node.id);
      const item = h("div.of-vcv__node", { role: "treeitem", tabindex: "-1", "data-id": node.id, "aria-level": String(depth + 1), "aria-selected": String(sel.has(node)), "aria-expanded": kids.length ? String(open) : null, draggable: "true", class: `${sel.has(node) ? "selected" : ""} ${touchedIds.has(node.id) ? "touched" : ""} ${node.visible === false ? "hidden-layer" : ""}`, style: { paddingLeft: `${4 + depth * 14}px` } },
        kids.length ? h("button.of-vcv__twisty", { type: "button", tabindex: "-1", "aria-label": open ? t("Collapse") : t("Expand"), onclick: (e) => { e.stopPropagation(); toggleNode(node); } }, iconEl(open ? "chevron-down" : "chevron-right")) : h("span.of-vcv__twisty"),
        iconEl(layerIcon(node.type)),
        h("span.of-vcv__name", node.name || node.type),
        touchedIds.has(node.id) ? h("span.of-vcv__ai", { title: t("Touched by AI in the last run") }, "AI") : null,
        h("button.of-vcv__eye", { type: "button", tabindex: "-1", "aria-label": node.visible === false ? t("Show layer") : t("Hide layer"), "aria-pressed": String(node.visible === false), onclick: (e) => { e.stopPropagation(); setFlag(node, "visible", node.visible === false); } }, iconEl(node.visible === false ? "eye-slash" : "eye")),
        h("button.of-vcv__lock", { type: "button", tabindex: "-1", "aria-label": node.locked ? t("Unlock layer") : t("Lock layer"), "aria-pressed": String(!!node.locked), onclick: (e) => { e.stopPropagation(); setFlag(node, "locked", !node.locked); } }, iconEl(node.locked ? "lock" : "unlock")),
      );
      item.addEventListener("click", (e) => selectNode(node, e.shiftKey || e.ctrlKey || e.metaKey));
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(LAYER_DRAG, node.id);
        e.dataTransfer.setData("text/plain", `@${node.name || node.type}`);
        e.dataTransfer.effectAllowed = "copy";
      });
      group.append(item);
      if (kids.length && open) {
        const g = h("div", { role: "group" });
        group.append(g);
        for (const c of [...kids].reverse()) row(c, depth + 1, g);
      }
    };
    for (const c of [...page.root.children].reverse()) row(c, 0, outline);
    if (n > MAX_OUTLINE) outline.append(h("div.of-vcv__more", t("Showing the first {n} layers.", { n: String(MAX_OUTLINE) })));
    const first = (focusId && outline.querySelector(`[data-id="${CSS.escape(focusId)}"]`)) || outline.querySelector(".selected") || outline.querySelector(".of-vcv__node");
    if (first) first.tabIndex = 0;
    if (focusId) first?.focus();
  }
  function toggleNode(node) {
    if (collapsed.has(node.id)) collapsed.delete(node.id);
    else collapsed.add(node.id);
    paintOutline();
  }
  function setFlag(node, key, value) {
    app.doc?.set(node, { [key]: value }, key === "visible" ? (value ? "Show Layer" : "Hide Layer") : value ? "Lock Layer" : "Unlock Layer");
  }
  function selectNode(node, add = false) {
    if (node._page && node._page !== app.page) app.setActivePage(node._page);
    app.select([node], { toggle: add });
  }
  outline.addEventListener("keydown", (e) => {
    const items = [...outline.querySelectorAll(".of-vcv__node")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const node = app.doc?.find(items[i].dataset.id);
    const go = (j) => {
      const x = items[Math.max(0, Math.min(items.length - 1, j))];
      items.forEach((it) => (it.tabIndex = -1));
      x.tabIndex = 0;
      x.focus();
    };
    const act = {
      ArrowDown: () => go(i + 1),
      ArrowUp: () => go(i - 1),
      Home: () => go(0),
      End: () => go(items.length - 1),
      ArrowRight: () => node?.children?.length && collapsed.has(node.id) && toggleNode(node),
      ArrowLeft: () => node?.children?.length && !collapsed.has(node.id) && toggleNode(node),
      Enter: () => node && selectNode(node),
      " ": () => node && selectNode(node, true),
      h: () => node && setFlag(node, "visible", node.visible === false),
      l: () => node && setFlag(node, "locked", !node.locked),
      a: () => node && vs.chat?.addLayer?.(node),
    }[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  });
  function toggleOutline() {
    showOutline = !showOutline;
    outlineBtn.setAttribute("aria-pressed", String(showOutline));
    paintOutline();
  }

  // ---- AI rings and "Touched by AI" chips (from the chat's last run with changes)
  function lastTouched() {
    const r = vs.changes?.lastRun(vs.hub.active?.id);
    if (!r || r.doc !== app.doc) return [];
    return r.set.layers.filter((c) => c.kind !== "removed");
  }
  let ringsFresh = false;
  function paintRings() {
    empty(rings);
    const list = lastTouched().slice(0, 80);
    for (const c of list) {
      const n = app.doc?.find(c.id);
      if (!n || n._page !== app.page) continue;
      const b = layerBounds(n);
      if (!b) continue;
      rings.append(h("div.of-vcv__ring", { class: ringsFresh ? "fresh" : "", title: c.name || c.type, style: { left: `${b.x}px`, top: `${b.y}px`, width: `${Math.max(1, b.w)}px`, height: `${Math.max(1, b.h)}px` } }));
    }
    for (const n of app.selection) {
      if (n._page !== app.page) continue;
      const b = layerBounds(n);
      if (b) rings.append(h("div.of-vcv__sel", { style: { left: `${b.x}px`, top: `${b.y}px`, width: `${Math.max(1, b.w)}px`, height: `${Math.max(1, b.h)}px` } }));
    }
    ringsFresh = false;
  }
  function paintTouched() {
    const list = lastTouched();
    empty(touched);
    touched.classList.toggle("hidden", !list.length);
    if (!list.length) return;
    touched.append(h("span.of-vcv__tlabel", iconEl("stars"), t("Touched by AI")));
    for (const c of list.slice(0, 12)) {
      touched.append(h("button.of-mchip.of-mchip--layer", { type: "button", role: "listitem", title: t("Select {name}", { name: c.name || c.type }), onclick: () => { const n = app.doc?.find(c.id); if (n) selectNode(n); } }, iconEl(layerIcon(c.type)), h("span", c.name || c.type)));
    }
    if (list.length > 12) touched.append(h("span.of-vcv__more", t("+{n} more", { n: String(list.length - 12) })));
    const r = vs.changes?.lastRun(vs.hub.active?.id);
    compareBtn.disabled = !r?.beforeThumb;
  }

  // ---- before / after slider
  async function compare(runId) {
    const r = runId ? vs.changes?.run(runId) : vs.changes?.lastRun(vs.hub.active?.id);
    if (!r?.beforeThumb) return app.toast(t("No before picture for this run (it did not change a design page)."), "warning", 2600);
    if (r.doc !== app.doc) app.activateDoc(r.doc);
    comparing = r.id;
    beforeImg.src = r.beforeThumb;
    paper.classList.add("comparing");
    slider.classList.remove("hidden");
    compareBtn.setAttribute("aria-pressed", "true");
    setClip();
  }
  function stopCompare() {
    comparing = null;
    paper.classList.remove("comparing");
    slider.classList.add("hidden");
    compareBtn.setAttribute("aria-pressed", "false");
  }
  const setClip = () => beforeImg.style.setProperty("clip-path", `inset(0 ${100 - Number(slider.value)}% 0 0)`);
  slider.addEventListener("input", setClip);
  slider.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ---- wiring
  for (const ev of ["docchange", "doc", "page"]) app.on(ev, () => visible() && scheduleRender());
  app.on("studio", () => visible() && scheduleRender());
  app.on("selection", () => {
    if (!visible()) return;
    paintRings();
    paintOutlineSoon();
  });
  const paintOutlineSoon = debounce(() => visible() && paintChrome(), 200);
  app.on("doc", () => stopCompare());
  vs.changes?.on("change", () => {
    ringsFresh = true;
    if (visible()) paintOutlineSoon();
  });
  session.on("event", (e) => e.type === "tool_end" && visible() && scheduleRender());

  const api = {
    el,
    show: () => {
      paintChrome();
      applyView();
      render();
    },
    compare,
  };
  vs.canvas = api;
  return api;
}
