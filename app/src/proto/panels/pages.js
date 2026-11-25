// The Pages panel of the Proto Studio (docs/concepts/proto-studio.md §5.3): the pages of the design (click to show,
// double-click or F2 to rename, Alt+Up/Down to reorder, Delete to delete; the last page stays) and the prototype
// flows of the current page (a click selects and shows the flow's start frame). A listbox with a roving tabindex.
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
    const k = [ws.page, m.pages, m.nodes, renaming];
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
    // flows of the current page (prototype starting points, T9 adds editing them)
    const fl = Array.isArray(m.pages[ws.page]?.flows) ? m.pages[ws.page].flows : [];
    flows.replaceChildren(
      ...(fl.length
        ? [
            h("div.of-proto-pages__sub", t("Flows")),
            ...fl.map((f) => {
              const b = h("button.of-proto-pages__flow", { type: "button" }, h("sl-icon", { name: "play-circle" }), f.name || t("Flow"));
              b.addEventListener("click", () => {
                if (m.nodes[f.start]) {
                  ws.select([f.start]);
                  ws.zoomToSelection();
                }
              });
              return b;
            }),
          ]
        : []),
    );
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

  return { el, render, addPage };
}
