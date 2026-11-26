// The Prototype panel of the Proto Studio (docs/concepts/proto-studio.md §5.3, §6, task T9) and the Design | Prototype
// tabs of the right-hand inspector (dock id "proto-inspector"). In Prototype mode the panel replaces the Design panel:
//   * a layer's interactions: trigger (click, double click, while pressing, while hovering, mouse enter and leave,
//     drag, key with modifiers, after delay, variable change) and its actions (navigate, back, scroll to, open, swap
//     and close overlay with position, background and close on outside click; change to variant; set variable with an
//     expression; conditional; open link) with the transition (instant, dissolve, move in and out, push, slide, smart
//     animate; direction, duration, easing with springs);
//   * scrolling: the layer's overflow scrolling and its position while scrolling (sticky);
//   * flow starting points of a top-level frame; with nothing selected the page's flows and Preview.
// Every change is ONE operation (interaction.* / flow.* / node.update) and so one undo step.
//
//   createPrototypePanel(ws) → { el, render(force?) }
//   createInspector(ws, design, prototype) → { el, render(force?), geometry() }   the tabs; follows ws.mode
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { TRIGGERS, ACTIONS, field, STICKY } from "../../engine/proto/schema.js";
import { TRANSITIONS, DIRECTIONS, EASINGS, OVERLAY_POSITIONS, DEFAULT_DURATION, topOf } from "../../engine/proto/interactions.js";
import { variantAxes } from "../../engine/proto/components.js";
import { indexOf, pageKey } from "../../engine/proto/tree.js";

