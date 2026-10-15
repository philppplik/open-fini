// "Style" dock panel of the Code studio: a visual CSS editor generated from the engine's style schema.
// It edits the rule of the chosen class at the current breakpoint (or the element's inline style); every
// change becomes a minimal text edit of the stylesheet, so the code and the panel never disagree.
import { h, empty, frameScheduler } from "../../core/util.js";
import * as E from "../../engine/web/index.js";
import { colorField } from "../controls.js";

const dotState = { set: "set", inherit: "inherit", computed: "computed" };

// ------------------------------------------------------------------ value helpers

const fmtNum = (n) => (Number.isFinite(n) ? String(+n.toFixed(3)) : "");
const toHex8 = (value) => {
  const c = E.parseColor(value);
  if (!c) return "#000000";
  const hx = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${hx(c.r)}${hx(c.g)}${hx(c.b)}${c.a < 1 ? hx(c.a * 255) : ""}`;
};
const colorOut = (picked) => {
  const c = E.parseColor(picked);
  return c ? E.formatColor(c) : picked;
};
function stepFor(def, e) {
  const base = def.step || 1;
  return base * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
}

export function createStylePanel(app) {
  const el = h("div.of-panel.of-stylepanel");
  let ws = null;
  let off = [];
  let rows = []; // { def, control, rowEl, sectionEl }
  let token = 0;
  let builtFor = "";

  function bind() {
    for (const o of off) o();
    off = [];
    ws = app.codeUI?.built ? app.codeUI : null;
    if (ws) {
      off.push(ws.on("selection", () => build()));
      off.push(ws.on("style", () => build(true)));
      for (const ev of ["swap", "project"]) off.push(ws.on(ev, softRefresh));
      off.push(ws.preview.on("breakpoint", () => build(true)));
      off.push(ws.preview.on("hot", softRefresh));
    }
    build();
  }

  // ------------------------------------------------------------------ building

  function build(keepScroll = false) {
    const top = el.scrollTop;
    empty(el);
    rows = [];
    if (!ws) {
      el.append(h("div.of-empty", "Open a website project in the Code studio to style elements."));
      return;
    }
    const cur = ws.current();
    if (!cur) {
      el.append(h("div.of-empty", "Select an element on the canvas or in the Navigator to style it."));
      return;
    }
    const target = ws.styleTarget();
    builtFor = `${cur.el.id}|${target.selector}|${target.bp.id}`;
    el.append(header(cur, target));
    for (const sec of E.STYLE_SECTIONS) {
      const body = h("div.of-sprops");
      const count = h("span.of-scount");
      const details = h("details.of-ssection", { open: ["layout", "spacing", "size", "typography"].includes(sec.id) || sectionOpen.get(sec.id) }, h("summary", h("span", sec.label), count), body);
      details.addEventListener("toggle", () => sectionOpen.set(sec.id, details.open));
      for (const def of sec.props) {
        const control = makeControl(def, ctx);
        if (!control) continue;
        const rowEl = makeRow(def, control);
        body.append(rowEl);
        rows.push({ def, control, rowEl, sectionEl: details, count });
      }
      el.append(details);
    }
    refresh();
    if (keepScroll) el.scrollTop = top;
  }
  const sectionOpen = new Map();

  function header(cur, target) {
    const classes = target.classes;
    const wrap = h("div.of-selector");
    wrap.append(h("div.of-selector__el", h("span.of-tag", cur.el.tag), E.getAttr(cur.el, "id") ? h("span.of-tagid", `#${E.getAttr(cur.el, "id")}`) : null));
    const pills = h("div.of-pills.of-pills--sel");
    for (const c of classes) {
      const active = target.selector === `.${c}`;
      const p = h("button.of-selpill", { type: "button", class: active ? "active" : "", title: `Style .${c}` }, `.${c}`);
      p.addEventListener("click", () => ws.setStyleSelector(`.${c}`));
      pills.append(p);
    }
    if (!target.bp.media) {
      const p = h("button.of-selpill.inline", { type: "button", class: ws.styleSelector === "" ? "active" : "", title: "Style this element only, inline (style attribute)" }, "inline");
      p.addEventListener("click", () => ws.setStyleSelector(""));
      pills.append(p);
    }
    const add = h("input.of-selpill-add", { type: "text", placeholder: classes.length ? "+ class" : "Name a class to style", list: "of-known-classes", spellcheck: false, "aria-label": "Add class" });
    add.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const names = add.value.split(/[\s,]+/).map((s) => s.replace(/^\./, "")).filter(Boolean);
        if (names.length) {
          ws.setClasses([...new Set([...classes, ...names])]);
          ws.setStyleSelector(`.${names[names.length - 1]}`);
        }
      }
    });
    pills.append(add, h("datalist", { id: "of-known-classes" }, ws.model.classNames().map((c) => h("option", { value: c }))));
    wrap.append(pills);
    const where = target.selector ? `${target.selector}` : ws.styleSelector === "" ? "this element (inline)" : "this element — a class is created on your first change";
    const note = h("div.of-selector__note", h("span", `Editing ${where}`), h("span.of-bpchip", `${target.bp.label}${target.bp.media ? ` · ${target.bp.media.replace(/[()]/g, "")}` : ""}`));
    wrap.append(note);
    if (target.selector && target.file) {
      const rule = E.findRule(ws.model.css(target.file), { selector: target.selector, media: target.media });
      const link = h("button.of-linkbtn", { type: "button" }, rule ? `Show ${target.selector} in ${target.file}` : `No rule yet — first change creates it in ${target.file}`);
      if (rule) link.addEventListener("click", () => ws.openFile(target.file, { focus: true, from: rule.start, to: rule.end, keepPage: true }));
      else link.disabled = true;
      wrap.append(link);
    }
    wrap.append(
      h("div.of-legend", h("span.of-dot.set"), "set here", h("span.of-dot.inherit"), "inherited from a larger screen", h("span.of-dot.computed"), "default"),
    );
    return wrap;
  }

  function makeRow(def, control) {
    const label = h("span.of-sprop__label", { title: def.prop }, def.label);
    const dot = h("button.of-sprop__dot", { type: "button", title: "Reset to inherited value", "aria-label": `Reset ${def.label}` });
    dot.addEventListener("click", () => {
      const props = {};
      for (const p of control.props || [def.prop]) props[p] = null;
      ws.setStyle(props);
    });
    const row = h("div.of-sprop", { "data-prop": def.prop, class: `of-sprop--${def.type}` }, label, control.el, dot);
    control.dot = dot;
    if (control.scrub) wireScrub(label, control);
    return row;
  }

  function wireScrub(label, control) {
    label.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      label.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const base = control.scrub.start();
      let moved = false;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 1) moved = true;
        if (moved) control.scrub.move(base, dx * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), false);
      };
      const up = (ev) => {
        label.removeEventListener("pointermove", mv);
        label.removeEventListener("pointerup", up);
        label.releasePointerCapture?.(ev.pointerId);
        if (moved) control.scrub.move(base, (ev.clientX - x0) * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), true);
      };
      label.addEventListener("pointermove", mv);
      label.addEventListener("pointerup", up);
    });
  }

  // ------------------------------------------------------------------ data flow

  const ctx = {
    commit(props) {
      ws.setStyle(props);
    },
    live(props) {
      ws.setStyle(props, { live: true });
    },
    get ws() {
      return ws;
    },
  };

  /** Pulls declarations and computed values and updates every control. */
  async function refresh() {
    const my = ++token;
    const cur = ws?.current();
    if (!cur) return;
    const target = ws.styleTarget();
    const set = ws.targetDeclarations(target);
    const inh = ws.inheritedDeclarations(target);
    const props = new Set();
    for (const { def, control } of rows) {
      props.add(def.prop);
      for (const p of control.props || []) props.add(p);
      if (def.when) props.add(def.when.prop);
    }
    const comp = await ws.preview.computed(cur.el.id, [...props]);
    if (my !== token) return;
    const info = (prop) => {
      if (set[prop]) return { value: set[prop].value + (set[prop].important ? " !important" : ""), state: "set" };
      if (inh[prop]) return { value: inh[prop].value, state: "inherit", from: inh[prop].from };
      return { value: comp?.values?.[prop] ?? "", state: "computed" };
    };
    const getComputed = (prop) => comp?.values?.[prop] ?? "";
    const focused = document.activeElement;
    for (const r of rows) {
      const { def, control } = r;
      if (def.when) {
        const v = getComputed(def.when.prop);
        const visible = def.when.in.includes(v) || (control.props || [def.prop]).some((p) => set[p]);
        r.rowEl.classList.toggle("hidden", !visible);
      }
      if (focused && r.rowEl.contains(focused) && focused.matches("input, select")) continue;
      control.set(info, { set, inh, getComputed, comp, target });
      const state = control.state?.() || "computed";
      r.rowEl.dataset.state = state;
      control.dot.classList.toggle("set", state === "set");
      control.dot.classList.toggle("inherit", state === "inherit");
    }
    for (const sec of el.querySelectorAll(".of-ssection")) {
      const n = sec.querySelectorAll('.of-sprop[data-state="set"]:not(.hidden)').length;
      const c = sec.querySelector(".of-scount");
      c.textContent = n ? String(n) : "";
    }
  }
  const softRefresh = frameScheduler(() => {
    const cur = ws?.current();
    const target = cur && ws.styleTarget();
    if (!cur) return build();
    const key = `${cur.el.id}|${target.selector}|${target.bp.id}`;
    if (key !== builtFor) return build(true);
    refresh();
  });

  app.on("codeui", bind);
  app.on("studio", bind);
  app.on("doc", bind);
  bind();
  return { el, show: () => ws && softRefresh() };
}

