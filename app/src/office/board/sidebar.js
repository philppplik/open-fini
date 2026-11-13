// Whiteboard sidebar (docs/office-board.md ▸ Sidebar): a docked, collapsible, resizable panel on the right of the
// board with four tabs: Comments (every thread of the board, filter, search, unread marks, jump to the pin), Outline
// (pages, frames and elements: select, rename, hide, lock, zoom to, drag to reorder), Properties (the selection's
// position, size, colors, text and connector style) and Library (shapes and sticky notes to click or drag in).
// On narrow windows it is an overlay drawer. Open state, width and tab are remembered (preferences boardSidebar,
// boardSidebarWidth, boardSidebarTab). Pure logic lives in comments.js and outline.js (unit tested).
//
// createBoardSidebar(ctx) → { el, refresh(what), show(tab), toggle(force), isOpen(), setNarrow(on), destroy() }
// ctx (from view.js): app, model(), page(), selection(), select(ids), reveal(id), gotoPage(id), commit(label, next),
//   threads() → [Thread], pinNumbers() → Map, openThread(id), addComment(), myId(), seenAt(id), markSeen(id),
//   insertItem(spec, at?), canComment()
// Accessibility: the tabs are a real tablist (arrow keys), rows are buttons, the resize handle is a focusable separator
// (arrow keys), Escape closes the drawer on narrow windows and returns focus to the board.
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import * as M from "./model.js";
import { boardOutline, moveInZOrder } from "./outline.js";
import { filterBoardThreads, isUnread, anchorLabel, threadLastActivity } from "./comments.js";

export const TYPE_LABELS = {
  rect: N_("Rectangle"), ellipse: N_("Ellipse"), diamond: N_("Diamond"), line: N_("Line"), arrow: N_("Arrow"), pen: N_("Drawing"),
  highlighter: N_("Highlight"), text: N_("Text"), sticky: N_("Sticky note"), image: N_("Image"), frame: N_("Frame"), table: N_("Table"),
  chart: N_("Chart"), plot: N_("Graph"), math: N_("Formula"), portal: N_("Sub-board"),
};
const TYPE_ICONS = { rect: "square", ellipse: "circle", diamond: "diamond", line: "slash-lg", arrow: "arrow-right", pen: "pen", highlighter: "brush", text: "fonts", sticky: "sticky", image: "image", frame: "bounding-box", table: "table", chart: "bar-chart", plot: "graph-up", math: "calculator", portal: "window-stack" };
const TABS = [["comments", N_("Comments"), "chat-quote"], ["outline", N_("Outline"), "layers"], ["properties", N_("Properties"), "sliders"], ["library", N_("Library"), "grid"]];
const MIN_W = 220;
const MAX_W = 520;
const typeLabel = (type) => t(TYPE_LABELS[type] || type);
const icon = (name) => h("sl-icon", { name, "aria-hidden": "true" });
const fmt = (ts) => new Date(ts).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const iconBtn = (ic, label, onClick, extra = {}) => {
  const b = h("button.of-bside__ibtn", { type: "button", "aria-label": label, title: label, ...extra }, icon(ic));
  b.addEventListener("click", (e) => (e.stopPropagation(), onClick(e, b)));
  return b;
};

/** "{type} “{name}”" templates from comments.js anchorLabel, translated. */
export function anchorText(anchor, model) {
  const [tpl, p] = anchorLabel(anchor, model);
  return t(tpl, p.type ? { ...p, type: typeLabel(p.type) } : p);
}