const TRIGGER_LABELS = { click: N_("On click"), doubleClick: N_("On double click"), press: N_("While pressing"), hover: N_("While hovering"), mouseEnter: N_("Mouse enter"), mouseLeave: N_("Mouse leave"), drag: N_("On drag"), key: N_("Key"), afterDelay: N_("After delay"), variableChange: N_("Variable changes") };
const ACTION_LABELS = { navigate: N_("Navigate to"), back: N_("Back"), scrollTo: N_("Scroll to"), openOverlay: N_("Open overlay"), swapOverlay: N_("Swap overlay"), closeOverlay: N_("Close overlay"), variant: N_("Change to variant"), set: N_("Set variable"), if: N_("Conditional"), openUrl: N_("Open link"), media: N_("Media (later)") };
const TR_LABELS = { instant: N_("Instant"), dissolve: N_("Dissolve"), moveIn: N_("Move in"), moveOut: N_("Move out"), push: N_("Push"), slide: N_("Slide"), smart: N_("Smart animate") };
const DIR_LABELS = { left: N_("Left"), right: N_("Right"), up: N_("Up"), down: N_("Down") };
const EASE_LABELS = { linear: N_("Linear"), ease: N_("Ease"), "ease-in": N_("Ease in"), "ease-out": N_("Ease out"), "ease-in-out": N_("Ease in and out") };
const SPRINGS = { gentle: { label: N_("Gentle spring"), v: [1, 100, 15] }, quick: { label: N_("Quick spring"), v: [1, 300, 20] }, bouncy: { label: N_("Bouncy spring"), v: [1, 600, 15] }, slow: { label: N_("Slow spring"), v: [1, 80, 20] } };
const POS_LABELS = { center: N_("Center"), top: N_("Top center"), bottom: N_("Bottom center"), left: N_("Left center"), right: N_("Right center"), topLeft: N_("Top left"), topRight: N_("Top right"), bottomLeft: N_("Bottom left"), bottomRight: N_("Bottom right") };
const OPS_LABELS = { "==": "=", "!=": "≠", "<": "<", ">": ">", "<=": "≤", ">=": "≥" };
const SCROLL_LABELS = { none: N_("No scrolling"), y: N_("Vertical"), x: N_("Horizontal"), both: N_("Both directions") };
const STICKY_LABELS = { "": N_("Scroll with parent"), top: N_("Sticky to top"), bottom: N_("Sticky to bottom"), left: N_("Sticky to left"), right: N_("Sticky to right") };
const TARGET_ACTS = ["navigate", "openOverlay", "swapOverlay"];
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A new action of a kind, with sensible defaults (`frames` lists the page's top-level frames). */
export function newAction(act, { frames = [], vars = [], from = null } = {}) {
  const other = frames.find((f) => f !== from) || frames[0] || null;
  const tr = { type: "dissolve", dur: DEFAULT_DURATION, ease: "ease-out" };
  switch (act) {
    case "navigate":
      return { act, to: other, tr };
    case "openOverlay":
      return { act, to: other, pos: "center", dim: "#00000066", closeOutside: true, tr };
    case "swapOverlay":
      return { act, to: other, tr };
    case "back":
    case "closeOverlay":
      return { act };
    case "scrollTo":
      return { act, to: from, smooth: true };
    case "variant":
      return { act, set: {} };
    case "set":
      return { act, var: vars[0]?.id ?? null, value: vars[0]?.type === "bool" ? { op: "not", args: [{ var: vars[0].id }] } : vars[0]?.type === "number" ? 0 : "" };
    case "if":
      return { act, cond: vars[0] ? { var: vars[0].id, op: "==", value: vars[0].type === "bool" ? true : vars[0].type === "number" ? 0 : "" } : true, then: [], else: [] };
    case "openUrl":
      return { act, url: "https://", newTab: true };
    default:
      return { act };
  }
}

/** Parses a typed value: true, false, numbers, otherwise the text. */
const parseLiteral = (s) => {
  const v = String(s).trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && Number.isFinite(Number(v))) return Number(v);
  return String(s);
};
const showLiteral = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function createPrototypePanel(ws) {
  const el = h("div.of-proto-design.of-proto-proto", { role: "region", "aria-label": t("Prototype") });
  let key = null;

  const model = () => ws.model();
  const apply = (op, label) => ws.apply(op, label);

  // ---- widgets (the Design panel's look)
  const sec = (title, children, actions = null) => h("section.of-proto-design__sec", { "aria-label": title }, h("header.of-proto-design__head", h("h3", title), actions), ...children.filter(Boolean));
  const note = (text) => h("p.of-proto-design__note", text);
  function select({ label, value, options, onChange, fld }) {
    const s = h("select.of-proto-design__select", { "aria-label": label, dataset: { field: fld || "" } });
    for (const [v, l] of options) s.append(h("option", { value: v, selected: v === value }, l));
    if (!options.some(([v]) => v === value)) s.append(h("option", { value: "", selected: true, disabled: true }, value == null || value === "" ? t("Choose…") : String(value)));
    s.addEventListener("change", () => onChange(s.value));
    return h("label.of-proto-design__field", h("span", label), s);
  }
  function text({ label, value, placeholder = "", onCommit, fld, type = "text" }) {
    const i = h("input.of-proto-design__text", { type, value: value ?? "", placeholder, "aria-label": label, spellcheck: false, dataset: { field: fld || "" } });
    i.addEventListener("change", () => onCommit(i.value));
    i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") i.blur();
    });
    return h("label.of-proto-design__field", h("span", label), i);
  }
  function check({ label, value, onChange }) {
    const c = h("input", { type: "checkbox", checked: !!value });
    c.addEventListener("change", () => onChange(c.checked));
    return h("label.of-proto-design__check", c, h("span", label));
  }
  const iconBtn = (icon, label, onClick) => {
    const b = h("button.of-proto-design__ibtn", { type: "button", "aria-label": label, "data-tip": label }, h("sl-icon", { name: icon }));
    b.addEventListener("click", onClick);
    return b;
  };
  const textBtn = (icon, label, onClick) => {
    const b = h("button.of-proto-proto__add", { type: "button" }, h("sl-icon", { name: icon }), label);
    b.addEventListener("click", onClick);
    return b;
  };

  // ---- lookups
  const framesOf = (m) => (indexOf(m).get(pageKey(ws.page)) || []).map((id) => m.nodes[id]).filter((n) => n && n.visible !== false).reverse();
  const frameOptions = (m) => framesOf(m).map((n) => [n.id, n.name || n.id]);
  const varsOf = (m) => Object.entries(m.vars?.items || {}).map(([id, v]) => ({ id, name: v.name || id, type: v.type }));
  const layerOptions = (m, top) => {
    const out = [];
    const walk = (id, depth) => {
      const n = m.nodes[id];
      if (!n || out.length > 400) return;
      out.push([id, `${"  ".repeat(depth)}${n.name || id}`]);
      for (const c of indexOf(m).get(id) || []) walk(c, depth + 1);
    };
    if (top) walk(top, 0);
    return out;
  };

  // ------------------------------------------------------------------------------------------- render
  function render(force = false) {
    const m = model();
    const sel = ws.selection.filter((id) => m.nodes[id]);
    const k = [ws.page, m.pages[ws.page], m.vars, sel.join(","), ...sel.map((id) => m.nodes[id]), ws.readOnly];
    if (!force && key && k.length === key.length && k.every((v, i) => v === key[i])) return;
    key = k;
    const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset?.field : null;
    const parts = sel.length === 1 ? layerSections(m, m.nodes[sel[0]]) : sel.length ? [note(t("Select one layer to edit its interactions."))] : pageSections(m);
    el.replaceChildren(...parts);
    if (ws.readOnly) for (const c of el.querySelectorAll("input, select, button")) c.disabled = true;
    if (focus) el.querySelector(`[data-field="${CSS.escape(focus)}"]`)?.focus?.({ preventScroll: true });
  }

  function pageSections(m) {
    const flows = Array.isArray(m.pages[ws.page]?.flows) ? m.pages[ws.page].flows : [];
    const frames = framesOf(m);
    const play = h("button.of-btn.of-btn--primary.of-proto-proto__play", { type: "button" }, h("sl-icon", { name: "play-circle" }), t("Preview"));
    play.addEventListener("click", () => ws.play?.({}));
    return [
      sec(t("Flows"), [
        ...flows.map((f) => flowRow(m, f)),
        flows.length ? null : note(t("A flow is a starting point of the prototype. Select a frame and add one, or add one at the first frame.")),
        frames.length ? textBtn("plus-lg", t("Add flow"), () => apply({ op: "flow.create", start: frames[0].id, name: t("Flow {n}", { n: flows.length + 1 }) }, t("Add flow"))) : null,
      ]),
      sec(t("Preview"), [play, note(t("Select a layer to add interactions. Drag the round handle at its right edge onto a frame to connect them."))]),
    ];
  }

  function flowRow(m, f) {
    const row = h("div.of-proto-proto__flow");
    const name = h("input.of-proto-design__text", { type: "text", value: f.name || "", "aria-label": t("Flow name"), dataset: { field: `flow.${f.id}` } });
    name.addEventListener("change", () => name.value.trim() && apply({ op: "flow.update", page: ws.page, id: f.id, set: { name: name.value } }, t("Rename flow")));
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
    });
    const start = m.nodes[f.start];
    row.append(
      iconBtn("play-circle", t("Play this flow"), () => ws.play?.({ flow: f.id })),
      name,
      h("span.of-proto-proto__start", start ? start.name || start.id : t("Missing frame")),
      iconBtn("trash", t("Delete flow"), () => apply({ op: "flow.delete", page: ws.page, id: f.id }, t("Delete flow"))),
    );
    return row;
  }

  function layerSections(m, n) {
    const out = [];
    out.push(h("div.of-proto-design__title", h("sl-icon", { name: "bezier2" }), h("strong", n.name || n.id)));
    const list = Array.isArray(n.proto) ? n.proto : [];
    const add = iconBtn("plus-lg", t("Add interaction"), () => {
      const frames = framesOf(m).map((f) => f.id);
      apply({ op: "interaction.add", id: n.id, interaction: { on: { type: "click" }, do: [newAction("navigate", { frames, from: topOf(m, n.id) })].filter((a) => a.to !== null) } }, t("Add interaction"));
    });
    out.push(sec(t("Interactions"), list.length ? list.map((it, i) => interactionCard(m, n, it, i)) : [note(t("No interactions. Add one, or drag the handle at the right edge of the layer onto a frame."))], add));
    if (n.parent == null) {
      const flows = (m.pages[n.page]?.flows || []).filter((f) => f.start === n.id);
      out.push(sec(t("Flow starting point"), [...flows.map((f) => flowRow(m, f)), textBtn("signpost-split", t("Add flow starting point"), () => apply({ op: "flow.create", start: n.id, name: n.name || t("Flow") }, t("Add flow")))]));
    }
    out.push(scrollSection(m, n));
    return out;
  }

  function scrollSection(m, n) {
    const kids = [];
    if (["frame", "component", "instance", "slot"].includes(n.type))
      kids.push(select({ label: t("Overflow scrolling"), value: field(n, "scroll"), fld: "scroll", options: Object.entries(SCROLL_LABELS).map(([v, l]) => [v, t(l)]), onChange: (v) => apply({ op: "node.update", id: n.id, ...(v === "none" ? { unset: ["scroll"] } : { set: { scroll: v } }) }, t("Overflow scrolling")) }));
    if (n.parent != null && field(n, "pos") === "flow")
      kids.push(select({ label: t("When scrolling"), value: n.sticky || "", fld: "sticky", options: ["", ...STICKY].map((v) => [v, t(STICKY_LABELS[v])]), onChange: (v) => apply({ op: "node.update", id: n.id, ...(v ? { set: { sticky: v } } : { unset: ["sticky"] }) }, t("Position when scrolling")) }));
    if (!kids.length) kids.push(note(t("Layers in auto layout can stick to an edge of their scrolling frame; frames can scroll their overflow.")));
    return sec(t("Scrolling"), kids);
  }

  // ---- one interaction
  function interactionCard(m, n, it, index) {
    const setIt = (next, label = t("Edit interaction")) => apply({ op: "interaction.set", id: n.id, index, interaction: next }, label);
    const on = isObj(it.on) ? it.on : { type: "click" };
    const triggerRow = [
      select({ label: t("Trigger"), value: on.type, fld: `${index}.on`, options: TRIGGERS.map((x) => [x, t(TRIGGER_LABELS[x])]), onChange: (v) => {
        const next = clone(it);
        next.on = { type: v };
        if (v === "key") next.on.key = "Escape";
        if (v === "afterDelay") next.on.ms = 800;
        if (v === "variableChange") {
          const v0 = varsOf(m)[0];
          if (!v0) return void ws.app.toast?.(t("Create a variable first (Variables)."), "warning", 3000);
          next.on.var = v0.id;
        }
        setIt(next);
      } }),
    ];
    if (on.type === "key") {
      triggerRow.push(text({ label: t("Key"), value: on.key, fld: `${index}.key`, placeholder: "Escape", onCommit: (v) => v.trim() && setIt({ ...clone(it), on: { ...on, key: v.length === 1 ? v : v.trim() } }) }));
      const mods = new Set(on.mods || []);
      triggerRow.push(h("div.of-proto-design__row", ...["shift", "alt", "ctrl", "meta"].map((mod) => check({ label: { shift: "Shift", alt: "Alt", ctrl: "Ctrl", meta: t("Cmd/Win") }[mod], value: mods.has(mod), onChange: (c) => {
        const s = new Set(mods);
        if (c) s.add(mod);
        else s.delete(mod);
        const next = { ...on, mods: [...s] };
        if (!s.size) delete next.mods;
        setIt({ ...clone(it), on: next });
      } }))));
    }
    if (on.type === "afterDelay") triggerRow.push(text({ label: t("Delay (ms)"), type: "number", value: on.ms, fld: `${index}.ms`, onCommit: (v) => Number.isFinite(Number(v)) && setIt({ ...clone(it), on: { ...on, ms: Math.max(0, Math.min(600000, Math.round(Number(v)))) } }) }));
    if (on.type === "variableChange") triggerRow.push(select({ label: t("Variable"), value: on.var, fld: `${index}.var`, options: varsOf(m).map((v) => [v.id, v.name]), onChange: (v) => setIt({ ...clone(it), on: { ...on, var: v } }) }));
    const acts = actionList(m, n, Array.isArray(it.do) ? it.do : [], (list) => setIt({ ...clone(it), do: list }), `${index}`, 0);
    const del = iconBtn("trash", t("Delete interaction"), () => apply({ op: "interaction.delete", id: n.id, index }, t("Delete interaction")));
    return h("div.of-proto-proto__card", h("div.of-proto-proto__cardhead", h("strong", t(TRIGGER_LABELS[on.type] || "Interaction")), del), ...triggerRow, acts);
  }

  /** An editable list of actions (also the branches of a conditional). `commit(list)` writes the whole list. */
  function actionList(m, n, list, commit, path, depth) {
    const wrap = h("div.of-proto-proto__actions");
    const frames = framesOf(m).map((f) => f.id);
    list.forEach((a, i) => {
      if (!isObj(a)) return;
      const put = (next) => {
        const copy = clone(list);
        copy[i] = next;
        commit(copy);
      };
      wrap.append(actionCard(m, n, a, put, () => commit(list.filter((_, j) => j !== i)), `${path}.${i}`, depth));
    });
    const options = ACTIONS.filter((x) => x !== "media" && (depth < 2 || x !== "if"));
    const addSel = h("select.of-proto-design__select.of-proto-proto__addact", { "aria-label": t("Add action") }, h("option", { value: "", selected: true }, `+ ${t("Add action")}`), ...options.map((x) => h("option", { value: x }, t(ACTION_LABELS[x]))));
    addSel.addEventListener("change", () => {
      if (!addSel.value) return;
      const a = newAction(addSel.value, { frames, vars: varsOf(m), from: addSel.value === "scrollTo" ? n.id : topOf(m, n.id) });
      if (TARGET_ACTS.includes(a.act) && !a.to) return void ws.app.toast?.(t("Add another frame to navigate to first."), "warning", 3000);
      if (a.act === "set" && !a.var) return void ws.app.toast?.(t("Create a variable first (Variables)."), "warning", 3000);
      commit([...clone(list), a]);
    });
    wrap.append(addSel);
    return wrap;
  }

  function actionCard(m, n, a, put, remove, path, depth) {
    const rows = [];
    const head = h("div.of-proto-proto__acthead", h("span", t(ACTION_LABELS[a.act] || a.act)), iconBtn("x-lg", t("Remove action"), remove));
    if (TARGET_ACTS.includes(a.act)) rows.push(select({ label: t("Destination"), value: a.to, fld: `${path}.to`, options: frameOptions(m), onChange: (v) => put({ ...a, to: v }) }));
    if (a.act === "scrollTo") rows.push(select({ label: t("Layer"), value: a.to, fld: `${path}.to`, options: layerOptions(m, topOf(m, n.id)), onChange: (v) => put({ ...a, to: v }) }), check({ label: t("Smooth scrolling"), value: a.smooth !== false, onChange: (c) => put({ ...a, smooth: c }) }));
    if (a.act === "openOverlay") {
      rows.push(select({ label: t("Position"), value: a.pos || "center", fld: `${path}.pos`, options: OVERLAY_POSITIONS.map((p) => [p, t(POS_LABELS[p])]), onChange: (v) => put({ ...a, pos: v }) }));
      rows.push(check({ label: t("Dim the background"), value: a.dim !== null, onChange: (c) => put({ ...a, dim: c ? "#00000066" : null }) }));
      rows.push(check({ label: t("Close when clicking outside"), value: a.closeOutside !== false, onChange: (c) => put({ ...a, closeOutside: c }) }));
    }
    if (a.act === "variant") rows.push(...variantRows(m, n, a, put, path));
    if (a.act === "set") {
      const vars = varsOf(m);
      const v = vars.find((x) => x.id === a.var);
      rows.push(select({ label: t("Variable"), value: a.var, fld: `${path}.var`, options: vars.map((x) => [x.id, x.name]), onChange: (id) => put({ ...a, var: id }) }));
      const toggle = v?.type === "bool" && isObj(a.value) && a.value.op === "not";
      if (v?.type === "bool") rows.push(check({ label: t("Toggle (true ↔ false)"), value: toggle, onChange: (c) => put({ ...a, value: c ? { op: "not", args: [{ var: a.var }] } : true }) }));
      if (!toggle) rows.push(exprField(t("Value"), a.value, (val) => put({ ...a, value: val }), `${path}.value`));
    }
    if (a.act === "if") {
      rows.push(condRows(m, a.cond, (c) => put({ ...a, cond: c }), path));
      rows.push(h("div.of-proto-proto__branch", h("span", t("Then")), actionList(m, n, a.then || [], (l) => put({ ...a, then: l }), `${path}.then`, depth + 1)));
      rows.push(h("div.of-proto-proto__branch", h("span", t("Else")), actionList(m, n, a.else || [], (l) => put({ ...a, else: l }), `${path}.else`, depth + 1)));
    }
    if (a.act === "openUrl") {
      rows.push(text({ label: t("Link"), value: a.url, fld: `${path}.url`, placeholder: "https://", onCommit: (v) => /^(https?:\/\/|mailto:|tel:)\S+$/i.test(v.trim()) ? put({ ...a, url: v.trim() }) : (ws.app.toast?.(t("Use an http(s), mailto or tel link."), "warning", 3000), render(true)) }));
      rows.push(check({ label: t("Open in a new tab"), value: a.newTab !== false, onChange: (c) => put({ ...a, newTab: c }) }));
    }
    if (["navigate", "back", "openOverlay", "swapOverlay", "closeOverlay", "variant"].includes(a.act)) rows.push(...transitionRows(a, put, path));
    return h("div.of-proto-proto__action", head, ...rows);
  }

  function variantRows(m, n, a, put, path) {
    // the instance: the target, else the selected layer's own instance (an instance, or a layer of a variant component)
    const target = a.target || (n.type === "instance" ? n.id : null);
    let axes = {};
    if (target) axes = variantAxes(m, m.nodes[target]?.of) || {};
    else {
      let p = n;
      while (p && p.type !== "component") p = m.nodes[p.parent];
      if (p) axes = variantAxes(m, p.id) || {};
    }
    const rows = [];
    const instances = Object.values(m.nodes).filter((x) => x.type === "instance" && x.page === ws.page).slice(0, 300);
    rows.push(select({ label: t("Instance"), value: a.target || "", fld: `${path}.target`, options: [["", t("This instance")], ...instances.map((x) => [x.id, x.name || x.id])], onChange: (v) => {
      const next = { ...a };
      if (v) next.target = v;
      else delete next.target;
      put(next);
    } }));
    const names = Object.keys(axes);
    if (!names.length) rows.push(note(t("The instance's component has no variants.")));
    for (const axis of names) {
      const cur = a.set?.[axis] ?? "";
      rows.push(select({ label: axis, value: cur, fld: `${path}.set.${axis}`, options: [["", t("Unchanged")], ...axes[axis].options.map((o) => [o, o])], onChange: (v) => {
        const set = { ...(a.set || {}) };
        if (v) set[axis] = v;
        else delete set[axis];
        put({ ...a, set });
      } }));
    }
    return rows;
  }

  function exprField(label, value, onCommit, fld) {
    return text({ label, value: showLiteral(value), fld, placeholder: t("true, 3, text or JSON"), onCommit: (s) => {
      const v = s.trim();
      if (v.startsWith("{")) {
        try {
          return onCommit(JSON.parse(v));
        } catch {
          ws.app.toast?.(t("The expression is not valid JSON."), "warning", 3000);
          return render(true);
        }
      }
      onCommit(parseLiteral(s));
    } });
  }

  function condRows(m, cond, put, path) {
    const vars = varsOf(m);
    const simple = isObj(cond) && typeof cond.var === "string" && typeof cond.op === "string" && OPS_LABELS[cond.op];
    if (!simple) return h("div", exprField(t("Condition"), cond, put, `${path}.cond`));
    return h(
      "div.of-proto-proto__cond",
      select({ label: t("If"), value: cond.var, fld: `${path}.cond.var`, options: vars.map((x) => [x.id, x.name]), onChange: (v) => put({ ...cond, var: v }) }),
      select({ label: t("Is"), value: cond.op, fld: `${path}.cond.op`, options: Object.entries(OPS_LABELS).map(([k, l]) => [k, l]), onChange: (v) => put({ ...cond, op: v }) }),
      text({ label: t("Value"), value: showLiteral(cond.value), fld: `${path}.cond.value`, onCommit: (v) => put({ ...cond, value: parseLiteral(v) }) }),
    );
  }

  function transitionRows(a, put, path) {
    const tr = isObj(a.tr) ? a.tr : { type: "instant" };
    const set = (patch) => {
      const next = { ...tr, ...patch };
      if (next.type === "instant") return put({ ...a, tr: { type: "instant" } });
      put({ ...a, tr: next });
    };
    const rows = [select({ label: t("Animation"), value: tr.type, fld: `${path}.tr`, options: TRANSITIONS.map((x) => [x, t(TR_LABELS[x])]), onChange: (v) => set({ type: v, ...(v !== "instant" && tr.type === "instant" ? { dur: DEFAULT_DURATION, ease: "ease-out" } : {}) }) })];
    if (tr.type === "instant") return rows;
    if (["moveIn", "moveOut", "push", "slide"].includes(tr.type)) rows.push(select({ label: t("Direction"), value: tr.dir || "left", fld: `${path}.dir`, options: DIRECTIONS.map((d) => [d, t(DIR_LABELS[d])]), onChange: (v) => set({ dir: v }) }));
    const spring = isObj(tr.ease) && Array.isArray(tr.ease.spring) ? Object.entries(SPRINGS).find(([, s]) => s.v.join() === tr.ease.spring.join())?.[0] || "custom" : null;
    const easeVal = spring ? `spring:${spring}` : typeof tr.ease === "string" ? tr.ease : isObj(tr.ease) ? "custom" : "ease-out";
    rows.push(select({ label: t("Easing"), value: easeVal, fld: `${path}.ease`, options: [...EASINGS.map((e) => [e, t(EASE_LABELS[e])]), ...Object.entries(SPRINGS).map(([k, s]) => [`spring:${k}`, t(s.label)]), ...(easeVal === "custom" ? [["custom", t("Custom")]] : [])], onChange: (v) => {
      if (v.startsWith("spring:")) {
        const s = SPRINGS[v.slice(7)];
        const next = { ...tr, ease: { spring: s.v } };
        delete next.dur; // a spring takes as long as it needs to settle
        return put({ ...a, tr: next });
      }
      if (v !== "custom") set({ ease: v, dur: Number.isFinite(tr.dur) ? tr.dur : DEFAULT_DURATION });
    } }));
    if (!spring) rows.push(text({ label: t("Duration (ms)"), type: "number", value: Number.isFinite(tr.dur) ? tr.dur : DEFAULT_DURATION, fld: `${path}.dur`, onCommit: (v) => Number.isFinite(Number(v)) && set({ dur: Math.max(0, Math.min(10000, Math.round(Number(v)))) }) }));
    return rows;
  }

  return { el, render };
}