// ------------------------------------------------------------------ controls

function makeControl(def, ctx) {
  switch (def.type) {
    case "keyword":
      return selectControl(def, ctx);
    case "segmented":
    case "toggle":
      return segmentedControl(def, ctx);
    case "length":
      return lengthControl(def, ctx);
    case "number":
      return numberControl(def, ctx);
    case "color":
      return colorControl(def, ctx);
    case "box":
      return boxControl(def, ctx);
    case "font-family":
      return fontFamilyControl(def, ctx);
    case "font-weight":
      return fontWeightControl(def, ctx);
    case "shadow":
      return shadowControl(def, ctx);
    case "gradient":
      return backgroundImageControl(def, ctx);
    default:
      return textControl(def, ctx);
  }
}

const trimVal = (v) => String(v ?? "").trim();

function selectControl(def, ctx) {
  const sel = h("select.of-ssel", { "aria-label": def.label });
  for (const o of def.options || []) sel.append(h("option", { value: o.value }, o.label));
  sel.addEventListener("change", () => ctx.commit({ [def.prop]: sel.value }));
  let state = "computed";
  return {
    el: sel,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      sel.querySelector("option[data-custom]")?.remove();
      if (v && ![...sel.options].some((o) => o.value === v)) sel.append(h("option", { value: v, "data-custom": "1" }, v));
      sel.value = v;
      sel.classList.toggle("dim", i.state !== "set");
    },
  };
}

