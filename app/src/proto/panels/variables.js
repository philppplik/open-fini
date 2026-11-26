// The Variables panel of the Proto Studio (docs/concepts/proto-studio.md §5.3, task T6; dock id "proto-variables"): a
// collection as a table (rows are variables, columns are modes), with collections, brands (collections that extend a
// base and override some of its values), modes, aliases (a cell that points at another variable), scopes, code names,
// and tokens import and export (DTCG JSON; CSS custom properties, Tailwind v4 @theme and Swift export). Every edit is
// ONE operation through the workspace (one undo step); the logic is the pure panels/model.js.
//
//   createVariablesPanel(ws) → { el, render(force?) }
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import * as P from "./model.js";
import { menuPopover, openPopover, openVariablePicker } from "./binding.js";
import { SCOPES } from "../../engine/proto/variables.js";
import { promptDialog, confirmDialog } from "../../ui/dialogs.js";
import { platform } from "../../platform/index.js";

const TYPE_LABELS = { color: N_("Color"), number: N_("Number"), string: N_("Text"), bool: N_("Boolean") };
const TYPE_ICONS = { color: "palette2", number: "123", string: "type", bool: "check-square" };
const NEW_NAMES = { color: "color/new", number: "number/new", string: "text/new", bool: "flag/new" };
const SCOPE_LABELS = {
  all: N_("All fields"), fill: N_("Fill"), stroke: N_("Stroke"), effect: N_("Effects"), text: N_("Text color"), content: N_("Text content"), size: N_("Width and height"), gap: N_("Gap"), padding: N_("Padding"), radius: N_("Corner radius"), opacity: N_("Opacity"), fontSize: N_("Font size"), fontWeight: N_("Font weight"), lineHeight: N_("Line height"), letterSpacing: N_("Letter spacing"), font: N_("Font family"), visibility: N_("Visibility"), other: N_("Other"),
};
const EXPORTS = [
  ["dtcg", N_("Design tokens (DTCG JSON)")],
  ["css", N_("CSS custom properties")],
  ["tailwind", N_("Tailwind CSS (@theme)")],
  ["swift", N_("Swift")],
];

