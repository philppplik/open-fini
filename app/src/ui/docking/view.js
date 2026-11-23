// Docking renderer (ADR 0033, docs/workspaces.md): draws the layout of model.js into the three dock hosts created by
// ui/dock.js plus a layer of floating panels, and handles dragging (Pointer Events: mouse, pen and touch), splitters,
// the icon strip of a collapsed dock, the keyboard move mode, the Window menu and the workspace commands.
//
// Panel instances are created once (ui/panels/index.js registry) and only moved between containers, so a panel keeps
// its state (scroll position, inputs, listeners) when it is docked, tabbed, floated or collapsed.
import { h, downloadName } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { dockDef, dockKeyOf } from "../../studios/index.js";
import { PANELS } from "../panels/index.js";
import { iconEl } from "../toolbox.js";
import { markContext, openContextMenu } from "../context-menu/index.js";
import * as M from "./model.js";
import { baseLayout } from "./presets.js";
import { captureSheets, installSheetBridge, openPanelWindow, restyle, screenRectFor } from "./windows.js";

const VARS = { left: "--of-dockl-w", right: "--of-dock-w", bottom: "--of-dockb-h" };
const STRIP = { side: 40, bottom: 34 }; // collapsed dock (icon strip) size in px
const EDGE = 28; // px from the window edge that docks into a region while dragging
const FORMAT = "openfini-workspace";

