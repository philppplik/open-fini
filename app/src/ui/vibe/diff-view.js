// The "Review changes" drawer of Vibe Studio: what one tool call or a whole run changed, per file (unified or
// side-by-side text diff with per-change-block revert), per layer (property list, select, revert) and for Office
// documents (paragraph diff). Built from change sets of change-recorder.js / changes.js. Loaded lazily.
//
// Public API: openChangesDialog(vs, { title, set, doc, runId?, focus? }) and changeSummaryList(set) (compact list).
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { openDialog } from "../dialogs.js";
import { renderDiff } from "../code/git-diff.js";
import { describeLayerChange, canRevertLayer, textBlocks, typeLabel } from "./changes.js";
import { getChangeRecorder } from "./change-recorder.js";
import { layerIcon } from "./layer-icons.js";

const KIND_LABEL = { added: "added", removed: "deleted", modified: "modified" };

/** Compact, non-interactive list of what a set changed (run summary card). */
export function changeSummaryList(set, max = 6) {
  const items = [];
  for (const f of set.files) items.push(h("li", iconEl("file-earmark-diff"), h("span.of-vdiff__path", f.path), h("span.of-vdiff__stat", f.binary ? t("binary") : f.tooLarge ? t("large") : `+${f.add} −${f.del}`)));
  for (const c of set.layers) items.push(h("li", iconEl(layerIcon(c.type)), h("span", describeLayerChange(c))));
  if (set.office) items.push(h("li", iconEl("file-earmark-text"), h("span", t("Document text: {n} paragraph(s) changed", { n: String(set.office.add + set.office.del) }))));
  const more = items.length - max;
  return h("ul.of-vdiff__mini", items.slice(0, max), more > 0 ? h("li.of-vdiff__more", t("+{n} more", { n: String(more) })) : null);
}