export function createVariablesPanel(ws) {
  const el = h("div.of-proto-vars", { role: "region", "aria-label": t("Variables") });
  const bar = h("div.of-proto-vars__bar");
  const table = h("div.of-proto-vars__table");
  el.append(bar, table);
  let coll = null; // the collection shown
  let query = "";
  let key = null;

  const apply = (op, label) => (op ? ws.apply(op, label) : null);
  const ibtn = (icon, label, onClick, { disabled = false, fld } = {}) => {
    const b = h("button.of-proto-design__ibtn", { type: "button", "aria-label": label, "data-tip": label, disabled, dataset: { field: fld || "" } }, h("sl-icon", { name: icon }));
    b.addEventListener("click", onClick);
    return b;
  };
  const ro = () => ws.readOnly;

  function render(force = false) {
    const m = ws.model();
    const k = [m.vars, m.styles, coll, query, ws.readOnly];
    if (!force && key && k.every((v, i) => v === key[i])) return;
    key = k;
    const colls = P.collectionsList(m);
    if (!colls.some((c) => c.id === coll)) coll = colls[0]?.id ?? null;
    const focus = el.contains(document.activeElement) ? document.activeElement.dataset?.field : null;
    renderBar(m, colls);
    renderTable(m);
    if (focus) el.querySelector(`[data-field="${CSS.escape(focus)}"]`)?.focus?.({ preventScroll: true });
  }

  // ------------------------------------------------------------------------------------------- bar
  function renderBar(m, colls) {
    const sel = h("select.of-proto-design__select.of-proto-vars__coll", { "aria-label": t("Collection"), dataset: { field: "collection" } });
    for (const c of colls) sel.append(h("option", { value: c.id, selected: c.id === coll }, `${"  ".repeat(c.depth)}${c.depth ? "↳ " : ""}${c.name} (${c.count})`));
    if (!colls.length) sel.append(h("option", { value: "", disabled: true, selected: true }, t("No collections")));
    sel.addEventListener("change", () => {
      coll = sel.value || null;
      render(true);
    });
    const cur = colls.find((c) => c.id === coll);
    const search = h("input.of-proto-vars__search", { type: "search", value: query, placeholder: t("Search variables"), "aria-label": t("Search variables"), dataset: { field: "search" }, spellcheck: false });
    search.addEventListener("input", () => {
      query = search.value;
      renderTable(ws.model());
    });
    search.addEventListener("keydown", (e) => e.stopPropagation());
    bar.replaceChildren(
      sel,
      ibtn("plus-lg", t("New collection"), () => newCollection(), { disabled: ro(), fld: "new-collection" }),
      ibtn("three-dots", t("Collection actions"), (e) =>
        menuPopover(e.currentTarget, [
          { label: t("New brand of this collection…"), icon: "layers-half", disabled: ro() || !cur, run: () => newBrand(cur) },
          { label: t("Rename collection…"), icon: "input-cursor-text", disabled: ro() || !cur, run: () => renameCollection(cur) },
          { label: t("Add mode"), icon: "plus-lg", disabled: ro() || !cur || !!cur?.extends, run: () => addMode(cur) },
          { label: t("Delete collection"), icon: "trash", danger: true, disabled: ro() || !cur, run: () => deleteCollection(cur) },
          "-",
          { label: t("Import tokens (DTCG JSON)…"), icon: "box-arrow-in-down", disabled: ro(), run: () => importTokens() },
          ...EXPORTS.map(([f, label]) => ({ label: t("Export: {format}", { format: t(label) }), icon: "download", run: () => exportTokens(f) })),
        ], { label: t("Collection actions") }), { fld: "collection-menu" }),
      search,
    );
  }

  async function newCollection() {
    const m = ws.model();
    const name = await promptDialog({ title: t("New collection"), label: t("Name"), value: P.uniqueName(P.collectionsList(m).map((c) => c.name), t("Colors")), ok: t("Create") });
    if (!name?.trim()) return;
    const res = apply({ op: "collection.create", name: name.trim().slice(0, 256), modes: [{ name: t("Light") }, { name: t("Dark") }] }, t("New collection"));
    if (res?.ids?.[0]) {
      coll = res.ids[0];
      render(true);
    }
  }
  async function newBrand(cur) {
    const name = await promptDialog({ title: t("New brand"), label: t("Name"), value: P.uniqueName(P.collectionsList(ws.model()).map((c) => c.name), t("{name} brand", { name: cur.name })), ok: t("Create") });
    if (!name?.trim()) return;
    const res = apply({ op: "collection.create", name: name.trim().slice(0, 256), extends: cur.id }, t("New brand"));
    if (res?.ids?.[0]) {
      coll = res.ids[0];
      render(true);
    }
  }
  async function renameCollection(cur) {
    const name = await promptDialog({ title: t("Rename collection"), label: t("Name"), value: cur.name, ok: t("Rename") });
    if (name?.trim() && name.trim() !== cur.name) apply({ op: "collection.update", id: cur.id, set: { name: name.trim().slice(0, 256) } }, t("Rename collection"));
  }
  async function addMode(cur) {
    const name = await promptDialog({ title: t("Add mode"), label: t("Name"), value: P.uniqueName(cur.modes.map((x) => x.name), t("Mode")), ok: t("Add") });
    if (name?.trim()) apply({ op: "mode.create", coll: cur.id, name: name.trim().slice(0, 256) }, t("Add mode"));
  }
  async function deleteCollection(cur) {
    const ok = await confirmDialog({ title: t("Delete collection"), message: t("Delete “{name}” and its {n} variables? Layers that use them keep their current values.", { name: cur.name, n: cur.count }), ok: t("Delete"), danger: true });
    if (ok) apply({ op: "collection.delete", id: cur.id, detach: true }, t("Delete collection"));
  }

  // ------------------------------------------------------------------------------------------- import and export
  async function importTokens() {
    const files = await platform.openFiles({ accept: [{ description: t("Design tokens"), extensions: ["json", "tokens"] }] });
    const f = files?.[0];
    if (!f) return;
    let json;
    try {
      json = JSON.parse(new TextDecoder().decode(f.bytes));
    } catch {
      return ws.app?.toast?.(t("The file is not JSON."), "warning", 4000);
    }
    const cur = P.collectionsList(ws.model()).find((c) => c.id === coll);
    const res = apply({ op: "tokens.import", tokens: json, ...(cur && !cur.extends ? { collection: cur.name } : {}) }, t("Import tokens"));
    const r = res?.report;
    if (r) ws.app?.toast?.(t("Tokens imported: {c} new, {u} updated, {s} styles, {k} skipped.", { c: r.created, u: r.updated, s: r.styles, k: r.skipped.length }), r.skipped.length ? "warning" : "success", 5000);
  }
  async function exportTokens(format) {
    const out = P.tokenExport(ws.model(), format);
    const ext = out.name.split(".").pop();
    try {
      await platform.saveFile({ suggestedName: out.name, bytes: new TextEncoder().encode(out.text), mime: out.mime, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    } catch (e) {
      ws.app?.toast?.(e?.message || String(e), "warning", 4000);
    }
  }

  // ------------------------------------------------------------------------------------------- table
  function renderTable(m) {
    const tb = coll ? P.variableTable(m, coll, { query }) : null;
    if (!tb) {
      table.replaceChildren(...[h("p.of-proto-vars__empty", t("No variables yet. Create a collection, then add colors, numbers, text and booleans; bind them to fields with the hexagon button in the Design panel.")), ro() ? null : h("div.of-proto-vars__foot", textBtn("plus-lg", t("New collection"), () => newCollection(), "new-collection-2"))].filter(Boolean));
      return;
    }
    const brand = !!tb.base;
    const cols = `minmax(140px, 1.4fr) repeat(${tb.modes.length}, minmax(120px, 1fr)) 28px`;
    const grid = h("div.of-proto-vars__grid", { role: "grid", "aria-label": t("Variables of {name}", { name: tb.name }), style: `grid-template-columns:${cols}` });
    grid.append(h("div.of-proto-vars__th", { role: "columnheader" }, t("Name")));
    for (const md of tb.modes) grid.append(modeHeader(tb, md, brand));
    grid.append(h("div.of-proto-vars__th", { role: "columnheader", "aria-label": t("Actions") }));
    for (const r of tb.rows) {
      grid.append(nameCell(tb, r));
      for (const c of r.cells) grid.append(valueCell(tb, r, c));
      grid.append(h("div.of-proto-vars__td", { role: "gridcell" }, ibtn("three-dots", t("Variable actions"), (e) => rowMenu(e.currentTarget, tb, r), { fld: `row.${r.id}` })));
    }
    const foot = ro() || brand ? null : h("div.of-proto-vars__foot", ...Object.keys(TYPE_LABELS).map((type) => textBtn(TYPE_ICONS[type], t("Add {type}", { type: t(TYPE_LABELS[type]).toLowerCase() }), () => addVariable(tb, type), `add.${type}`)));
    const note = brand ? h("p.of-proto-vars__note", t("“{name}” extends “{base}”: a value you change here overrides the base for this brand only.", { name: tb.name, base: P.collectionsList(m).find((c) => c.id === tb.base)?.name || "" })) : null;
    table.replaceChildren(...[note, tb.rows.length ? grid : h("p.of-proto-vars__empty", query ? t("No variables match.") : t("This collection has no variables yet.")), foot].filter(Boolean));
  }

  const textBtn = (icon, label, onClick, fld) => {
    const b = h("button.of-proto-design__tbtn", { type: "button", disabled: ro(), dataset: { field: fld } }, h("sl-icon", { name: icon }), h("span", label));
    b.addEventListener("click", onClick);
    return b;
  };

  function modeHeader(tb, md, brand) {
    const isDefault = tb.default === md.id;
    const name = h("input.of-proto-vars__mode", { type: "text", value: md.name, "aria-label": t("Mode name"), disabled: ro() || brand, dataset: { field: `mode.${md.id}` }, spellcheck: false });
    name.addEventListener("change", () => (name.value.trim() && name.value.trim() !== md.name ? apply({ op: "mode.update", coll: tb.coll, id: md.id, name: name.value.trim().slice(0, 256) }, t("Rename mode")) : (name.value = md.name)));
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
    });
    const menu = ibtn(isDefault ? "star-fill" : "chevron-down", isDefault ? t("Default mode") : t("Mode actions"), (e) =>
      menuPopover(e.currentTarget, [
        { label: t("Make default"), icon: "star", disabled: ro() || isDefault, run: () => apply({ op: "collection.update", id: tb.coll, set: { default: md.id } }, t("Default mode")) },
        { label: t("Delete mode"), icon: "trash", danger: true, disabled: ro() || brand || tb.modes.length < 2, run: () => apply({ op: "mode.delete", coll: tb.coll, id: md.id }, t("Delete mode")) },
      ], { label: md.name }), { fld: `modemenu.${md.id}` });
    return h("div.of-proto-vars__th", { role: "columnheader" }, name, menu);
  }

  function nameCell(tb, r) {
    const name = h("input.of-proto-vars__name", { type: "text", value: r.name, "aria-label": t("Variable name"), disabled: ro() || !r.own, title: r.css, dataset: { field: `name.${r.id}` }, spellcheck: false });
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v && v !== r.name) apply({ op: "var.update", id: r.id, set: { name: v.slice(0, 256) } }, t("Rename variable"));
      else name.value = r.name;
    });
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
    });
    return h("div.of-proto-vars__td.of-proto-vars__namecell", { role: "rowheader" }, h("sl-icon", { name: TYPE_ICONS[r.type], "aria-label": t(TYPE_LABELS[r.type]) }), name, r.scopes.length && !r.scopes.includes("all") ? h("sl-icon.of-proto-vars__scoped", { name: "filter", "aria-label": t("Scoped"), title: r.scopes.map((s) => t(SCOPE_LABELS[s] || s)).join(", ") }) : null);
  }

  function valueCell(tb, r, c) {
    const fld = `cell.${r.id}.${c.mode}`;
    const set = (v) => apply(P.cellOp(ws.model(), tb.coll, r.id, c.mode, v), t("Edit variable"));
    const cell = h(`div.of-proto-vars__td.of-proto-vars__cell${c.override ? ".is-override" : ""}${c.inherited ? ".is-inherited" : ""}`, { role: "gridcell" });
    const more = ibtn("hexagon", t("Alias"), (e) => cellMenu(e.currentTarget, tb, r, c), { fld: `${fld}:menu` });
    if (c.alias) {
      const chip = h("button.of-proto-bound", { type: "button", disabled: ro(), "aria-label": t("Alias of {name}. Change", { name: P.varLabel(ws.model(), c.alias) }), dataset: { field: fld } }, r.type === "color" ? h("span.of-proto-swatch", { style: `--of-sw:${c.value}` }) : null, h("span", P.varLabel(ws.model(), c.alias)));
      chip.addEventListener("click", () => pickAlias(chip, tb, r, c));
      cell.append(chip, more);
      return cell;
    }
    if (r.type === "bool") {
      const cb = h("input", { type: "checkbox", checked: !!c.value, disabled: ro(), "aria-label": `${r.name} · ${c.mode}`, dataset: { field: fld } });
      cb.addEventListener("change", () => set(cb.checked));
      cell.append(cb, more);
      return cell;
    }
    if (r.type === "color") {
      const pick = h("input.of-proto-vars__swatch", { type: "color", value: /^#[0-9a-f]{6}/i.test(c.value || "") ? c.value.slice(0, 7) : "#000000", disabled: ro(), "aria-label": t("Pick color"), tabIndex: -1 });
      pick.addEventListener("change", () => set(pick.value + (typeof c.value === "string" && c.value.length === 9 ? c.value.slice(7) : "")));
      cell.append(pick);
    }
    const input = h("input.of-proto-vars__val", { type: "text", value: P.formatValue(r.type, c.value), disabled: ro(), "aria-label": `${r.name} · ${c.mode}`, dataset: { field: fld }, spellcheck: false });
    input.addEventListener("change", () => {
      const v = P.parseCell(r.type, input.value);
      if (v === undefined) {
        input.value = P.formatValue(r.type, c.value);
        return ws.app?.toast?.(r.type === "color" ? t("Use a hex color such as #4f46e5.") : t("Use a number."), "warning", 3000);
      }
      set(v);
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") input.blur();
    });
    cell.append(...[input, r.type === "number" && r.unit ? h("span.of-proto-vars__unit", r.unit) : null, more].filter(Boolean));
    return cell;
  }

  function pickAlias(anchor, tb, r, c) {
    openVariablePicker(ws, anchor, { type: r.type, current: c.alias, exclude: r.id, title: t("Alias of"), onPick: (id) => apply(P.cellOp(ws.model(), tb.coll, r.id, c.mode, id ? { $var: id } : c.value), id ? t("Set alias") : t("Detach alias")) });
  }

  function cellMenu(anchor, tb, r, c) {
    menuPopover(anchor, [
      { label: t("Alias to another variable…"), icon: "hexagon", disabled: ro(), run: () => pickAlias(anchor, tb, r, c) },
      c.alias ? { label: t("Detach alias"), icon: "scissors", disabled: ro(), run: () => apply(P.cellOp(ws.model(), tb.coll, r.id, c.mode, c.value), t("Detach alias")) } : null,
      c.override ? { label: t("Reset to the base value"), icon: "arrow-counterclockwise", disabled: ro(), run: () => apply(P.resetCellOp(ws.model(), tb.coll, r.id, c.mode), t("Reset to base")) } : null,
    ], { label: r.name });
  }

  function rowMenu(anchor, tb, r) {
    menuPopover(anchor, [
      { label: t("Scopes…"), icon: "filter", disabled: ro() || !r.own, run: () => scopes(anchor, r) },
      { label: t("Code name…"), icon: "braces", disabled: ro() || !r.own, run: () => codeName(r) },
      { label: t("Copy CSS name"), icon: "copy", run: () => navigator.clipboard?.writeText(`var(${r.css})`).catch(() => {}) },
      "-",
      { label: t("Delete variable"), icon: "trash", danger: true, disabled: ro() || !r.own, run: () => deleteVariable(r) },
    ], { label: r.name });
  }

  function scopes(anchor, r) {
    const cur = new Set(r.scopes.length ? r.scopes : ["all"]);
    const list = h("div.of-proto-pop__list.of-proto-vars__scopes", { role: "group", "aria-label": t("Scopes") });
    for (const s of SCOPES) {
      const cb = h("input", { type: "checkbox", checked: cur.has(s), dataset: { scope: s } });
      cb.addEventListener("change", () => {
        if (s === "all" && cb.checked) for (const x of list.querySelectorAll("input")) x.checked = x.dataset.scope === "all";
        else if (cb.checked) list.querySelector('input[data-scope="all"]').checked = false;
      });
      list.append(h("label.of-proto-pop__check", cb, h("span", t(SCOPE_LABELS[s] || s))));
    }
    const ok = h("button.of-proto-design__tbtn", { type: "button" }, h("span", t("Apply")));
    const pop = openPopover(anchor, h("div.of-proto-pop__body", h("div.of-proto-pop__title", t("Where “{name}” can be used", { name: r.name })), list, ok), { label: t("Scopes") });
    ok.addEventListener("click", () => {
      const picked = [...list.querySelectorAll("input:checked")].map((x) => x.dataset.scope);
      pop.close(true);
      const next = !picked.length || picked.includes("all") ? null : picked;
      apply(next ? { op: "var.update", id: r.id, set: { scopes: next } } : { op: "var.update", id: r.id, unset: ["scopes"] }, t("Variable scopes"));
    });
    list.querySelector("input")?.focus();
  }

  async function codeName(r) {
    const v = await promptDialog({ title: t("Code name"), label: t("CSS custom property (empty: from the name)"), value: r.codeCss || "", ok: t("Save") });
    if (v == null) return;
    const s = v.trim();
    if (s && !/^--[A-Za-z0-9_-]+$/.test(s)) return ws.app?.toast?.(t("Use a CSS custom property name such as --color-brand."), "warning", 4000);
    const item = ws.model().vars?.items?.[r.id];
    const code = { ...(item?.code || {}) };
    if (s) code.css = s;
    else delete code.css;
    apply(Object.keys(code).length ? { op: "var.update", id: r.id, set: { code } } : { op: "var.update", id: r.id, unset: ["code"] }, t("Code name"));
  }

  async function deleteVariable(r) {
    const refs = Object.values(ws.model().nodes).some((n) => JSON.stringify(n).includes(`"$var":"${r.id}"`));
    if (refs && !(await confirmDialog({ title: t("Delete variable"), message: t("“{name}” is in use. Layers that use it keep its current value.", { name: r.name }), ok: t("Delete"), danger: true }))) return;
    apply({ op: "var.delete", ids: [r.id], detach: true }, t("Delete variable"));
  }

  function addVariable(tb, type) {
    const m = ws.model();
    const names = Object.values(m.vars?.items || {}).filter((v) => v.coll === tb.coll).map((v) => v.name);
    const res = apply({ op: "var.create", coll: tb.coll, type, name: P.uniqueName(names, NEW_NAMES[type]), ...(type === "color" ? { value: "#6366f1" } : type === "number" ? { value: 8, unit: "px" } : {}) }, t("New variable"));
    if (res?.ids?.[0]) requestAnimationFrame(() => el.querySelector(`[data-field="name.${CSS.escape(res.ids[0])}"]`)?.select?.());
  }

  render(true);
  return {
    el,
    render,
    /** Shows a collection (the Design panel's binding picker and the assistant can point here). */
    show(id) {
      coll = id;
      render(true);
    },
  };
}