export function createDocking(app, hosts) {
  const instances = new Map(); // panel id -> { el, show? }
  const floatLayer = h("div.of-dkfloats");
  const live = h("div.of-dklive", { role: "status", "aria-live": "polite" });
  const overlay = h("div.of-dkdrop", { "aria-hidden": "true" }, h("span.of-dkdrop__label"));
  hosts.layout.append(floatLayer, live, overlay);
  let L = M.emptyLayout();
  let suppressClick = false;
  let flyout = null;
  let busy = null; // an ongoing drag or keyboard move: { cancel() }
  const wins = new Map(); // "<layout key>|<group id>" -> open panel window (windows.js handle)
  const blocked = new Set(); // torn-off groups whose window could not open: shown floating in the app until reopened
  const visited = new Set(); // panel elements that were shown in a panel window (their shadow styles need a refresh back home)
  installSheetBridge();

  const cz = () => app.customize;
  const skey = () => dockKeyOf(app); // layout key: the studio, or "office:board" ... for apps with their own panels
  const title = (pid) => (PANELS[pid] ? t(PANELS[pid].title) : pid); // panel titles are English in the registry
  const studioPanels = () => {
    const s = dockDef(skey());
    return s ? [...new Set([...(s.top || []), ...(s.bottom || [])])].filter((id) => PANELS[id]) : [];
  };
  const state = () => cz()?.layout(skey()) || { hidden: [], side: "right", width: null };
  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
  const base = (st = state()) => baseLayout(skey(), dockDef(skey()), st);
  const visibleOf = (st) => studioPanels().filter((id) => !st.hidden.includes(id));

  function inst(pid) {
    if (!instances.has(pid)) {
      const def = PANELS[pid];
      instances.set(pid, def ? def.create(app) : { el: h("div", t("Missing panel")) });
    }
    return instances.get(pid);
  }

  // ------------------------------------------------------------------ state

  /** The layout to show for the current studio: the saved one (or the workspace preset), repaired and completed. */
  function compute() {
    const st = state();
    const b = base(st);
    const vis = visibleOf(st);
    return M.normalize(M.reconcile(st.dock || b, vis, b), { known: vis, viewport: viewport() }) || M.emptyLayout();
  }

  /** Saves a new layout. A layout equal to the workspace preset is stored as "no custom arrangement". */
  function commit(next, extra = {}) {
    const st = { ...state(), ...extra };
    const b = base(st);
    const plain = M.reconcile(b, visibleOf(st), b);
    L = next;
    if (!cz()) return draw();
    cz().setLayout(skey(), { ...st, dock: M.sameLayout(next, plain) ? undefined : M.serialize(next) }, { keepDock: true }); // emits "layout" -> render()
  }

  function render() {
    closeFlyout();
    const active = new Set();
    M.eachGroup(L, (g) => active.add(g.active));
    L = compute();
    // remember front tabs across re-renders (they are not stored while the layout equals the preset)
    M.eachGroup(L, (g) => {
      const a = g.panels.find((p) => active.has(p));
      if (a) g.active = a;
    });
    draw();
  }

  // ------------------------------------------------------------------ drawing

  function draw() {
    const max = L.maximized && M.findGroup(L, L.maximized);
    for (const r of M.REGIONS) {
      const host = hosts[r];
      const R = L.regions[r];
      const kids = [];
      let px = 0;
      if (R.root && R.collapsed) {
        kids.push(strip(r));
        px = r === "bottom" ? STRIP.bottom : STRIP.side;
      } else if (R.root) {
        kids.push(max?.region === r ? groupEl(max.group, { region: r }) : nodeEl(R.root, r, []), regionSash(r));
        px = R.size;
      }
      host.replaceChildren(...kids);
      host.classList.toggle(r === "right" ? "of-dock--empty" : "of-dockhost--empty", !R.root);
      host.classList.toggle("is-collapsed", !!R.root && R.collapsed);
      hosts.layout.style.setProperty(VARS[r], `${px}px`);
    }
    syncWindows();
    floatLayer.replaceChildren(...L.floating.filter((f) => !f.win || !wins.has(wkey(f.group.id))).map(floatEl));
    M.eachGroup(L, (g, info) => {
      if (info.region && L.regions[info.region].collapsed) return;
      if (max && info.region === max.region && g.id !== max.group.id) return;
      const it = instances.get(g.active);
      comeHome(it?.el);
      it?.show?.();
    });
  }

  /** A panel element back from a panel window: its shadow roots get the main document's style sheets again. */
  function comeHome(el) {
    if (!el || !visited.has(el) || el.ownerDocument !== document) return;
    visited.delete(el);
    restyle(el);
  }

  // ------------------------------------------------------------------ torn-off windows (windows.js)

  const wkey = (gid) => `${skey()}|${gid}`;

  /** Opens, fills and closes panel windows so that they match the torn-off groups of the layout. */
  function syncWindows() {
    const want = new Map(M.windowGroups(L).map((f) => [wkey(f.group.id), f]));
    for (const [k, w] of wins) {
      if (want.has(k) && !w.closed) continue;
      wins.delete(k);
      w.close(); // the group went elsewhere (docked back, another studio or workspace): no "closed by the user"
      if (want.has(k)) {
        // closed by the user a moment ago, before the window reported it: dock it back instead of opening it again
        const gid = want.get(k).group.id;
        want.delete(k);
        setTimeout(() => dockBack(gid), 0);
      }
    }
    for (const k of blocked) if (!want.has(k)) blocked.delete(k);
    for (const [k, f] of want) {
      let w = wins.get(k);
      if (!w && !blocked.has(k)) {
        const gid = f.group.id;
        w = openPanelWindow({
          name: `openfini-panel-${k.replace(/[^\w-]/g, "-")}`,
          rect: f,
          title: title(f.group.active),
          onClose: () => wins.get(k) === w && (wins.delete(k), commit(M.dockBack(L, gid, base()))),
          onRect: (r) => wins.get(k) === w && commit(M.setFloatRect(L, gid, r)),
          onKey: (e) => app.handleShortcut?.(e),
        });
        if (w) wins.set(k, w);
        else blocked.add(k);
      }
      if (w) fillWindow(w, f.group);
    }
  }

  function fillWindow(w, g) {
    const node = groupEl(g, { region: null, win: true });
    captureSheets(node); // before the move: shadow roots made before the sheet bridge keep their sheets
    w.body.replaceChildren(node);
    restyle(node);
    visited.add(inst(g.active).el);
    w.setTitle(`${title(g.active)} – OpenFini`);
  }

  /** Tears a panel ({ pid }) or group ({ gid }) off into its own window; in the browser, inside the click. */
  function tear(src, rect) {
    const next = M.tearOff(L, src, rect);
    if (next === L) return;
    commit(next);
    const gid = src.gid || M.findPanel(L, src.pid)?.group.id;
    if (gid && blocked.has(wkey(gid))) app.toast(t("Your browser blocked the new window. Allow pop-ups for this site and try again."), "warning", 6000);
  }

  /** A blocked or restored torn-off group shown in the app: try its window again (inside the click). */
  function reopenWindow(gid) {
    blocked.delete(wkey(gid));
    draw();
    if (blocked.has(wkey(gid))) app.toast(t("Your browser blocked the new window. Allow pop-ups for this site and try again."), "warning", 6000);
  }

  const dockBack = (gid) => commit(M.dockBack(L, gid, base()));
  /** The window rectangle for tearing off what is shown at the group element of `pid` / `gid`. */
  function tearRect(src) {
    const gid = src.gid || M.findPanel(L, src.pid)?.group.id;
    const el = gid && hosts.layout.querySelector(`.of-dkgroup[data-group="${CSS.escape(gid)}"]`);
    return screenRectFor(el ? el.getBoundingClientRect() : { left: 120, top: 120, width: 300, height: 420 });
  }

  function nodeEl(node, region, path) {
    if (node.type === "group") return groupEl(node, { region, path });
    const el = h(`div.of-dksplit.of-dksplit--${node.dir}`);
    node.children.forEach((c, i) => {
      if (i) el.append(splitSash(node, region, path, i, el));
      const k = nodeEl(c, region, [...path, i]);
      k.style.flex = `${node.sizes[i]} 1 0`;
      el.append(k);
    });
    return el;
  }

  /** A tab group. ctx = { region, path } docked, { region: null } floating, plus win (in a panel window) or pending. */
  function groupEl(g, ctx) {
    const bodyId = `of-dkpanel-${g.id}`;
    const tabs = h("div.of-dkgroup__tablist", { role: "tablist", "aria-label": t("Panels") });
    for (const pid of g.panels) {
      const def = PANELS[pid];
      const on = pid === g.active;
      const b = h("button.of-dock__tab", { type: "button", role: "tab", id: `of-dktab-${pid}`, class: on ? "active" : "", "aria-selected": String(on), "aria-controls": bodyId, tabindex: on ? "0" : "-1", "data-tip": title(pid), "aria-label": title(pid), "data-panel": pid }, iconEl(def.icon), h("span", title(pid)));
      markContext(b, "panel-header", { id: pid, title: title(pid) });
      b.addEventListener("click", () => {
        if (!suppressClick && !on) select(pid);
      });
      if (!ctx.win) b.addEventListener("pointerdown", (e) => startDrag({ pid }, e, b));
      b.addEventListener("keydown", (e) => tabKey(e, g, pid, ctx));
      tabs.append(b);
    }
    const grip = h("div.of-dkgroup__grip", { "aria-hidden": "true" });
    if (!ctx.win) grip.addEventListener("pointerdown", (e) => startDrag({ gid: g.id }, e, grip));
    grip.addEventListener("dblclick", () => ctx.region && commit(M.setCollapsed(L, ctx.region, true)));
    tabs.append(grip); // the empty end of the tab row drags the whole group
    const tools = [];
    const btn = (icon, label, run) => {
      const b = h("button.of-dkgroup__menu", { type: "button", "aria-label": label, "data-tip": label, title: label }, iconEl(icon));
      b.addEventListener("click", run);
      return b;
    };
    // a panel window has no menus of its own (they would open in the main window): one button docks it back
    if (ctx.win) tools.push(btn("box-arrow-in-down-left", t("Dock Back"), () => dockBack(g.id)));
    else {
      if (ctx.pending) tools.push(btn("box-arrow-up-right", t("Open in Window"), () => reopenWindow(g.id)));
      const more = btn("three-dots", t("Panel options"), () => {
        const r = more.getBoundingClientRect();
        openContextMenu(app, { kind: "panel-header", x: r.left, y: r.bottom, data: { id: g.active, title: title(g.active) } });
      });
      more.setAttribute("aria-haspopup", "menu");
      more.removeAttribute("title");
      tools.push(more);
    }
    const body = h("div.of-dock__body", { role: "tabpanel", id: bodyId, "aria-labelledby": `of-dktab-${g.active}` }, inst(g.active).el);
    return h("section.of-dock__area.of-dkgroup", { "data-group": g.id, class: `${L.maximized === g.id ? "is-max" : ""}${ctx.win ? " is-win" : ""}` }, h("div.of-dock__tabs", tabs, ...tools), body);
  }

  function select(pid) {
    commit(M.setActive(L, pid));
    const sel = `#of-dktab-${CSS.escape(pid)}`;
    (hosts.layout.querySelector(sel) || [...wins.values()].map((w) => w.doc.querySelector(sel)).find(Boolean))?.focus();
  }

  function tabKey(e, g, pid, ctx = {}) {
    const i = g.panels.indexOf(pid);
    const n = g.panels.length;
    const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j !== undefined && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      select(g.panels[j]);
    } else if (e.key.toLowerCase() === "m" && e.ctrlKey && e.shiftKey && !ctx.win) {
      e.preventDefault();
      e.stopPropagation();
      keyMove({ pid });
    }
  }

  // splitter between two children of a split
  function splitSash(node, region, path, i, parent) {
    const col = node.dir === "column";
    const s = h(col ? "div.of-dock__split.of-dksash" : "div.of-dksash.of-dksash--v", { role: "separator", tabindex: "0", "aria-orientation": col ? "horizontal" : "vertical", "aria-label": t("Resize panels"), "aria-valuemin": "5", "aria-valuemax": "95", "aria-valuenow": String(Math.round(node.sizes[i - 1] * 100)) });
    const sizes = node.sizes.slice();
    const kids = () => [...parent.children].filter((c) => !c.classList.contains("of-dksash"));
    const show = () => kids().forEach((k, j) => (k.style.flex = `${sizes[j]} 1 0`));
    const pair = sizes[i - 1] + sizes[i];
    const setFirst = (a) => {
      const min = M.LIMITS.minFraction;
      sizes[i - 1] = Math.min(pair - min, Math.max(min, a));
      sizes[i] = pair - sizes[i - 1];
      s.setAttribute("aria-valuenow", String(Math.round(sizes[i - 1] * 100)));
      show();
    };
    s.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture?.(e.pointerId);
      const r = parent.getBoundingClientRect();
      const len = col ? r.height : r.width;
      const before = sizes.slice(0, i - 1).reduce((a, b) => a + b, 0);
      const mv = (ev) => setFirst(((col ? ev.clientY - r.top : ev.clientX - r.left) / len) - before);
      const up = () => {
        s.removeEventListener("pointermove", mv);
        s.removeEventListener("pointerup", up);
        s.removeEventListener("pointercancel", up);
        commit(M.setSizes(L, region, path, sizes));
      };
      s.addEventListener("pointermove", mv);
      s.addEventListener("pointerup", up);
      s.addEventListener("pointercancel", up);
    });
    s.addEventListener("keydown", (e) => {
      const d = { ArrowUp: -0.02, ArrowLeft: -0.02, ArrowDown: 0.02, ArrowRight: 0.02 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      setFirst(sizes[i - 1] + d);
      commit(M.setSizes(L, region, path, sizes));
      focusSash(region, path, i);
    });
    s.dataset.sash = `${region}:${path.join(".")}:${i}`;
    return s;
  }
  const focusSash = (region, path, i) => hosts.layout.querySelector(`[data-sash="${region}:${path.join(".")}:${i}"]`)?.focus();

  // the inner edge of a dock region resizes the whole region
  function regionSash(r) {
    const R = L.regions[r];
    const v = r === "bottom";
    const s = h(`div.of-dkedge.of-dkedge--${r}`, { role: "separator", tabindex: "0", "aria-orientation": v ? "horizontal" : "vertical", "aria-label": t("Resize the dock"), "aria-valuenow": String(R.size) });
    let px = R.size;
    const setPx = (n) => {
      const lim = v ? M.LIMITS.bottom : M.LIMITS.side;
      px = Math.round(Math.min(lim.max, Math.max(lim.min, n)));
      hosts.layout.style.setProperty(VARS[r], `${px}px`);
      s.setAttribute("aria-valuenow", String(px));
    };
    s.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture?.(e.pointerId);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const mv = (ev) => setPx(R.size + (r === "left" ? ev.clientX - x0 : r === "right" ? x0 - ev.clientX : y0 - ev.clientY));
      const up = () => {
        s.removeEventListener("pointermove", mv);
        s.removeEventListener("pointerup", up);
        s.removeEventListener("pointercancel", up);
        commit(M.setRegionSize(L, r, px));
      };
      s.addEventListener("pointermove", mv);
      s.addEventListener("pointerup", up);
      s.addEventListener("pointercancel", up);
    });
    s.addEventListener("keydown", (e) => {
      const grow = { left: "ArrowRight", right: "ArrowLeft", bottom: "ArrowUp" }[r];
      const shrink = { left: "ArrowLeft", right: "ArrowRight", bottom: "ArrowDown" }[r];
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      setPx(px + (e.key === grow ? 16 : -16));
      commit(M.setRegionSize(L, r, px));
      hosts.layout.querySelector(`.of-dkedge--${r}`)?.focus();
    });
    return s;
  }

  // ------------------------------------------------------------------ collapsed docks (icon strip + flyout)

  function strip(r) {
    const el = h(`div.of-dkstrip.of-dkstrip--${r}`, { role: "toolbar", "aria-label": t("Collapsed panels"), "aria-orientation": r === "bottom" ? "horizontal" : "vertical", "data-region": r });
    const expand = h("button.of-dkstrip__btn.of-dkstrip__expand", { type: "button", "aria-label": t("Expand panels"), "data-tip": t("Expand panels") }, iconEl(r === "left" ? "chevron-double-right" : r === "right" ? "chevron-double-left" : "chevron-bar-contract"));
    expand.addEventListener("click", () => commit(M.setCollapsed(L, r, false)));
    el.append(expand);
    M.eachGroup(L, (g, info) => {
      if (info.region !== r) return;
      for (const pid of g.panels) {
        const b = h("button.of-dkstrip__btn", { type: "button", "aria-label": title(pid), "data-tip": title(pid), "aria-expanded": "false", "data-panel": pid }, iconEl(PANELS[pid].icon));
        b.addEventListener("click", () => (flyout?.pid === pid ? closeFlyout() : openFlyout(pid, b, r)));
        el.append(b);
      }
    });
    el.addEventListener("keydown", (e) => {
      const btns = [...el.querySelectorAll("button")];
      const i = btns.indexOf(document.activeElement);
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (d && i >= 0) {
        e.preventDefault();
        btns[(i + d + btns.length) % btns.length].focus();
      }
    });
    return el;
  }

  function openFlyout(pid, btn, r) {
    closeFlyout();
    const close = h("button.of-ibtn", { type: "button", "aria-label": t("Close") }, iconEl("x-lg"));
    const box = h("div.of-dkflyout", { role: "dialog", "aria-label": title(pid), tabindex: "-1" }, h("div.of-dkflyout__head", iconEl(PANELS[pid].icon), h("span", title(pid)), close), h("div.of-dock__body", inst(pid).el));
    const hr = hosts[r].getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    const ht = Math.min(520, window.innerHeight - 80);
    if (r === "bottom") Object.assign(box.style, { left: `${Math.max(8, Math.min(br.left, window.innerWidth - w - 8))}px`, top: `${Math.max(8, hr.top - ht - 4)}px` });
    else Object.assign(box.style, { left: `${r === "left" ? hr.right + 4 : hr.left - w - 4}px`, top: `${Math.max(8, Math.min(br.top, window.innerHeight - ht - 8))}px` });
    Object.assign(box.style, { width: `${w}px`, height: `${ht}px` });
    hosts.layout.append(box);
    btn.setAttribute("aria-expanded", "true");
    comeHome(inst(pid).el);
    inst(pid).show?.();
    const outside = (e) => !box.contains(e.target) && !btn.contains(e.target) && closeFlyout();
    const esc = (e) => e.key === "Escape" && (e.stopPropagation(), closeFlyout(true));
    document.addEventListener("pointerdown", outside, true);
    box.addEventListener("keydown", esc);
    close.addEventListener("click", () => closeFlyout(true));
    flyout = { pid, box, btn, off: () => document.removeEventListener("pointerdown", outside, true) };
    (box.querySelector("input, button:not(.of-ibtn), [tabindex='0'], select, textarea") || box).focus();
  }

  function closeFlyout(refocus = false) {
    if (!flyout) return;
    const f = flyout;
    flyout = null;
    f.off();
    f.box.remove();
    f.btn.setAttribute("aria-expanded", "false");
    if (refocus) f.btn.focus();
  }

  // ------------------------------------------------------------------ floating groups

  // A torn-off group whose window is not open (the browser blocked it, for example after a reload) is shown floating in
  // the app at the matching place; moving or resizing it makes it an ordinary floating group.
  const shownRect = (f) => (f.win ? M.clampRect({ x: f.x - window.screenX, y: f.y - window.screenY, w: f.w, h: f.h }, window.innerWidth, window.innerHeight) : f);
  function placeFloat(gid, rect) {
    const f = L.floating.find((x) => x.group.id === gid);
    return M.raiseFloat(f?.win ? M.moveGroup(L, gid, { float: M.clampRect(rect, window.innerWidth, window.innerHeight) }) : M.setFloatRect(L, gid, rect, viewport()), gid);
  }

  function floatEl(f0) {
    const f = { ...f0, ...shownRect(f0) };
    const grip = h("div.of-dkfloat__resize", { "aria-hidden": "true" });
    const el = h("div.of-dkfloat", { role: "dialog", "aria-label": title(f.group.active), "data-group": f.group.id, class: f.win ? "is-pending" : "" }, groupEl(f.group, { region: null, pending: !!f.win }), grip);
    Object.assign(el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    el.addEventListener("pointerdown", () => floatLayer.lastChild !== el && floatLayer.append(el), true); // bring to front
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture?.(e.pointerId);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const mv = (ev) => Object.assign(el.style, { width: `${Math.max(M.LIMITS.float.minW, f.w + ev.clientX - x0)}px`, height: `${Math.max(M.LIMITS.float.minH, f.h + ev.clientY - y0)}px` });
      const up = () => {
        grip.removeEventListener("pointermove", mv);
        grip.removeEventListener("pointerup", up);
        commit(placeFloat(f.group.id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
      };
      grip.addEventListener("pointermove", mv);
      grip.addEventListener("pointerup", up);
    });
    return el;
  }

  const defaultFloat = (w = 280, h = 360) => {
    const c = hosts.layout.querySelector(".of-canvasarea")?.getBoundingClientRect() || { left: 80, top: 80, width: 800, height: 600 };
    return M.clampRect({ x: c.left + c.width / 2 - w / 2 + 24 * L.floating.length, y: c.top + 40 + 24 * L.floating.length, w, h }, window.innerWidth, window.innerHeight);
  };

  // ------------------------------------------------------------------ dragging

  /** src = { pid } (a tab) or { gid } (a whole group, dragged by the empty part of its tab strip). */
  function startDrag(src, e, handle) {
    if (e.button !== 0 || busy) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const gEl = handle.closest(".of-dkgroup");
    const from = gEl.getBoundingClientRect();
    const fEl = src.gid ? handle.closest(".of-dkfloat") : null; // moving a floating group by its header
    const f0 = fEl ? { x: fEl.offsetLeft, y: fEl.offsetTop } : null;
    let ghost = null;
    let hit = null;
    let active = false;
    handle.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        active = true;
        ghost = h("div.of-dkghost", { "aria-hidden": "true" }, src.pid ? title(src.pid) : gEl.querySelector(".of-dock__tab.active span")?.textContent || "");
        hosts.layout.append(ghost);
        document.documentElement.classList.add("of-dk-dragging");
      }
      if (fEl) Object.assign(fEl.style, { left: `${f0.x + ev.clientX - x0}px`, top: `${f0.y + ev.clientY - y0}px` });
      Object.assign(ghost.style, { left: `${ev.clientX + 14}px`, top: `${ev.clientY + 10}px` });
      // dropped outside the app window: the panel tears off into a window of its own at that place on the screen
      const outside = ev.clientX < 0 || ev.clientY < 0 || ev.clientX >= window.innerWidth || ev.clientY >= window.innerHeight;
      if (outside) hit = { target: { window: { x: ev.screenX - 40, y: ev.screenY - 14, w: Math.max(260, from.width), h: Math.max(320, from.height) } }, label: t("Open in Window") };
      else hit = hitTest(ev.clientX, ev.clientY, src, gEl.dataset.group, fEl);
      if (!hit && !fEl) hit = { target: { float: M.clampRect({ x: ev.clientX - 40, y: ev.clientY - 14, w: Math.max(240, from.width), h: Math.min(Math.max(260, from.height), 480) }, window.innerWidth, window.innerHeight) }, label: t("Float") };
      ghost.textContent = hit?.target.window ? hit.label : src.pid ? title(src.pid) : gEl.querySelector(".of-dock__tab.active span")?.textContent || "";
      showTarget(hit && hit.target.float ? { ...hit, rect: { x: hit.target.float.x, y: hit.target.float.y, w: hit.target.float.w, h: hit.target.float.h } } : hit);
    };
    const finish = (ok) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      busy = null;
      ghost?.remove();
      showTarget(null);
      document.documentElement.classList.remove("of-dk-dragging");
      if (!active) return;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (!ok) return render();
      if (hit) apply(src, hit.target);
      else if (fEl) commit(placeFloat(src.gid, { x: fEl.offsetLeft, y: fEl.offsetTop, w: fEl.offsetWidth, h: fEl.offsetHeight }));
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    busy = { cancel: onCancel };
  }

  function apply(src, target) {
    if (!target) return;
    if (target.window) return tear(src, target.window);
    if (target.float) target = { float: M.clampRect(target.float, window.innerWidth, window.innerHeight) };
    commit(src.pid ? M.movePanel(L, src.pid, target) : M.moveGroup(L, src.gid, target));
  }

  /** The working area between the context bar and the status bar (window edges dock into the regions). */
  function workArea() {
    const lay = hosts.layout.getBoundingClientRect();
    const canvas = hosts.layout.querySelector(".of-canvasarea").getBoundingClientRect();
    const status = hosts.layout.querySelector(".of-status")?.getBoundingClientRect();
    return { left: lay.left, right: lay.right, top: canvas.top, bottom: status ? status.top : lay.bottom, canvas };
  }

  function edgeTargets() {
    const a = workArea();
    const hgt = a.bottom - a.top;
    return [
      { target: { region: "left", edge: "outer" }, rect: { x: a.left, y: a.top, w: 120, h: hgt }, label: t("Dock at the left edge") },
      { target: { region: "right", edge: "outer" }, rect: { x: a.right - 120, y: a.top, w: 120, h: hgt }, label: t("Dock at the right edge") },
      { target: { region: "bottom", edge: "outer" }, rect: { x: a.canvas.left, y: a.bottom - 110, w: a.canvas.width, h: 110 }, label: t("Dock at the bottom edge") },
    ];
  }

  const ZONES = () => ({ center: t("Add as a tab"), left: t("Dock to the left"), right: t("Dock to the right"), top: t("Dock above"), bottom: t("Dock below") });
  function zoneRect(r, zone) {
    const x = r.left ?? r.x;
    const y = r.top ?? r.y;
    const w = r.width ?? r.w;
    const hh = r.height ?? r.h;
    if (zone === "left") return { x, y, w: w / 2, h: hh };
    if (zone === "right") return { x: x + w / 2, y, w: w / 2, h: hh };
    if (zone === "top") return { x, y, w, h: hh / 2 };
    if (zone === "bottom") return { x, y: y + hh / 2, w, h: hh / 2 };
    return { x, y, w, h: hh };
  }

  function hitTest(x, y, src, srcGid, fEl) {
    const a = workArea();
    if (y >= a.top && y <= a.bottom) {
      const [left, right, bottom] = edgeTargets();
      if (x - a.left < EDGE) return left;
      if (a.right - x < EDGE) return right;
      if (a.bottom - y < EDGE && x > a.canvas.left && x < a.canvas.right) return bottom;
    }
    for (const el of document.elementsFromPoint(x, y)) {
      if (fEl?.contains(el)) continue;
      const strp = el.closest?.(".of-dkstrip");
      if (strp) return { target: { region: strp.dataset.region, edge: "stack" }, rect: rectOf(strp), label: t("Add to the collapsed dock") };
      const gEl = el.closest?.(".of-dkgroup");
      if (!gEl) continue;
      const gid = gEl.dataset.group;
      const g = M.findGroup(L, gid)?.group;
      if (!g || gid === src.gid || (src.pid && gid === srcGid && g.panels.length === 1)) return null;
      const r = gEl.getBoundingClientRect();
      const tr = gEl.querySelector(".of-dock__tabs").getBoundingClientRect();
      const floating = !!gEl.closest(".of-dkfloat");
      if (y <= tr.bottom || floating) {
        const tabs = [...gEl.querySelectorAll(".of-dock__tab")];
        const index = tabs.filter((b) => {
          const br = b.getBoundingClientRect();
          return br.left + br.width / 2 < x;
        }).length;
        return { target: { group: gid, zone: "center", index }, rect: zoneRect(r, "center"), label: ZONES().center };
      }
      const fx = (x - r.left) / r.width;
      const fy = (y - r.top) / r.height;
      let zone = "center";
      if (!(fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7)) zone = Object.entries({ left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }).sort((p, q) => p[1] - q[1])[0][0];
      return { target: { group: gid, zone }, rect: zoneRect(r, zone), label: ZONES()[zone] };
    }
    return null;
  }

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  function showTarget(hit) {
    overlay.classList.toggle("is-on", !!hit?.rect);
    if (!hit?.rect) return;
    Object.assign(overlay.style, { left: `${hit.rect.x}px`, top: `${hit.rect.y}px`, width: `${hit.rect.w}px`, height: `${hit.rect.h}px` });
    overlay.firstChild.textContent = hit.label;
  }

  // ------------------------------------------------------------------ keyboard move mode

  /** Every place `src` could go, in reading order, with the rectangle to highlight. */
  function candidates(src) {
    const srcGid = src.gid || M.findPanel(L, src.pid)?.group.id;
    const out = [];
    for (const gEl of hosts.layout.querySelectorAll(".of-dkgroup")) {
      const gid = gEl.dataset.group;
      const g = M.findGroup(L, gid);
      if (!g || gid === src.gid || (src.pid && gid === srcGid && g.group.panels.length === 1)) continue;
      const name = g.group.panels.map(title).join(", ");
      const r = gEl.getBoundingClientRect();
      for (const zone of g.region ? ["center", "left", "right", "top", "bottom"] : ["center"]) {
        if (zone === "center" && gid === srcGid) continue;
        out.push({ target: { group: gid, zone }, rect: zoneRect(r, zone), label: `${name}: ${ZONES()[zone]}` });
      }
    }
    out.push(...edgeTargets());
    const f = defaultFloat();
    out.push({ target: { float: f }, rect: f, label: t("Float") });
    out.push({ target: { window: tearRect(src) }, label: t("Open in Window") });
    return out;
  }

  function keyMove(src) {
    if (busy) return;
    const list = candidates(src);
    let i = 0;
    const say = () => {
      showTarget(list[i]);
      live.textContent = `${list[i].label}. ${t("Arrow keys choose a place, Enter moves the panel, Escape cancels.")}`;
    };
    const done = (ok) => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      busy = null;
      showTarget(null);
      if (!ok) return (live.textContent = t("Move canceled."));
      apply(src, list[i].target);
      live.textContent = t("Panel moved.");
      const pid = src.pid || M.findGroup(L, src.gid)?.group.active;
      if (pid) hosts.layout.querySelector(`#of-dktab-${CSS.escape(pid)}`)?.focus();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (["ArrowDown", "ArrowRight"].includes(e.key) || (e.key === "Tab" && !e.shiftKey)) i = (i + 1) % list.length;
      else if (["ArrowUp", "ArrowLeft"].includes(e.key) || e.key === "Tab") i = (i - 1 + list.length) % list.length;
      else if (e.key === "Enter" || e.key === " ") return done(true);
      else if (e.key === "Escape") return done(false);
      say();
    };
    const onPointer = () => done(false);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    busy = { cancel: () => done(false) };
    say();
  }

  // ------------------------------------------------------------------ panel commands

  function close(pid) {
    const st = state();
    commit(M.removePanel(L, pid), { hidden: [...new Set([...st.hidden, pid])] });
  }

  function reveal(pid) {
    if (!studioPanels().includes(pid)) return;
    const st = state();
    const hidden = st.hidden.filter((x) => x !== pid);
    let next = L;
    if (!M.findPanel(next, pid)) next = M.reconcile(next, [...M.panelIds(next), pid], base(st));
    next = M.setActive(next, pid);
    const hit = M.findPanel(next, pid);
    if (hit?.region && next.regions[hit.region].collapsed) next = M.setCollapsed(next, hit.region, false);
    if (next.maximized && next.maximized !== hit?.group.id) next = M.setMaximized(next, null);
    commit(next, { hidden });
    if (hit?.win) wins.get(wkey(hit.group.id))?.focus();
  }

  function panelMenu(pid) {
    if (!PANELS[pid] || !M.findPanel(L, pid)) return [];
    const hit = M.findPanel(L, pid);
    const src = { pid };
    const win = hit.win;
    const lone = hit.floatIndex >= 0 && hit.group.panels.length === 1 && !win;
    const items = [
      { label: t("Move Panel…"), icon: "keyboard", title: t("Choose a place with the arrow keys (Ctrl+Shift+M on a panel tab)"), run: () => keyMove(src) },
      { label: t("Dock Left"), icon: "layout-sidebar-inset", run: () => apply(src, { region: "left", edge: "outer" }) },
      { label: t("Dock Right"), icon: "layout-sidebar-inset-reverse", run: () => apply(src, { region: "right", edge: "outer" }) },
      { label: t("Dock Bottom"), icon: "window-dock", run: () => apply(src, { region: "bottom", edge: "outer" }) },
      { label: t("Float"), icon: "window-stack", disabled: lone, run: () => apply(src, { float: defaultFloat() }) },
      win
        ? { label: t("Dock Back"), icon: "box-arrow-in-down-left", title: t("Put the panels of this window back where the workspace keeps them"), run: () => dockBack(hit.group.id) }
        : { label: t("Open in Window"), icon: "box-arrow-up-right", title: t("Tear the panel off into a window of its own (or drag its tab out of the app window)"), run: () => tear(src, tearRect(src)) },
      "-",
    ];
    if (hit.region) {
      const max = L.maximized === hit.group.id;
      items.push({ label: max ? t("Restore Group") : t("Maximize Group"), icon: max ? "arrows-angle-contract" : "arrows-expand", run: () => commit(M.setMaximized(L, max ? null : hit.group.id)) });
      items.push({ label: t("Collapse to Icons"), icon: "chevron-bar-contract", run: () => commit(M.setCollapsed(L, hit.region, true)) });
    }
    items.push({ label: t("Close {panel}", { panel: title(pid) }), icon: "x-lg", run: () => close(pid) }, "-", { label: t("Reset Workspace"), icon: "arrow-counterclockwise", run: reset });
    return items;
  }

  /** Window menu: one checkable entry per panel of the studio, then the dock regions. */
  function panelItems() {
    const ids = studioPanels();
    if (!ids.length) return [];
    const open = new Set(M.panelIds(L));
    const items = ids.map((pid) => ({ label: title(pid), checked: open.has(pid), run: () => (open.has(pid) ? close(pid) : reveal(pid)) }));
    const names = { left: [t("Collapse Left Dock to Icons"), t("Expand Left Dock")], right: [t("Collapse Right Dock to Icons"), t("Expand Right Dock")], bottom: [t("Collapse Bottom Dock to Icons"), t("Expand Bottom Dock")] };
    const regs = M.REGIONS.filter((r) => L.regions[r].root);
    if (regs.length) items.push("-");
    for (const r of regs) {
      const c = L.regions[r].collapsed;
      items.push({ label: names[r][c ? 1 : 0], run: () => commit(M.setCollapsed(L, r, !c)) });
    }
    if (L.maximized) items.push({ label: t("Restore Group"), run: () => commit(M.setMaximized(L, null)) });
    const torn = M.windowGroups(L);
    if (torn.length) items.push("-", { label: t("Dock Back All Windows"), icon: "box-arrow-in-down-left", run: () => commit(torn.reduce((acc, f) => M.dockBack(acc, f.group.id, base()), L)) });
    return items;
  }

  // ------------------------------------------------------------------ workspaces

  function reset() {
    const c = cz();
    if (!c) return;
    const name = c.activeWorkspace(skey()) || c.baseWorkspace(skey());
    if (name && c.applyWorkspace(skey(), name)) return;
    c.resetLayout(skey());
  }

  async function ask(opts) {
    const { promptDialog } = await import("../dialogs.js");
    return promptDialog(opts);
  }

  function workspaceItems() {
    const c = cz();
    if (!c || !studioPanels().length) return [];
    const s = skey();
    const list = c.workspaces(s);
    const cur = c.activeWorkspace(s) || c.baseWorkspace(s);
    const user = list.find((w) => w.name === cur && !w.builtin);
    return [
      ...list.map((w) => ({ label: w.name, checked: w.name === cur, run: () => c.applyWorkspace(s, w.name) })),
      "-",
      { label: t("Save as New Workspace…"), icon: "save", run: saveAs },
      { label: t("Rename Workspace…"), icon: "pencil", disabled: !user, run: () => rename(cur) },
      { label: t("Delete Workspace…"), icon: "trash", disabled: !user, run: () => remove(cur) },
      { label: cur ? t("Reset {name}", { name: cur }) : t("Reset Workspace"), icon: "arrow-counterclockwise", run: reset },
      { label: t("Reset All Workspaces…"), run: resetAll },
      "-",
      { label: t("Export Workspace…"), icon: "download", run: exportWs },
      { label: t("Import Workspace…"), icon: "upload", run: importWs },
    ];
  }

  async function saveAs() {
    const name = await ask({ title: t("Save as New Workspace"), label: t("Workspace name"), ok: t("Save") });
    if (name == null) return;
    const n = cz().saveWorkspace(skey(), name);
    app.toast(n ? t("Workspace “{name}” saved.", { name: n }) : t("Enter a name for the workspace (at most 24 workspaces per studio)."), n ? "success" : "warning", 2200);
  }

  async function rename(from) {
    const name = await ask({ title: t("Rename Workspace"), label: t("Workspace name"), value: from, ok: t("Rename") });
    if (name == null) return;
    if (!cz().renameWorkspace(skey(), from, name)) app.toast(t("That name is empty or already used."), "warning", 2200);
  }

  async function remove(name) {
    const { confirmDialog } = await import("../dialogs.js");
    if (await confirmDialog({ title: t("Delete Workspace"), message: t("Delete the workspace “{name}”? The current layout stays as it is.", { name }), ok: t("Delete"), danger: true })) cz().deleteWorkspace(skey(), name);
  }

  async function resetAll() {
    const { confirmDialog } = await import("../dialogs.js");
    if (await confirmDialog({ title: t("Reset All Workspaces"), message: t("Put the panels of every studio back where the workspace presets keep them? Your saved workspaces are kept."), ok: t("Reset") })) cz().resetLayout();
  }

  async function exportWs() {
    const c = cz();
    const name = c.activeWorkspace(skey()) || c.baseWorkspace(skey()) || dockDef(skey())?.label;
    const data = { format: FORMAT, version: 1, studio: skey(), name, state: { ...c.layout(skey()), dock: M.serialize(L) } };
    const { platform } = await import("../../platform/index.js");
    try {
      await platform.saveFile({ suggestedName: downloadName(`${name} workspace`, "json"), bytes: new TextEncoder().encode(JSON.stringify(data, null, 2)), mime: "application/json", filters: [{ name: t("OpenFini workspace"), extensions: ["json"] }] });
    } catch (err) {
      app.toast(err.message, "danger", 5000);
    }
  }

  async function importWs() {
    const { platform } = await import("../../platform/index.js");
    const [file] = await platform.openFiles({ accept: [{ name: t("OpenFini workspace"), extensions: ["json"] }] });
    if (!file) return;
    const res = parseWorkspace(new TextDecoder().decode(file.bytes), skey(), studioPanels());
    if (res.error) return app.toast(res.error, "danger", 5000);
    const c = cz();
    let name = res.name;
    for (let i = 2; c.workspaces(skey()).some((w) => w.name === name); i++) name = `${res.name} ${i}`.slice(0, 40);
    const n = c.saveWorkspace(skey(), name, res.state);
    if (!n) return app.toast(t("This studio already has 24 saved workspaces."), "warning", 3000);
    c.applyWorkspace(skey(), n);
    app.toast(t("Workspace “{name}” imported.", { name: n }), "success", 2200);
  }

  // ------------------------------------------------------------------ wiring

  const onResize = () => {
    if (!L.floating.length) return;
    const next = M.normalize(L, { viewport: viewport() });
    if (next && !M.sameLayout(next, L)) {
      L = next;
      draw();
    }
  };
  window.addEventListener("resize", onResize);
  app.on("studio", () => (busy?.cancel(), render()));
  app.on("officekind", () => (busy?.cancel(), render()));
  app.on("layout", render);
  render();

  /** True while the panel is shown in a dock or floating window (not closed). */
  const isOpen = (pid) => !!M.findPanel(L, pid);
  /** Collapses (true), expands (false) or toggles a dock region to its icon strip. */
  function toggleRegion(r, collapsed) {
    const R = L.regions[r];
    if (R?.root) commit(M.setCollapsed(L, r, collapsed ?? !R.collapsed));
  }

  return { render, reveal, close, isOpen, toggleRegion, reset, panelMenu, panelItems, workspaceItems, keyMove: (pid) => keyMove({ pid }), get layout() { return L; } };
}

/**
 * Reads an exported workspace file. Returns { name, state } or { error } (English text, translated). Unknown panels and
 * broken parts are dropped by normalize; a file of another studio is refused.
 */
export function parseWorkspace(text, studio, panels) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: t("This is not a workspace file.") };
  }
  if (!data || data.format !== FORMAT || typeof data.state !== "object" || !data.state) return { error: t("This is not a workspace file.") };
  if (data.studio !== studio) return { error: t("This workspace belongs to the {studio} studio. Switch to it first.", { studio: dockDef(data.studio)?.label || String(data.studio).slice(0, 40) }) };
  const s = data.state;
  const known = new Set(panels);
  const state = {
    hidden: Array.isArray(s.hidden) ? s.hidden.filter((p) => known.has(p)) : [],
    side: s.side === "left" ? "left" : "right",
    width: Number.isFinite(s.width) && s.width >= 220 && s.width <= 560 ? s.width : null,
  };
  if (typeof s.preset === "string" && /^[a-z-]{1,24}$/.test(s.preset)) state.preset = s.preset;
  const dock = M.normalize(s.dock, { known });
  if (dock) state.dock = dock;
  const name = String(data.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || t("Imported workspace");
  return { name, state };
}
