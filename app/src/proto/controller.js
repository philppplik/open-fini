// Editing controller of the Proto Studio: selection, the current page, and operations as undo steps. Pure (no DOM,
// no app): the workspace (proto/workspace.js) wires it to the document's history and the view; tests drive it with a
// plain model. The tools of T4, the assistant and collaboration change the model only through `run`.
//
//   createController({ model, commit, emit?, page? }) → controller
//     model()                     the current Proto model
//     commit(step, label)         records a step (see opStep) as one undo step and applies `step.after`
//     emit(event, detail)         "selection" | "page"
//
//   controller.page / setPage(id)                         the page shown (a page id of the model)
//   controller.selection                                  selected node ids (array, in selection order)
//   select(ids, { add, toggle }) / clear() / prune()      prune drops ids that no longer exist or left the page
//   run(op, label) → result | null                        applies an operation (ops.js) as one undo step
//   context()                                             parent key whose children clicks select (or null)
//   selectAll() / selectParent() / selectChildren()       keyboard selection (Ctrl+A, Shift+Enter, Enter)
//   deleteSelection() / duplicateSelection()
//
//   opStep(model, op, { apply, random }) → step | null    one operation as an undo step that replays through ops:
//     { op, inverse, before, after, result, redo(current) → model, undo(current) → model }
//     redo and undo return the stored models when nothing else changed in between; otherwise they re-apply the
//     operation or its inverse to the current model (live collaboration changes it under us), and keep the current
//     model when that is no longer possible.
import { apply as applyOp } from "../engine/proto/ops.js";
import { indexOf, pageKey, pageList, roots as rootIds } from "../engine/proto/tree.js";

// ops.js returns a new model for an update that sets a field to the value it already has; that is no undo step
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function unchanged(before, after, op) {
  if (op?.op === "node.update") return same(before.nodes[op.id], after.nodes[op.id]);
  if (op?.op === "page.update") return same(before.pages[op.id], after.pages[op.id]);
  return false;
}

/** One operation as an undo step (see the header). Returns null for a no-op; throws the OpError of a failing op. */
export function opStep(model, op, { apply = applyOp, random } = {}) {
  const res = apply(model, op, random ? { random } : {});
  if (res.model === model || unchanged(model, res.model, op)) return null;
  const before = model;
  const after = res.model;
  // after an undo that had to replay the inverse, the inverse of that replay redoes exactly (same ids)
  let again = op;
  const replay = (cur, o) => {
    try {
      return apply(cur, o);
    } catch {
      return null;
    }
  };
  return {
    op,
    inverse: res.inverse,
    before,
    after,
    result: res,
    redo(cur) {
      if (cur === before) return after;
      const r = replay(cur, again);
      return r ? r.model : cur;
    },
    undo(cur) {
      if (cur === after) return before;
      const r = replay(cur, res.inverse);
      if (!r) return cur;
      again = r.inverse;
      return r.model;
    },
  };
}

export function createController({ model, commit, emit = () => {}, page = null }) {
  let sel = [];
  let pageId = page;

  const nodes = () => model().nodes;
  const firstPage = () => pageList(model())[0]?.id || null;
  const ensurePage = () => {
    const m = model();
    if (!pageId || !m.pages[pageId]) pageId = firstPage();
    return pageId;
  };
  const setSel = (next) => {
    if (next.length === sel.length && next.every((id, i) => id === sel[i])) return false;
    sel = next;
    emit("selection", sel);
    return true;
  };

  const ctl = {
    get page() {
      return ensurePage();
    },
    setPage(id) {
      if (!model().pages[id] || id === pageId) return;
      pageId = id;
      sel = [];
      emit("page", id);
      emit("selection", sel);
    },
    get selection() {
      return sel;
    },
    /** Selects `ids` (unknown ids and ids on other pages are ignored). */
    select(ids, { add = false, toggle = false } = {}) {
      const p = ensurePage();
      const ns = nodes();
      const list = (Array.isArray(ids) ? ids : ids == null ? [] : [ids]).filter((id) => ns[id] && ns[id].page === p);
      let next;
      if (toggle) {
        next = sel.slice();
        for (const id of list) {
          const i = next.indexOf(id);
          if (i >= 0) next.splice(i, 1);
          else next.push(id);
        }
      } else if (add) {
        next = sel.slice();
        for (const id of list) if (!next.includes(id)) next.push(id);
      } else next = [...new Set(list)];
      return setSel(next);
    },
    clear() {
      return setSel([]);
    },
    /** Drops selected ids that were removed or moved to another page (after undo, redo and remote changes). */
    prune() {
      const p = ensurePage();
      const ns = nodes();
      return setSel(sel.filter((id) => ns[id] && ns[id].page === p));
    },
    /** The parent key whose children a click selects: the common parent of the selection, or null. */
    context() {
      if (!sel.length) return null;
      const ns = nodes();
      const parents = new Set(sel.map((id) => ns[id]?.parent ?? null));
      if (parents.size !== 1) return null;
      const [p] = parents;
      return p;
    },
    /** Applies an operation as one undo step. Returns the ops.js result, or null when nothing changed. */
    run(op, label) {
      const step = opStep(model(), op);
      if (!step) return null;
      commit(step, label);
      return step.result;
    },
    /** Ctrl+A: the siblings of the selection, or the top-level layers of the page. */
    selectAll() {
      const m = model();
      const p = ensurePage();
      const ctx = ctl.context();
      const ix = indexOf(m);
      return ctl.select(ix.get(ctx != null ? ctx : pageKey(p)).slice());
    },
    /** Shift+Enter / Escape: the parents of the selection (none for top-level layers). */
    selectParent() {
      const ns = nodes();
      const parents = [...new Set(sel.map((id) => ns[id]?.parent).filter((p) => p != null))];
      return parents.length ? ctl.select(parents) : ctl.clear();
    },
    /** Enter: the children of the selected containers. */
    selectChildren() {
      const ix = indexOf(model());
      const kids = sel.flatMap((id) => ix.get(id));
      return kids.length ? ctl.select(kids) : false;
    },
    deleteSelection(label) {
      if (!sel.length) return null;
      const ids = rootIds(model(), sel);
      const res = ctl.run({ op: "node.delete", ids }, label);
      ctl.prune();
      return res;
    },
    duplicateSelection(label) {
      if (!sel.length) return null;
      const ids = rootIds(model(), sel);
      const res = ctl.run({ op: "node.duplicate", ids, offset: [16, 16] }, label);
      if (res?.map) ctl.select(ids.map((id) => res.map[id]).filter(Boolean));
      return res;
    },
  };
  return ctl;
}