export function openChangesDialog(vs, { title, set, doc, runId = null, focus = null }) {
  const { app } = vs;
  const rec = getChangeRecorder(app, vs.hub);
  const tabs = [];
  for (const f of set.files) tabs.push({ id: `f:${f.path}`, icon: "file-earmark-diff", label: f.path, badge: f.binary ? t("binary") : `+${f.add} −${f.del}`, render: () => fileView(f) });
  if (set.layers.length) tabs.push({ id: "layers", icon: "layers", label: t("Layers"), badge: String(set.layers.length), render: layersView });
  if (set.office) tabs.push({ id: "office", icon: "file-earmark-text", label: t("Document text"), badge: `+${set.office.add} −${set.office.del}`, render: officeView });
  let cur = tabs.find((x) => x.id === focus)?.id || tabs[0]?.id;
  let mode = "unified";

  const nav = h("div.of-vdiff__tabs", { role: "tablist", "aria-label": t("Changed items") });
  const body = h("div.of-vdiff__body", { role: "tabpanel", tabindex: "-1" });
  const status = h("div.of-sr-only", { role: "status", "aria-live": "polite" });
  const say = (msg, kind = "success") => {
    status.textContent = msg;
    app.toast(msg, kind, 1800);
  };
  const fail = (err) => app.toast(err?.message || String(err), "warning", 4000);

  function paintNav() {
    empty(nav);
    for (const tb of tabs) {
      const b = h("button.of-vdiff__tab", { type: "button", role: "tab", "aria-selected": String(tb.id === cur), tabindex: tb.id === cur ? "0" : "-1", title: tb.label }, iconEl(tb.icon), h("span.of-vdiff__tabname", tb.label), h("small", tb.badge));
      b.addEventListener("click", () => {
        cur = tb.id;
        paint();
      });
      b.addEventListener("keydown", (e) => {
        const i = tabs.indexOf(tb);
        const j = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
        if (j == null) return;
        e.preventDefault();
        cur = tabs[(j + tabs.length) % tabs.length].id;
        paint();
        nav.querySelector('[aria-selected="true"]')?.focus();
      });
      nav.append(b);
    }
  }
  function paint() {
    paintNav();
    empty(body);
    const tb = tabs.find((x) => x.id === cur);
    if (!tb) return body.append(h("div.of-empty", t("No changes were recorded.")));
    body.append(tb.render());
  }

  function fileView(f) {
    const head = h("div.of-vdiff__head", h("strong.of-vdiff__path", f.path), h("span.of-vdiff__kind", { class: f.kind }, t(KIND_LABEL[f.kind])), h("span.of-vdiff__stat", f.binary ? "" : `+${f.add} −${f.del}`));
    const wrap = h("div.of-vdiff__file", head);
    if (f.binary) {
      wrap.append(h("div.of-empty", t("Binary file (image, font or other data): its contents cannot be shown as text.")));
      return wrap;
    }
    const toggle = h("div.of-vdiff__mode", { role: "group", "aria-label": t("Diff layout") }, ...[["unified", t("Unified")], ["split", t("Side by side")]].map(([m, label]) => h("button.of-btn.of-btn--sm", { type: "button", "aria-pressed": String(mode === m), onclick: () => { mode = m; paint(); } }, label)));
    const revertAll = h("button.of-btn.of-btn--sm", { type: "button", onclick: async () => { try { await rec.revertFile(doc, f); say(f.kind === "added" ? t("Removed {path}.", { path: f.path }) : t("Restored {path}.", { path: f.path })); } catch (err) { fail(err); } } }, iconEl("arrow-counterclockwise"), f.kind === "added" ? t("Remove this file") : t("Revert this file"));
    head.append(toggle, revertAll);
    if (f.tooLarge) {
      wrap.append(h("div.of-empty", t("This file is too large to diff here (+{add} −{del} lines). You can still revert it.", { add: String(f.add), del: String(f.del) })));
      return wrap;
    }
    const blocks = f.kind === "modified" ? textBlocks(f.before, f.after) : [];
    if (blocks.length > 1) {
      const list = h("div.of-vdiff__hunks", h("span", t("Change blocks:")));
      blocks.slice(0, 30).forEach((b, k) => {
        const where = b.bLen ? t("lines {from}–{to}", { from: String(b.bStart + 1), to: String(b.bStart + b.bLen) }) : t("after line {n}", { n: String(b.bStart) });
        list.append(h("button.of-btn.of-btn--sm", { type: "button", title: t("Revert only this change block"), onclick: async () => { try { await rec.revertHunk(doc, f, k); say(t("Reverted one change block.")); paint(); } catch (err) { fail(err); } } }, iconEl("arrow-counterclockwise"), `${k + 1}: ${where}`));
      });
      wrap.append(list);
    }
    wrap.append(renderDiff({ oldText: f.before ?? "", newText: f.after ?? "" }, mode));
    return wrap;
  }

  function layersView() {
    const wrap = h("div.of-vdiff__layers");
    if (runId) {
      const pair = h("div.of-vdiff__thumbs");
      const r = rec.run(runId);
      const before = r?.beforeThumb;
      rec.afterThumb(runId).then((after) => {
        if (!before && !after) return;
        pair.append(
          h("figure", before ? h("img", { src: before, alt: t("Page before the run") }) : h("div.of-empty", "—"), h("figcaption", t("Before"))),
          h("figure", after ? h("img", { src: after, alt: t("Page now") }) : h("div.of-empty", "—"), h("figcaption", t("After"))),
        );
      });
      wrap.append(pair);
    }
    const list = h("ul.of-vdiff__layerlist");
    for (const c of set.layers.slice(0, 300)) {
      const sel = h("button.of-btn.of-btn--sm", { type: "button", disabled: c.kind === "removed", onclick: () => { const n = doc.find(c.id); if (!n) return fail(new Error(t("This layer no longer exists."))); if (app.doc !== doc) app.activateDoc(doc); if (n._page && n._page !== app.page) app.setActivePage(n._page); app.select([n]); } }, t("Select"));
      const rv = h("button.of-btn.of-btn--sm", { type: "button", disabled: !canRevertLayer(c), title: canRevertLayer(c) ? t("Restore this layer as it was before (one undo step)") : t("Pixel and very large changes cannot be reverted per layer: use “Undo this run”."), onclick: () => { try { rec.revertLayer(doc, c); say(t("Reverted {name}.", { name: c.name || typeLabel(c.type) })); rv.disabled = true; } catch (err) { fail(err); } } }, iconEl("arrow-counterclockwise"), t("Revert"));
      list.append(h("li.of-vdiff__layer", { class: c.kind }, iconEl(layerIcon(c.type)), h("span", describeLayerChange(c)), h("span.of-vdiff__acts", sel, rv)));
    }
    if (set.layers.length > 300) list.append(h("li.of-vdiff__more", t("+{n} more", { n: String(set.layers.length - 300) })));
    wrap.append(list);
    return wrap;
  }

  function officeView() {
    const o = set.office;
    const wrap = h("div.of-vdiff__office");
    const revert = h("button.of-btn.of-btn--sm", { type: "button", onclick: () => { try { rec.revertOffice(doc, o); say(t("Restored the document text.")); } catch (err) { fail(err); } } }, iconEl("arrow-counterclockwise"), t("Revert document text"));
    wrap.append(h("div.of-vdiff__head", h("strong", t("Paragraphs")), h("span.of-vdiff__stat", `+${o.add} −${o.del}`), revert));
    const rows = h("div.of-gdiff", { role: "table", "aria-label": t("Paragraph changes") });
    let skipped = 0;
    o.rows.forEach((r, i) => {
      const near = o.rows.slice(Math.max(0, i - 1), i + 2).some((x) => x.t !== "ctx");
      if (r.t === "ctx" && !near) return void skipped++;
      if (skipped) rows.append(h("div.of-gdiff__row.of-gdiff__skipnote", t("{n} unchanged paragraph(s)", { n: String(skipped) })));
      skipped = 0;
      rows.append(h("div.of-gdiff__row", { class: `of-gdiff__${r.t}`, role: "row" }, h("span.of-gdiff__sign", r.t === "add" ? "+" : r.t === "del" ? "−" : " "), h("span.of-gdiff__text", r.text || " ")));
    });
    if (skipped) rows.append(h("div.of-gdiff__row.of-gdiff__skipnote", t("{n} unchanged paragraph(s)", { n: String(skipped) })));
    wrap.append(rows);
    return wrap;
  }

  const buttons = [];
  if (runId) {
    buttons.push({ label: "Undo this run", onClick: (close) => { const s = vs.hub.sessions?.get(rec.run(runId)?.sessionId) || vs.session; const last = s.runs?.[s.runs.length - 1]; if (!last || last.run !== runId) return fail(new Error(t("Only the newest run of a chat can be undone in one step. Revert single items instead."))); const n = s.undoLastRun(); if (n) { say(t("Undid {n} step(s).", { n: String(n) })); close(); } else fail(new Error(s.lastUndoError || t("Nothing to undo."))); } });
  }
  buttons.push({ label: "Close", variant: "primary", onClick: (c) => c() });
  paint();
  openDialog({ title: title || "Changes", body: h("div.of-vdiff", nav, body, status), width: 1040, cls: "of-vdiff-dialog", buttons });
}
