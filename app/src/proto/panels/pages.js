// The Pages panel of the Proto Studio (docs/concepts/proto-studio.md §5.3): the pages of the design (click to show,
// double-click or F2 to rename, Alt+Up/Down to reorder, Delete to delete; the last page stays) and the prototype
// flows of the current page (play, a click shows the start frame, double-click renames, add and delete). A listbox with a roving tabindex.
// Every change is one operation (one undo step).
//
//   createPagesPanel(ws) → { el, render(force?) }
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconButton } from "../../ui/controls.js";
import { pageList } from "../../engine/proto/tree.js";

export function createPagesPanel(ws) {
  const add = iconButton({ icon: "plus-lg", label: "Add page", onClick: () => addPage() });
  const list = h("div.of-proto-pages__list", { role: "listbox", "aria-label": t("Pages") });
  const flows = h("div.of-proto-pages__flows");
  const el = h("div.of-proto-pages", h("div.of-proto-pages__bar", h("span", t("Pages")), add), list, flows);
  let key = null;
  let renaming = null;
  let renamingFlow = null;

  const model = () => ws.model();

  function addPage() {
    if (ws.readOnly) return;
    const n = pageList(model()).length + 1;
    const res = ws.apply({ op: "page.create", name: t("Page {n}", { n }) }, t("Add page"));
    const id = res?.ids?.[0];
    if (id) ws.setPage(id);
  }

  function render(force = false) {
    const m = model();
    const k = [ws.page, m.pages, m.nodes, renaming, renamingFlow, ws.readOnly];
    if (!force && key && k.every((v, i) => v === key[i])) return;
    key = k;
    add.disabled = ws.readOnly;
    const pages = pageList(m);
    const hadFocus = list.contains(document.activeElement);
    list.replaceChildren(
      ...pages.map((p) => {
        const on = p.id === ws.page;
        const label = renaming === p.id ? renameInput(p) : h("span.of-proto-pages__name", p.name || t("Page"));
        const del = pages.length > 1 && !ws.readOnly ? h("button.of-proto-pages__del", { type: "button", tabIndex: -1, "aria-label": t("Delete page"), "data-tip": t("Delete page"), dataset: { act: "delete" } }, h("sl-icon", { name: "trash" })) : null;
        const row = h("div.of-proto-pages__row", { role: "option", tabIndex: on ? 0 : -1, "aria-selected": String(on), dataset: { id: p.id } }, h("sl-icon", { name: on ? "file-earmark-check" : "file-earmark" }), label, del);
        if (on) row.classList.add("is-current");
        return row;
      }),
    );
    if (hadFocus && !renaming) list.querySelector(".is-current")?.focus({ preventScroll: true });
    // flows of the current page: prototype starting points (play, show the start frame, rename, delete, add)
    const fl = Array.isArray(m.pages[ws.page]?.flows) ? m.pages[ws.page].flows : [];
    const addFlow = h("button.of-proto-pages__addflow", { type: "button", "aria-label": t("Add flow"), "data-tip": t("Add flow"), disabled: ws.readOnly }, h("sl-icon", { name: "plus-lg" }));
    addFlow.addEventListener("click", () => createFlow());
    flows.replaceChildren(
      h("div.of-proto-pages__sub", h("span", t("Flows")), addFlow),
      ...fl.map((f) => {
        const play = h("button.of-proto-pages__play", { type: "button", "aria-label": t("Play {name}", { name: f.name || t("Flow") }), "data-tip": t("Play this flow") }, h("sl-icon", { name: "play-circle" }));
        play.addEventListener("click", () => ws.play?.({ flow: f.id }));
        const name = renamingFlow === f.id ? flowRename(f) : h("button.of-proto-pages__flow", { type: "button", title: m.nodes[f.start]?.name || "" }, h("sl-icon", { name: "signpost-split" }), f.name || t("Flow"));
        if (renamingFlow !== f.id) {
          name.addEventListener("click", () => {
            if (m.nodes[f.start]) {
              ws.select([f.start]);
              ws.zoomToSelection();
            }
          });
          name.addEventListener("dblclick", () => {
            if (ws.readOnly) return;
            renamingFlow = f.id;
            render(true);
          });
        }
        const del = h("button.of-proto-pages__del", { type: "button", "aria-label": t("Delete flow"), "data-tip": t("Delete flow"), disabled: ws.readOnly }, h("sl-icon", { name: "trash" }));
        del.addEventListener("click", () => ws.apply({ op: "flow.delete", page: ws.page, id: f.id }, t("Delete flow")));
        return h("div.of-proto-pages__flowrow", play, name, del);
      }),
      ...(fl.length ? [] : [h("p.of-proto-pages__hint", t("No flows yet. A flow starts the prototype at a frame."))]),
    );
  }

  /** Adds a flow that starts at the selected layer's frame, else at the first frame of the page. */
  function createFlow() {
    if (ws.readOnly) return;
    const m = model();
    let start = ws.selection[0] ? m.nodes[ws.selection[0]] : null;
    while (start && start.parent != null) start = m.nodes[start.parent];
    if (!start) start = Object.values(m.nodes).filter((n) => n.page === ws.page && n.parent == null && n.type === "frame").sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))[0];
    if (!start) return ws.app?.toast?.(t("Add a frame first: a flow starts at a frame."), "warning", 3000);
    const n = (m.pages[ws.page]?.flows || []).length + 1;
    ws.apply({ op: "flow.create", start: start.id, page: ws.page, name: t("Flow {n}", { n }) }, t("Add flow"));
  }

  function flowRename(f) {
    const input = h("input.of-proto-pages__rename", { type: "text", value: f.name || "", "aria-label": t("Flow name"), spellcheck: false });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renamingFlow = null;
      const v = input.value.trim();
      if (commit && v && v !== f.name) ws.apply({ op: "flow.update", page: ws.page, id: f.id, set: { name: v } }, t("Rename flow"));
      render(true);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  function renameInput(p) {
    const input = h("input.of-proto-pages__rename", { type: "text", value: p.name || "", "aria-label": t("Page name"), spellcheck: false });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = null;
      const v = input.value.trim();
      if (commit && v && v !== p.name) ws.apply({ op: "page.update", id: p.id, set: { name: v.slice(0, 256) } }, t("Rename page"));
      render(true);
      list.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.focus({ preventScroll: true });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  const rename = (id) => {
    if (ws.readOnly) return;
    renaming = id;
    render(true);
  };
  const remove = (id) => {
    if (ws.readOnly || pageList(model()).length < 2) return;
    const pages = pageList(model());
    const i = pages.findIndex((p) => p.id === id);
    const next = pages[i + 1] || pages[i - 1];
    if (id === ws.page && next) ws.setPage(next.id);
    ws.apply({ op: "page.delete", id }, t("Delete page"));
  };

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".of-proto-pages__row");
    if (!row || e.target.closest(".of-proto-pages__rename")) return;
    if (e.target.closest("[data-act=delete]")) return remove(row.dataset.id);
    ws.setPage(row.dataset.id);
  });
  list.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".of-proto-pages__row");
    if (row && !e.target.closest("[data-act]")) rename(row.dataset.id);
  });
  list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".of-proto-pages__row");
    if (!row || e.target.closest(".of-proto-pages__rename")) return;
    const pages = pageList(model());
    const i = pages.findIndex((p) => p.id === row.dataset.id);
    let handled = true;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const j = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (j >= 0 && j < pages.length && !ws.readOnly) ws.apply({ op: "page.move", id: row.dataset.id, index: j }, t("Move page"));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const next = pages[Math.max(0, Math.min(pages.length - 1, e.key === "ArrowUp" ? i - 1 : i + 1))];
      if (next) ws.setPage(next.id);
      render(true);
      list.querySelector(".is-current")?.focus();
    } else if (e.key === "F2" || e.key === "Enter") rename(row.dataset.id);
    else if (e.key === "Delete") remove(row.dataset.id);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return { el, render, addPage, addFlow: createFlow };
}