function segmentedControl(def, ctx) {
  const wrap = h("div.of-sseg", { role: "group", "aria-label": def.label });
  const btns = (def.options || []).map((o) => {
    const b = h("button.of-sseg__btn", { type: "button", title: o.label, "aria-pressed": "false", "data-value": o.value }, o.icon ? h("sl-icon", { name: o.icon }) : o.label);
    b.addEventListener("click", () => ctx.commit({ [def.prop]: o.value }));
    wrap.append(b);
    return b;
  });
  let state = "computed";
  return {
    el: wrap,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      for (const b of btns) b.setAttribute("aria-pressed", String(b.dataset.value === v || (def.prop === "text-decoration" && v.startsWith(b.dataset.value) && b.dataset.value !== "none")));
      wrap.classList.toggle("dim", i.state !== "set");
    },
  };
}

function lengthControl(def, ctx) {
  const units = def.units?.length ? def.units : ["px"];
  const keywords = def.keywords || [];
  const num = h("input.of-slen__num", { type: "text", inputMode: "decimal", spellcheck: false, "aria-label": def.label });
  const unit = h("select.of-slen__unit", { "aria-label": `${def.label} unit` });
  for (const u of units) unit.append(h("option", { value: u }, u === "" ? "—" : u));
  for (const k of keywords) unit.append(h("option", { value: `kw:${k}` }, k));
  const el = h("div.of-slen", num, unit);
  let state = "computed";
  let cur = { n: 0, unit: units[0] };
  const compose = (n, u) => (u === "" ? fmtNum(n) : `${fmtNum(n)}${u}`);
  const sendLive = () => ctx.live({ [def.prop]: compose(cur.n, cur.unit) });
  const sendCommit = () => ctx.commit({ [def.prop]: compose(cur.n, cur.unit) });
  const clampN = (n) => Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
  num.addEventListener("input", () => {
    const n = parseFloat(num.value.replace(",", "."));
    if (Number.isFinite(n)) {
      cur.n = clampN(n);
      sendLive();
    }
  });
  num.addEventListener("change", () => {
    const raw = num.value.trim();
    // typing a keyword, a calc() or a value with a unit
    if (raw && !/^[-+]?\d*\.?\d+$/.test(raw)) {
      ctx.commit({ [def.prop]: raw });
      return;
    }
    const n = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(n)) {
      cur.n = clampN(n);
      sendCommit();
    }
  });
  num.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      cur.n = clampN(+(cur.n + (e.key === "ArrowUp" ? 1 : -1) * stepFor(def, e)).toFixed(3));
      num.value = fmtNum(cur.n);
      sendCommit();
    } else if (e.key === "Enter") num.blur();
  });
  num.addEventListener("focus", () => num.select());
  unit.addEventListener("change", () => {
    if (unit.value.startsWith("kw:")) ctx.commit({ [def.prop]: unit.value.slice(3) });
    else {
      cur.unit = unit.value;
      sendCommit();
    }
  });
  return {
    el,
    state: () => state,
    scrub: {
      start: () => cur.n,
      move(base, dx, final) {
        cur.n = clampN(+(base + dx * (def.step || 1)).toFixed(3));
        num.value = fmtNum(cur.n);
        (final ? sendCommit : sendLive)();
      },
    },
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      const p = v ? E.parseLength(v) : null;
      unit.querySelector("option[data-custom]")?.remove();
      if (p && "n" in p) {
        cur = { n: p.n, unit: p.unit ?? "" };
        num.value = fmtNum(p.n);
        num.placeholder = "";
        if (![...unit.options].some((o) => o.value === cur.unit)) unit.append(h("option", { value: cur.unit, "data-custom": "1" }, cur.unit || "—"));
        unit.value = cur.unit;
      } else if (p && p.keyword) {
        num.value = "";
        num.placeholder = p.keyword.length > 9 ? "calc" : p.keyword;
        if (keywords.includes(p.keyword)) unit.value = `kw:${p.keyword}`;
        else {
          unit.append(h("option", { value: `kw:${p.keyword}`, "data-custom": "1" }, p.keyword.length > 12 ? "custom" : p.keyword));
          unit.value = `kw:${p.keyword}`;
        }
      } else {
        num.value = "";
        num.placeholder = "";
        unit.value = units[0];
      }
      el.classList.toggle("dim", i.state !== "set");
    },
  };
}