export function createBoardSidebar(ctx) {
  const { app } = ctx;
  let tab = TABS.some(([id]) => id === app.prefs.boardSidebarTab) ? app.prefs.boardSidebarTab : "comments";
  let width = Math.max(MIN_W, Math.min(MAX_W, Number(app.prefs.boardSidebarWidth) || 280));
  let narrow = false;
  let open = app.prefs.boardSidebar === true;
  const filter = { status: "open", mine: false, query: "", pageOnly: false };
  let outlineQuery = "";

  // ---------------------------------------------------------------------------------------------- shell
  const tabBtns = new Map();
  const panels = new Map();
  const tablist = h("div.of-bside__tabs", { role: "tablist", "aria-label": t("Whiteboard sidebar") });
  for (const [id, label, ic] of TABS) {
    const b = h("button.of-bside__tab", { type: "button", role: "tab", id: `of-bside-tab-${id}`, "aria-controls": `of-bside-panel-${id}`, "aria-selected": "false", tabIndex: -1, title: t(label) }, icon(ic), h("span", t(label)));
    b.addEventListener("click", () => show(id));
    tabBtns.set(id, b);
    tablist.append(b);
    panels.set(id, h("div.of-bside__panel", { role: "tabpanel", id: `of-bside-panel-${id}`, "aria-labelledby": `of-bside-tab-${id}`, hidden: true }));
  }
  tablist.addEventListener("keydown", (e) => {
    const ids = TABS.map(([id]) => id);
    const i = ids.indexOf(tab);
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (k) {
      e.preventDefault();
      show(ids[(i + k + ids.length) % ids.length]);
      tabBtns.get(tab).focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      show(e.key === "Home" ? ids[0] : ids[ids.length - 1]);
      tabBtns.get(tab).focus();
    }
  });
  const close = iconBtn("x-lg", t("Close sidebar"), () => toggle(false));
  const handle = h("div.of-bside__resize", { role: "separator", tabIndex: 0, "aria-orientation": "vertical", "aria-label": t("Resize sidebar"), "aria-valuemin": MIN_W, "aria-valuemax": MAX_W });
  const el = h("aside.of-bside", { "aria-label": t("Whiteboard sidebar") }, handle, h("div.of-bside__head", tablist, close), ...panels.values());
  const scrim = h("div.of-bside__scrim", { "aria-hidden": "true" });
  scrim.addEventListener("pointerdown", () => toggle(false));
  el.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing in the sidebar must not trigger board shortcuts
    if (e.key === "Escape" && narrow && !e.defaultPrevented) {
      e.preventDefault();
      toggle(false);
    }
  });

  const setWidth = (w, save = true) => {
    width = Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
    el.style.setProperty("--of-bside-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    if (save) app.setPref("boardSidebarWidth", width);
  };
  setWidth(width, false);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => setWidth(w0 + (x0 - ev.clientX), false);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setWidth(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: 16, ArrowRight: -16 }[e.key];
    if (k) (e.preventDefault(), setWidth(width + k));
  });

  function show(id) {
    if (!panels.has(id)) return;
    tab = id;
    app.setPref("boardSidebarTab", id);
    for (const [k, b] of tabBtns) {
      b.setAttribute("aria-selected", String(k === id));
      b.tabIndex = k === id ? 0 : -1;
    }
    for (const [k, p] of panels) p.hidden = k !== id;
    if (!open) toggle(true);
    refresh(id);
  }

  function toggle(force) {
    open = force ?? !open;
    el.hidden = !open;
    el.classList.toggle("is-open", open);
    scrim.hidden = !(open && narrow);
    if (!narrow) app.setPref("boardSidebar", open);
    ctx.onToggle?.(open);
    if (open) {
      refresh();
      if (narrow) requestAnimationFrame(() => tabBtns.get(tab)?.focus());
    } else if (narrow) ctx.focusBoard?.();
  }

  function setNarrow(on) {
    if (narrow === !!on) return;
    narrow = !!on;
    el.classList.toggle("is-drawer", narrow);
    if (narrow && open) toggle(false); // a drawer never opens by itself
    else if (!narrow && app.prefs.boardSidebar === true && !open) toggle(true);
    scrim.hidden = !(open && narrow);
  }

  // ---------------------------------------------------------------------------------------------- comments tab
  const cSearch = h("input.of-bside__search", { type: "search", placeholder: t("Search comments"), "aria-label": t("Search comments") });
  cSearch.addEventListener("input", () => ((filter.query = cSearch.value), renderComments()));
  const cSeg = h("div.of-bside__seg", { role: "group", "aria-label": t("Show comments") });
  const cMine = h("button.of-bside__chip", { type: "button", "aria-pressed": "false" }, t("Mine"));
  cMine.addEventListener("click", () => ((filter.mine = !filter.mine), renderComments()));
  const cPage = h("button.of-bside__chip", { type: "button", "aria-pressed": "false", title: t("Only comments on the current page") }, t("This page"));
  cPage.addEventListener("click", () => ((filter.pageOnly = !filter.pageOnly), renderComments()));
  const cAdd = h("button.of-bside__primary", { type: "button" }, icon("plus-lg"), h("span", t("Add comment")));
  cAdd.addEventListener("click", () => ctx.addComment());
  const cCount = h("p.of-bside__count", { "aria-live": "polite" });
  const cList = h("ul.of-bside__list", { "aria-label": t("Comments") });
  panels.get("comments").append(h("div.of-bside__bar", cSeg, cAdd), h("div.of-bside__bar", cSearch, cMine, cPage), cCount, cList);

  function renderComments() {
    const all = ctx.threads();
    const model = ctx.model();
    const segBtn = (id, label) => {
      const b = h("button.of-bside__segbtn", { type: "button", "aria-pressed": String(filter.status === id) }, label);
      b.addEventListener("click", () => ((filter.status = id), renderComments()));
      return b;
    };
    const open = all.filter((x) => !x.resolved).length;
    cSeg.replaceChildren(segBtn("open", t("Open ({n})", { n: open })), segBtn("resolved", t("Resolved ({n})", { n: all.length - open })), segBtn("all", t("All")));
    cMine.setAttribute("aria-pressed", String(filter.mine));
    cPage.setAttribute("aria-pressed", String(filter.pageOnly));
    cAdd.disabled = !ctx.canComment();
    const me = ctx.myId();
    const shown = filterBoardThreads(all, { status: filter.status, mine: filter.mine ? me : null, query: filter.query, page: filter.pageOnly ? ctx.page() : null, model });
    const unread = all.filter((x) => isUnread(x, ctx.seenAt(x.id), me)).length;
    cCount.textContent = unread ? t("{n} unread", { n: unread }) : "";
    if (!shown.length) {
      cList.replaceChildren(h("li.of-bside__empty", all.length ? t("No comments match.") : t("No comments yet. Press C, then click on the board or on an element to comment.")));
      return;
    }
    const nums = ctx.pinNumbers();
    cList.replaceChildren(...shown.map((th) => commentRow(th, nums.get(th.id), model, me)));
  }

  function commentRow(th, n, model, me) {
    const first = th.messages.find((m) => !m.deleted);
    const unread = isUnread(th, ctx.seenAt(th.id), me);
    const replies = th.messages.filter((m) => !m.deleted).length - 1;
    const go = h("button.of-bside__crow", { type: "button", "aria-label": t("Comment {n} by {name}: {text}", { n, name: th.nick || t("Unknown author"), text: first?.text || "" }) + (unread ? `, ${t("unread")}` : "") },
      h("span.of-bside__num", { style: `--of-collab-color:${/^#[0-9a-f]{6}$/i.test(th.color || "") ? th.color : "#888888"}` }, String(n || "")),
      h("span.of-bside__ctext",
        h("span.of-bside__chead", h("strong", th.nick || t("Unknown author")), th.ai ? h("span.of-ai-badge", "AI") : null, h("time", { dateTime: new Date(threadLastActivity(th)).toISOString() }, fmt(threadLastActivity(th))), unread ? h("span.of-bside__dot", { title: t("Unread") }) : null),
        h("span.of-bside__where", anchorText(th.anchor, model)),
        h("span.of-bside__title", first?.text || t("Comment deleted")),
        replies > 0 ? h("span.of-bside__meta", t("{n, plural, one {# reply} other {# replies}}", { n: replies })) : null,
        th.resolved ? h("span.of-bside__meta", t("Resolved by {name}", { name: th.resolvedBy || "?" })) : null));
    go.addEventListener("click", () => {
      ctx.markSeen(th.id);
      ctx.openThread(th.id);
      renderComments();
    });
    const res = iconBtn(th.resolved ? "arrow-counterclockwise" : "check2-circle", th.resolved ? t("Reopen") : t("Resolve"), () => ctx.setResolved(th.id, !th.resolved));
    res.disabled = !ctx.canComment();
    return h("li.of-bside__citem", { class: `${th.resolved ? "is-resolved" : ""}${unread ? " is-unread" : ""}` }, go, res);
  }

  // ---------------------------------------------------------------------------------------------- outline tab
  const oSearch = h("input.of-bside__search", { type: "search", placeholder: t("Search elements"), "aria-label": t("Search elements") });
  oSearch.addEventListener("input", () => ((outlineQuery = oSearch.value), renderOutline()));
  const oPages = h("ul.of-bside__pages", { "aria-label": t("Pages") });
  const oList = h("ul.of-bside__list.of-bside__outline", { "aria-label": t("Elements on this page"), "aria-multiselectable": "true" });
  panels.get("outline").append(h("div.of-bside__label", t("Pages")), oPages, h("div.of-bside__bar", oSearch), oList, h("p.of-bside__hint", t("Drag rows to change the stacking order. Double-click a name to rename it.")));
  let dragIds = null;

  function renderOutline() {
    const model = ctx.model();
    const cur = ctx.page();
    oPages.replaceChildren(...M.sortedPages(model).map((p, i) => {
      const n = Object.values(model.elements).filter((e) => e.page === p.id).length;
      const b = h("button.of-bside__orow", { type: "button", "aria-current": p.id === cur ? "page" : null }, icon("file-earmark"), h("span.of-bside__olabel", p.name || t("Page {n}", { n: i + 1 })), h("small", String(n)));
      b.addEventListener("click", () => ctx.gotoPage(p.id));
      return h("li", b);
    }));
    const rows = boardOutline(model, cur, { query: outlineQuery });
    const sel = new Set(ctx.selection());
    if (!rows.length) return oList.replaceChildren(h("li.of-bside__empty", outlineQuery ? t("No elements match.") : t("This page is empty.")));
    oList.replaceChildren(...rows.map((r) => outlineRow(r, sel.has(r.id))));
  }

  function outlineRow(r, selected) {
    const label = r.label || typeLabel(r.type);
    const name = h("span.of-bside__olabel", label);
    const main = h("button.of-bside__orow", { type: "button", "aria-pressed": String(selected), title: `${typeLabel(r.type)}${r.label ? ` · ${r.label}` : ""}` }, icon(TYPE_ICONS[r.type] || "square"), name);
    main.addEventListener("click", (e) => {
      const cur = ctx.selection();
      if (e.shiftKey || e.ctrlKey || e.metaKey) ctx.select(cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]);
      else ctx.select([r.id]);
    });
    main.addEventListener("dblclick", () => rename(r, name));
    main.addEventListener("keydown", (e) => {
      if (e.key === "F2") (e.preventDefault(), rename(r, name));
      else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const m = ctx.model();
        ctx.commit(e.key === "ArrowUp" ? "Bring Forward" : "Send Backward", M.reorderElements(m, M.expandSelection(m, [r.id]), e.key === "ArrowUp" ? "forward" : "backward"));
        requestAnimationFrame(() => oList.querySelector(`[data-id="${CSS.escape(r.id)}"] .of-bside__orow`)?.focus());
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...oList.querySelectorAll(".of-bside__orow")];
        rows[rows.indexOf(main) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      }
    });
    const tools = h("span.of-bside__otools",
      iconBtn(r.hidden ? "eye-slash" : "eye", r.hidden ? t("Show") : t("Hide"), () => patch(r.id, { hidden: !r.hidden || undefined }, r.hidden ? "Show" : "Hide"), { "aria-pressed": String(!!r.hidden) }),
      iconBtn(r.locked ? "lock" : "unlock", r.locked ? t("Unlock") : t("Lock"), () => patch(r.id, { locked: !r.locked }, r.locked ? "Unlock" : "Lock"), { "aria-pressed": String(!!r.locked) }),
      iconBtn("zoom-in", t("Zoom to"), () => ctx.reveal(r.id)));
    const li = h("li.of-bside__oitem", { class: `${r.hidden ? "is-hidden" : ""}${r.locked ? " is-locked" : ""}${selected ? " is-selected" : ""}`, style: `--depth:${r.depth}`, draggable: "true" }, main, tools);
    li.dataset.id = r.id;
    li.addEventListener("dragstart", (e) => {
      const cur = ctx.selection();
      dragIds = cur.includes(r.id) ? cur : [r.id];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", r.id);
      li.classList.add("is-dragging");
    });
    li.addEventListener("dragend", () => ((dragIds = null), li.classList.remove("is-dragging")));
    li.addEventListener("dragover", (e) => {
      if (!dragIds || dragIds.includes(r.id)) return;
      e.preventDefault();
      const above = e.offsetY < li.offsetHeight / 2;
      li.dataset.drop = above ? "above" : "below";
    });
    li.addEventListener("dragleave", () => delete li.dataset.drop);
    li.addEventListener("drop", (e) => {
      if (!dragIds) return;
      e.preventDefault();
      // the list shows the top-most element first: dropping on the upper half puts the rows in front of the target
      const where = li.dataset.drop === "below" ? "below" : "above";
      delete li.dataset.drop;
      const next = moveInZOrder(ctx.model(), dragIds, r.id, where);
      dragIds = null;
      ctx.commit("Reorder", next);
    });
    return li;
  }

  function patch(id, p, label) {
    const m = ctx.model();
    ctx.commit(label, M.updateElements(m, { [id]: p }));
  }

  function rename(r, span) {
    const input = h("input.of-bside__rename", { type: "text", value: r.label, "aria-label": t("Name"), maxLength: 120 });
    input.value = r.label;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v !== r.label) patch(r.id, r.frame ? { name: v || t("Frame") } : { name: v || undefined }, "Rename");
      else renderOutline();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.preventDefault(), finish(true));
      if (e.key === "Escape") (e.preventDefault(), finish(false));
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  // ---------------------------------------------------------------------------------------------- properties tab
  const props = panels.get("properties");

  function renderProperties() {
    const model = ctx.model();
    const els = ctx.selection().map((id) => model.elements[id]).filter(Boolean);
    if (props.contains(document.activeElement) && document.activeElement.matches("input[type=number], input[type=text]")) return; // do not replace a field while typing
    if (!els.length) {
      props.replaceChildren(h("p.of-bside__empty", t("Select an element to see and change its position, size, colors and text.")));
      return;
    }
    const el = els[0];
    const single = els.length === 1;
    const locked = els.some((e) => e.locked);
    const ids = els.map((e) => e.id);
    const commitAll = (label, fn) => {
      const m = ctx.model();
      const patches = {};
      for (const id of ids) if (m.elements[id] && !m.elements[id].locked) patches[id] = fn(m.elements[id]);
      ctx.commit(label, M.updateElements(m, patches));
    };
    const field = (label, input) => h("label.of-bside__field", h("span", label), input);
    const numIn = (value, onSet, { min, max, step = 1, label }) => {
      const i = h("input.of-bside__num-in", { type: "number", value: String(Math.round(value * 100) / 100), step, min, max, "aria-label": label, disabled: locked });
      i.value = String(Math.round(value * 100) / 100);
      i.addEventListener("change", () => Number.isFinite(+i.value) && i.value !== "" && onSet(+i.value));
      i.addEventListener("keydown", (e) => e.key === "Enter" && i.blur());
      return i;
    };
    const color = (value, onSet, label, allowNone = false) => {
      const i = h("input.of-bside__color", { type: "color", value: /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff", "aria-label": label, disabled: locked });
      i.addEventListener("change", () => onSet(i.value));
      const wrap = h("span.of-bside__colorrow", i);
      if (allowNone) {
        const none = h("input", { type: "checkbox", checked: !value, "aria-label": t("No fill"), disabled: locked });
        none.addEventListener("change", () => onSet(none.checked ? null : i.value));
        wrap.append(h("label.of-bside__check", none, t("None")));
      }
      return wrap;
    };
    const select = (value, choices, onSet, label) => {
      const s = h("select.of-bside__select", { "aria-label": label, disabled: locked }, choices.map(([v, l]) => h("option", { value: v }, l)));
      s.value = value;
      s.addEventListener("change", () => onSet(s.value));
      return s;
    };
    const kids = [h("p.of-bside__label", single ? `${typeLabel(el.type)}${M.elementText(el) ? ` · ${M.elementText(el).slice(0, 40)}` : ""}` : t("{n} selected", { n: els.length }))];
    if (locked) kids.push(h("p.of-bside__hint", t("Locked elements cannot be changed. Unlock them first.")));
    // geometry
    if (single && !M.LINEAR.includes(el.type) && !M.INK.includes(el.type)) {
      const move = (dx, dy) => {
        const m = ctx.model();
        ctx.commit("Move", M.assignFrames(M.moveElements(m, M.expandSelection(m, [el.id]), dx, dy), [el.id]));
      };
      const size = (w, hh) => {
        const m = ctx.model();
        const cur = m.elements[el.id];
        ctx.commit("Resize", M.updateElements(m, { [el.id]: M.resizeElement(cur, { x: cur.x, y: cur.y, w: Math.max(1, w), h: Math.max(1, hh) }) }));
      };
      kids.push(h("div.of-bside__grid",
        field("X", numIn(el.x, (v) => move(v - el.x, 0), { label: t("X position") })),
        field("Y", numIn(el.y, (v) => move(0, v - el.y), { label: t("Y position") })),
        field(t("W"), numIn(el.w, (v) => size(v, el.h), { min: 1, label: t("Width") })),
        field(t("H"), numIn(el.h, (v) => size(el.w, v), { min: 1, label: t("Height") })),
        field(t("Angle"), numIn(((el.angle || 0) * 180) / Math.PI, (v) => commitAll("Rotate", () => ({ angle: (v * Math.PI) / 180 })), { step: 1, label: t("Rotation in degrees") }))));
    }
    // colors and lines
    const hasStroke = els.some((e) => !["image", "sticky"].includes(e.type));
    const hasFill = els.some((e) => M.SHAPES.includes(e.type) || e.type === "sticky" || e.type === "text");
    if (hasStroke) kids.push(field(t("Stroke"), color(el.stroke, (v) => commitAll("Change Style", (e) => (e.type === "sticky" ? {} : { stroke: v })), t("Stroke color"))));
    if (hasFill) kids.push(field(t("Fill"), color(el.fill, (v) => commitAll("Change Style", (e) => (e.type === "sticky" ? { fill: v || M.STICKY_COLORS[0] } : { fill: v })), t("Fill color"), true)));
    if (els.some((e) => M.SHAPES.includes(e.type))) kids.push(field(t("Fill style"), select(el.fillStyle || "solid", [["solid", t("Solid fill")], ["hachure", t("Hatched")], ["cross", t("Cross-hatched")]], (v) => commitAll("Change Style", () => ({ fillStyle: v })), t("Fill style"))));
    if (hasStroke) {
      kids.push(h("div.of-bside__grid",
        field(t("Width"), numIn(el.width ?? 2, (v) => commitAll("Change Style", () => ({ width: Math.max(0, Math.min(64, v)) })), { min: 0, max: 64, label: t("Stroke width") })),
        field(t("Line"), select(el.dash || "solid", [["solid", t("Solid")], ["dashed", t("Dashed")], ["dotted", t("Dotted")]], (v) => commitAll("Change Style", () => ({ dash: v })), t("Line style")))));
      kids.push(field(t("Style"), select(String(el.rough ? 1 : 0), [["1", t("Hand-drawn")], ["0", t("Clean")]], (v) => commitAll("Change Style", () => ({ rough: +v })), t("Drawing style"))));
    }
    kids.push(field(t("Opacity"), numIn(Math.round((el.opacity ?? 1) * 100), (v) => commitAll("Change Style", () => ({ opacity: Math.max(0, Math.min(100, v)) / 100 })), { min: 0, max: 100, step: 5, label: t("Opacity in percent") })));
    // text
    if (els.some((e) => typeof e.text === "string" || e.type === "text")) {
      kids.push(h("p.of-bside__label", t("Text")));
      kids.push(h("div.of-bside__grid",
        field(t("Font"), select(el.font || "hand", [["hand", t("Handwritten")], ["sans", t("Sans serif")], ["serif", t("Serif")], ["mono", t("Monospace")]], (v) => commitAll("Change Style", (e) => (e.type === "text" ? { font: v, ...M.textBox(e.text, e.fontSize, (s, z) => ctx.measure(s, z, v)) } : { font: v })), t("Font"))),
        field(t("Size"), numIn(el.fontSize || 20, (v) => commitAll("Change Style", (e) => {
          const fontSize = Math.max(6, Math.min(400, v));
          return e.type === "text" ? { fontSize, ...M.textBox(e.text, fontSize, (s, z) => ctx.measure(s, z, e.font)) } : { fontSize };
        }), { min: 6, max: 400, label: t("Font size") })),
        field(t("Align"), select(el.align || "center", [["left", t("Left")], ["center", t("Center")], ["right", t("Right")]], (v) => commitAll("Change Style", () => ({ align: v })), t("Text alignment")))));
    }
    // connectors
    if (els.some((e) => M.LINEAR.includes(e.type))) {
      const heads = M.HEADS.map((x) => [x, t({ none: N_("None"), arrow: N_("Arrow"), triangle: N_("Triangle"), dot: N_("Dot"), bar: N_("Bar") }[x])]);
      kids.push(h("p.of-bside__label", t("Connector")));
      kids.push(h("div.of-bside__grid",
        field(t("Start"), select(el.heads?.start || "none", heads, (v) => commitAll("Change Style", (e) => (M.LINEAR.includes(e.type) ? { heads: { ...(e.heads || {}), start: v } } : {})), t("Start arrowhead"))),
        field(t("End"), select(el.heads?.end || "none", heads, (v) => commitAll("Change Style", (e) => (M.LINEAR.includes(e.type) ? { heads: { ...(e.heads || {}), end: v } } : {})), t("End arrowhead")))));
    }
    // state
    const lock = h("input", { type: "checkbox", checked: els.every((e) => e.locked) });
    lock.addEventListener("change", () => {
      const m = ctx.model();
      ctx.commit(lock.checked ? "Lock" : "Unlock", M.updateElements(m, Object.fromEntries(ids.map((id) => [id, { locked: lock.checked }]))));
    });
    const hide = h("input", { type: "checkbox", checked: els.every((e) => e.hidden) });
    hide.addEventListener("change", () => {
      const m = ctx.model();
      ctx.commit(hide.checked ? "Hide" : "Show", M.updateElements(m, Object.fromEntries(ids.map((id) => [id, { hidden: hide.checked || undefined }]))));
    });
    kids.push(h("div.of-bside__checks", h("label.of-bside__check", lock, t("Locked")), h("label.of-bside__check", hide, t("Hidden"))));
    props.replaceChildren(h("div.of-bside__form", ...kids));
  }

  // ---------------------------------------------------------------------------------------------- library tab
  const LIB = [
    { type: "rect", label: N_("Rectangle") },
    { type: "ellipse", label: N_("Ellipse") },
    { type: "diamond", label: N_("Diamond") },
    { type: "text", label: N_("Text") },
    { type: "frame", label: N_("Frame") },
    ...M.STICKY_COLORS.map((fill, i) => ({ type: "sticky", fill, label: [N_("Yellow sticky note"), N_("Pink sticky note"), N_("Green sticky note"), N_("Blue sticky note"), N_("Orange sticky note"), N_("Violet sticky note")][i] })),
  ];
  function renderLibrary() {
    const p = panels.get("library");
    if (p.childElementCount) return;
    const grid = h("ul.of-bside__lib", { "aria-label": t("Library") });
    for (const it of LIB) {
      const b = h("button.of-bside__tile", { type: "button", draggable: "true", title: t(it.label), "aria-label": t("Insert {name}", { name: t(it.label) }) },
        it.type === "sticky" ? h("span.of-bside__swatch", { style: `background:${it.fill}` }) : icon(TYPE_ICONS[it.type]), h("span", t(it.label)));
      b.addEventListener("click", () => ctx.insertItem(it));
      b.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/x-openfini-board-item", JSON.stringify({ type: it.type, fill: it.fill || null }));
      });
      grid.append(h("li", b));
    }
    p.append(h("p.of-bside__hint", t("Click to add at the center of the view, or drag onto the board.")), grid);
  }

  // ---------------------------------------------------------------------------------------------- refresh
  let pending = new Set();
  let raf = 0;
  /** what: "comments" | "outline" | "properties" | undefined (all). Coalesced to one frame. */
  function refresh(what) {
    if (!open) return;
    if (what) pending.add(what);
    else pending = new Set(["comments", "outline", "properties", "library"]);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const want = pending;
      pending = new Set();
      if (want.has(tab) || want.has("all")) {
        if (tab === "comments") renderComments();
        else if (tab === "outline") renderOutline();
        else if (tab === "properties") renderProperties();
        else renderLibrary();
      }
    });
  }

  el.hidden = true;
  scrim.hidden = true;
  if (open) {
    open = false;
    queueMicrotask(() => show(tab));
  } else {
    for (const [k, b] of tabBtns) {
      b.setAttribute("aria-selected", String(k === tab));
      b.tabIndex = k === tab ? 0 : -1;
    }
    for (const [k, p] of panels) p.hidden = k !== tab;
  }

  return {
    el,
    scrim,
    refresh,
    show,
    toggle,
    setNarrow,
    isOpen: () => open,
    get tab() {
      return tab;
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
