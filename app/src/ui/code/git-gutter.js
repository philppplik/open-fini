// Change markers in the editor: lines added or modified since the last commit get a coloured bar at their left edge,
// and a notch marks where lines were removed. Built from line decorations (the vendored CodeMirror build has no
// custom gutters), recomputed shortly after typing.
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { lineMarks } from "../../engine/git/diff.js";

export const refreshGutter = CM.StateEffect.define();
const setDecos = CM.StateEffect.define();
const MAX_LINES = 6000;

/** @param {(path: string) => string | null} getBase HEAD text of the file, or null when untracked */
export function gitGutter(path, getBase) {
  const field = CM.StateField.define({
    create: () => CM.Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setDecos)) return e.value;
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (f) => CM.EditorView.decorations.from(f),
  });
  const plugin = CM.ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.t = setTimeout(() => this.run(), 50);
      }
      update(u) {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshGutter)))) {
          clearTimeout(this.t);
          this.t = setTimeout(() => this.run(), u.docChanged ? 300 : 0);
        }
      }
      run() {
        const view = this.view;
        if (!view.dom.isConnected) return;
        const doc = view.state.doc;
        const base = doc.lines > MAX_LINES ? null : getBase(path);
        let deco = CM.Decoration.none;
        if (base != null) {
          const m = lineMarks(base, doc.toString());
          const cls = new Map();
          const add = (n, c) => n >= 1 && n <= doc.lines && cls.set(n, `${cls.get(n) || ""} ${c}`.trim());
          for (const n of m.added) add(n, "of-gl-add");
          for (const n of m.modified) add(n, "of-gl-mod");
          for (const n of m.removed) (m.removed.length, add(Math.min(n + 1, doc.lines), n + 1 > doc.lines ? "of-gl-del-end" : "of-gl-del"));
          const b = new CM.RangeSetBuilder();
          for (const n of [...cls.keys()].sort((x, y) => x - y)) b.add(doc.line(n).from, doc.line(n).from, CM.Decoration.line({ class: cls.get(n) }));
          deco = b.finish();
        }
        view.dispatch({ effects: setDecos.of(deco) });
      }
      destroy() {
        clearTimeout(this.t);
      }
    },
  );
  return [field, plugin];
}