function numberControl(def, ctx) {
  const input = h("input.of-slen__num.wide", { type: "text", inputMode: "decimal", spellcheck: false, "aria-label": def.label });
  let state = "computed";
  let cur = 0;
  const clampN = (n) => Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
  input.addEventListener("input", () => {
    const n = parseFloat(input.value);
    if (Number.isFinite(n)) {
      cur = clampN(n);
      ctx.live({ [def.prop]: fmtNum(cur) });
    }
  });
  input.addEventListener("change", () => {
    const n = parseFloat(input.value);
    if (Number.isFinite(n)) ctx.commit({ [def.prop]: fmtNum(clampN(n)) });
    else if (input.value.trim()) ctx.commit({ [def.prop]: input.value.trim() });
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      cur = clampN(+(cur + (e.key === "ArrowUp" ? 1 : -1) * stepFor(def, e)).toFixed(3));
      input.value = fmtNum(cur);
      ctx.commit({ [def.prop]: fmtNum(cur) });
    } else if (e.key === "Enter") input.blur();
  });
  return {
    el: input,
    state: () => state,
    scrub: {
      start: () => cur,
      move(base, dx, final) {
        cur = clampN(+(base + dx * (def.step || 1)).toFixed(3));
        input.value = fmtNum(cur);
        (final ? ctx.commit : ctx.live)({ [def.prop]: fmtNum(cur) });
      },
    },
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const n = parseFloat(i.value);
      cur = Number.isFinite(n) ? n : 0;
      input.value = Number.isFinite(n) ? fmtNum(n) : trimVal(i.value);
      input.classList.toggle("dim", i.state !== "set");
    },
  };
}