/** The right-hand inspector: Design and Prototype tabs that follow the workspace's mode. */
export function createInspector(ws, design, prototype) {
  const tabs = h("div.of-proto-inspector__tabs", { role: "tablist", "aria-label": t("Inspector") });
  const body = h("div.of-proto-inspector__body");
  const el = h("div.of-proto-inspector", tabs, body);
  const defs = [
    ["design", t("Design")],
    ["prototype", t("Prototype")],
  ];
  const buttons = defs.map(([id, label]) => {
    const b = h("button.of-proto-inspector__tab", { type: "button", role: "tab", dataset: { mode: id } }, label);
    b.addEventListener("click", () => ws.setMode(id));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      ws.setMode(ws.mode === "design" ? "prototype" : "design");
      tabs.querySelector('[aria-selected="true"]')?.focus();
    });
    tabs.append(b);
    return b;
  });
  let shown = null;
  function render(force = false) {
    const mode = ws.mode;
    for (const b of buttons) {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const panel = mode === "prototype" ? prototype : design;
    if (shown !== panel) {
      body.replaceChildren(panel.el);
      shown = panel;
      force = true;
    }
    panel.render(force);
  }
  return {
    el,
    render,
    geometry() {
      if (ws.mode === "design") design.geometry();
    },
  };
}