function colorControl(def, ctx) {
  let lastValue = "";
  const field = colorField({
    value: "#000000",
    alpha: true,
    label: "",
    onInput: (v) => ctx.live({ [def.prop]: colorOut(v) }),
    onChange: (v) => ctx.commit({ [def.prop]: colorOut(v) }),
  });
  const text = h("input.of-slen__num.wide", { type: "text", spellcheck: false, "aria-label": `${def.label} value`, placeholder: "none" });
  text.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") text.blur();
  });
  text.addEventListener("change", () => {
    const v = text.value.trim();
    if (v) ctx.commit({ [def.prop]: v });
  });
  const el = h("div.of-scolor", field.el, text);
  let state = "computed";
  return {
    el,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      lastValue = v;
      const c = E.parseColor(v);
      field.set(c ? toHex8(v) : "#00000000");
      text.value = c ? E.formatColor(c) : v;
      el.classList.toggle("dim", i.state !== "set");
    },
  };
}

function textControl(def, ctx) {
  const input = h("input.of-slen__num.wide", { type: "text", spellcheck: false, "aria-label": def.label, placeholder: def.placeholder || "none" });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
  });
  input.addEventListener("change", () => ctx.commit({ [def.prop]: input.value.trim() || null }));
  let state = "computed";
  return {
    el: input,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      input.value = trimVal(i.value).replace(/\s*!important$/, "");
      input.classList.toggle("dim", i.state !== "set");
    },
  };
}

function fontWeightControl(def, ctx) {
  const weights = [["100", "100 · Thin"], ["200", "200 · Extra Light"], ["300", "300 · Light"], ["400", "400 · Regular"], ["500", "500 · Medium"], ["600", "600 · Semibold"], ["700", "700 · Bold"], ["800", "800 · Extra Bold"], ["900", "900 · Black"]];
  const sel = h("select.of-ssel", { "aria-label": def.label }, weights.map(([v, l]) => h("option", { value: v }, l)));
  sel.addEventListener("change", () => ctx.commit({ [def.prop]: sel.value }));
  let state = "computed";
  return {
    el: sel,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = { normal: "400", bold: "700" }[trimVal(i.value)] || trimVal(i.value);
      sel.querySelector("option[data-custom]")?.remove();
      if (v && !weights.some(([w]) => w === v)) sel.append(h("option", { value: v, "data-custom": "1" }, v));
      sel.value = v;
      sel.classList.toggle("dim", i.state !== "set");
    },
  };
}

function fontFamilyControl(def, ctx) {
  const sel = h("select.of-ssel", { "aria-label": def.label });
  let projectFonts = [];
  const stacks = () => [...E.FONT_STACKS.map((f) => [f.value, f.label]), ...projectFonts.map((n) => [`"${n}", sans-serif`, `${n} (project font)`])];
  const fill = () => {
    sel.replaceChildren(...stacks().map(([v, l]) => h("option", { value: v }, l)));
  };
  sel.addEventListener("change", () => ctx.commit({ [def.prop]: sel.value }));
  let state = "computed";
  return {
    el: sel,
    state: () => state,
    set(info, extra) {
      const i = info(def.prop);
      state = i.state;
      const names = new Set();
      for (const p of extra.target ? ctx.ws.model.cssFiles() : []) {
        for (const r of ctx.ws.model.css(p).rules) if (r.type === "at" && r.name === "font-face") for (const d of r.decls) if (d.prop === "font-family") names.add(d.value.replace(/["']/g, "").trim());
      }
      projectFonts = [...names];
      fill();
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      if (v && ![...sel.options].some((o) => o.value === v)) sel.append(h("option", { value: v }, v.split(",")[0].replace(/["']/g, "")));
      sel.value = v;
      sel.classList.toggle("dim", i.state !== "set");
    },
  };
}

// ---- box (margin, padding, border widths, radius)

function boxControl(def, ctx) {
  const longhands = def.longhands || [];
  const labels = longhands.length === 4 && /radius/.test(def.prop) ? ["↖", "↗", "↘", "↙"] : ["top", "right", "bottom", "left"];
  let linked = false;
  const inputs = longhands.map((lh, i) => {
    const inp = h("input.of-sbox__in", { type: "text", spellcheck: false, "aria-label": `${def.label} ${labels[i]}`, title: lh, placeholder: "0" });
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") inp.blur();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const p = E.parseLength(inp.value || "0");
        const n = (p && "n" in p ? p.n : 0) + (e.key === "ArrowUp" ? 1 : -1) * stepFor({ step: 1 }, e);
        inp.value = fmtNum(n) + (p && "n" in p && p.unit ? p.unit : "px");
        commit(i, inp.value);
      }
    });
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("change", () => {
      let v = inp.value.trim();
      if (/^[-+]?\d*\.?\d+$/.test(v)) v = v === "0" ? "0" : `${v}px`;
      inp.value = v;
      commit(i, v);
    });
    inp.addEventListener("input", () => {
      const v = /^[-+]?\d*\.?\d+$/.test(inp.value.trim()) ? `${inp.value.trim()}px` : inp.value.trim();
      if (E.parseLength(v)) liveSend(i, v);
    });
    return inp;
  });
  const link = h("button.of-sbox__link", { type: "button", title: "Link all sides", "aria-pressed": "false" }, h("sl-icon", { name: "link-45deg" }));
  link.addEventListener("click", () => {
    linked = !linked;
    link.setAttribute("aria-pressed", String(linked));
  });
  const grid = h(
    "div.of-sbox",
    h("div.of-sbox__top", inputs[0]),
    h("div.of-sbox__mid", inputs[3], link, inputs[1]),
    h("div.of-sbox__bot", inputs[2]),
  );
  if (longhands.length === 4 && /radius/.test(def.prop)) grid.classList.add("corners");
  let state = "computed";
  let shorthandSet = false;

  function liveSend(i, v) {
    const props = {};
    if (linked) for (const lh of longhands) props[lh] = v;
    else props[longhands[i]] = v;
    ctx.live(props);
  }
  function commit(i, v) {
    const values = inputs.map((x) => x.value.trim() || "0");
    if (linked) values.fill(v);
    else values[i] = v;
    const props = {};
    if (shorthandSet) {
      props[def.prop] = E.collapseBox(values);
      for (const lh of longhands) props[lh] = null;
    } else if (linked) for (const lh of longhands) props[lh] = v;
    else props[longhands[i]] = v;
    ctx.commit(props);
  }
  return {
    el: grid,
    props: [def.prop, ...longhands],
    state: () => state,
    set(info) {
      // shorthand declaration first, longhands override it
      const sh = info(def.prop);
      shorthandSet = sh.state === "set";
      let sides = null;
      if (sh.value && (sh.state === "set" || sh.state === "inherit")) {
        try {
          sides = E.expandBox(sh.value);
        } catch {
          sides = null;
        }
      }
      let any = sh.state === "set";
      let inherit = sh.state === "inherit";
      longhands.forEach((lh, i) => {
        const l = info(lh);
        let v = l.value;
        if (l.state === "set") {
          any = true;
        } else if (l.state === "inherit") {
          inherit = true;
        } else if (sides) v = sides[i];
        if (l.state === "computed" && sides) v = sides[i];
        else if (l.state === "computed" && !sides) v = l.value;
        inputs[i].value = trimVal(v).replace(/^0px$/, "0");
        inputs[i].classList.toggle("dim", !(l.state !== "computed" || sh.state !== "computed"));
      });
      state = any ? "set" : inherit ? "inherit" : "computed";
    },
  };
}

// ---- shadows

function shadowControl(def, ctx) {
  const wrap = h("div.of-sshadow");
  const list = h("div.of-sshadow__list");
  const add = h("button.of-btn", { type: "button", onclick: () => {
    shadows.push({ inset: false, x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0, 0, 0, 0.25)" });
    commit();
    draw();
  } }, h("sl-icon", { name: "plus-lg" }), "Add shadow");
  wrap.append(list, add);
  let shadows = [];
  let state = "computed";
  const unitless = (n) => `${fmtNum(n)}px`;
  const commit = () => ctx.commit({ [def.prop]: shadows.length ? E.formatShadowList(shadows) : "none" });
  function draw() {
    empty(list);
    shadows.forEach((s, i) => {
      const nums = ["x", "y", "blur", "spread"].map((k) => {
        const inp = h("input.of-sbox__in", { type: "text", value: fmtNum(s[k]), title: k, "aria-label": `Shadow ${k}`, spellcheck: false });
        inp.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") inp.blur();
        });
        inp.addEventListener("change", () => {
          const n = parseFloat(inp.value);
          if (Number.isFinite(n)) {
            s[k] = n;
            commit();
          }
        });
        return h("label.of-sshadow__n", h("span", k), inp);
      });
      const color = colorField({ value: toHex8(s.color), alpha: true, label: "", onInput: (v) => {
        s.color = colorOut(v);
        ctx.live({ [def.prop]: E.formatShadowList(shadows) });
      }, onChange: (v) => {
        s.color = colorOut(v);
        commit();
      } });
      const inset = h("button.of-sseg__btn", { type: "button", "aria-pressed": String(!!s.inset), title: "Inner shadow", onclick: () => {
        s.inset = !s.inset;
        commit();
        draw();
      } }, "inset");
      const del = h("button.of-attr__del", { type: "button", "aria-label": "Remove shadow", onclick: () => {
        shadows.splice(i, 1);
        commit();
        draw();
      } }, "×");
      list.append(h("div.of-sshadow__row", h("div.of-sshadow__nums", nums), h("div.of-sshadow__tail", color.el, inset, del)));
    });
  }
  return {
    el: wrap,
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value);
      try {
        shadows = v && v !== "none" ? E.parseShadowList(v) : [];
      } catch {
        shadows = [];
      }
      if (!wrap.contains(document.activeElement)) draw();
      wrap.classList.toggle("dim", i.state !== "set");
    },
    unitless,
  };
}

// ---- background image: gradient or image

function backgroundImageControl(def, ctx) {
  const wrap = h("div.of-sbg");
  const kind = h("select.of-ssel", { "aria-label": "Background type" }, h("option", { value: "none" }, "None"), h("option", { value: "linear" }, "Linear gradient"), h("option", { value: "radial" }, "Radial gradient"), h("option", { value: "image" }, "Image"));
  const body = h("div.of-sbg__body");
  wrap.append(kind, body);
  let grad = null;
  let state = "computed";

  const commitGradient = (final = true) => (final ? ctx.commit : ctx.live)({ [def.prop]: E.formatGradient(grad) });
  kind.addEventListener("change", () => {
    if (kind.value === "none") return ctx.commit({ [def.prop]: "none" });
    if (kind.value === "image") {
      const assets = ctx.ws.web.paths.filter((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p));
      if (assets[0]) {
        const css = ctx.ws.ensureStylesheet(ctx.ws.page);
        return ctx.commit({ [def.prop]: `url("${E.relativeRef(css, assets[0])}")`, "background-size": "cover", "background-position": "center" });
      }
      return ctx.ws.app.toast("Upload an image in the Assets pane first.", "warning", 2200);
    }
    grad = { kind: kind.value, angle: 135, stops: [{ color: "#8b7cf6", pos: 0 }, { color: "#38bdf8", pos: 100 }] };
    commitGradient();
  });

  function drawGradient() {
    empty(body);
    if (!grad) return;
    const preview = h("div.of-sbg__preview", { style: { backgroundImage: E.formatGradient(grad) } });
    body.append(preview);
    if (grad.kind === "linear") {
      const ang = h("input.of-slen__num.wide", { type: "text", value: fmtNum(grad.angle ?? 180), "aria-label": "Angle in degrees", title: "Angle (deg)" });
      ang.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") ang.blur();
      });
      ang.addEventListener("change", () => {
        const n = parseFloat(ang.value);
        if (Number.isFinite(n)) {
          grad.angle = n;
          commitGradient();
        }
      });
      body.append(h("label.of-sbg__angle", h("span", "Angle"), ang, h("span", "°")));
    }
    grad.stops.forEach((s, i) => {
      const cf = colorField({ value: toHex8(s.color), alpha: true, label: "", onInput: (v) => {
        s.color = colorOut(v);
        preview.style.backgroundImage = E.formatGradient(grad);
        commitGradient(false);
      }, onChange: (v) => {
        s.color = colorOut(v);
        commitGradient();
      } });
      const pos = h("input.of-sbox__in", { type: "text", value: s.pos == null ? "" : fmtNum(s.pos), placeholder: "auto", "aria-label": "Stop position %", title: "Position (%)" });
      pos.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") pos.blur();
      });
      pos.addEventListener("change", () => {
        const n = parseFloat(pos.value);
        s.pos = Number.isFinite(n) ? n : null;
        commitGradient();
      });
      const del = h("button.of-attr__del", { type: "button", "aria-label": "Remove color stop", disabled: grad.stops.length <= 2, onclick: () => {
        grad.stops.splice(i, 1);
        commitGradient();
      } }, "×");
      body.append(h("div.of-sbg__stop", cf.el, pos, h("span", "%"), del));
    });
    body.append(h("button.of-btn", { type: "button", onclick: () => {
      grad.stops.push({ color: "#ffffff", pos: null });
      commitGradient();
    } }, h("sl-icon", { name: "plus-lg" }), "Add color stop"));
  }

  function drawImage(v) {
    empty(body);
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v);
    const assets = ctx.ws.web.paths.filter((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p));
    const css = ctx.ws.model.primaryStylesheet(ctx.ws.page) || "";
    const sel = h("select.of-ssel", assets.map((p) => h("option", { value: E.relativeRef(css || ctx.ws.page, p) }, p)));
    if (m) {
      if (![...sel.options].some((o) => o.value === m[1])) sel.append(h("option", { value: m[1] }, m[1]));
      sel.value = m[1];
    }
    sel.addEventListener("change", () => ctx.commit({ [def.prop]: `url("${sel.value}")` }));
    body.append(sel);
  }

  return {
    el: wrap,
    props: [def.prop],
    state: () => state,
    set(info) {
      const i = info(def.prop);
      state = i.state;
      const v = trimVal(i.value).replace(/\s*!important$/, "");
      if (wrap.contains(document.activeElement) && document.activeElement.matches("input")) return;
      grad = v && /gradient\(/.test(v) ? E.parseGradient(v) : null;
      if (grad) {
        kind.value = grad.kind === "radial" ? "radial" : "linear";
        drawGradient();
      } else if (/url\(/.test(v)) {
        kind.value = "image";
        drawImage(v);
      } else {
        kind.value = "none";
        empty(body);
      }
      wrap.classList.toggle("dim", i.state !== "set");
    },
  };
}
