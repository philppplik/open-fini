// "Move to Position…" (canvas and layer context menus, Arrange menu): places the selected layers at an X / Y in page
// pixels, by their top-left corner, center or bottom-right corner. Loaded on first use. One history step.
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { openDialog } from "../../ui/dialogs.js";
import { numField, selectField } from "../../ui/controls.js";
import { topLevelSelection } from "../../core/ops.js";
import { pageBoundsOf, nudge } from "../../core/transform.js";

/** "Move to Position…": places the selected layers (their common bounds) at an X / Y in page pixels. */
export function moveToDialog(app) {
  const nodes = topLevelSelection(app).filter((n) => !n.locked);
  const b = pageBoundsOf(nodes);
  if (!b) return app.toast(t("Select a layer first."), "warning");
  const st = { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, ref: "tl" };
  const REFS = { tl: [0, 0], c: [0.5, 0.5], br: [1, 1] };
  const fx = numField({ label: "X", value: st.x, min: -100000, max: 100000, precision: 2, unit: "px", wide: true, onChange: (v) => (st.x = v) });
  const fy = numField({ label: "Y", value: st.y, min: -100000, max: 100000, precision: 2, unit: "px", wide: true, onChange: (v) => (st.y = v) });
  const ref = selectField({ label: N_("Reference point"), value: st.ref, options: [{ value: "tl", label: N_("Top left") }, { value: "c", label: N_("Center") }, { value: "br", label: N_("Bottom right") }], onChange: (v) => {
    const [ox, oy] = REFS[v];
    st.ref = v;
    st.x = Math.round((b.x + b.w * ox) * 100) / 100;
    st.y = Math.round((b.y + b.h * oy) * 100) / 100;
    fx.set(st.x);
    fy.set(st.y);
  } });
  openDialog({
    title: N_("Move to Position"),
    body: h("div.of-form", h("div.of-row", fx.el, fy.el), ref.el, h("p.of-hint", t("Page coordinates in pixels, measured from the top-left corner of the page."))),
    width: 380,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: N_("Move"),
        variant: "primary",
        onClick: (close) => {
          const [ox, oy] = REFS[st.ref];
          const dx = st.x - (b.x + b.w * ox), dy = st.y - (b.y + b.h * oy);
          close();
          if (!dx && !dy) return;
          const doc = app.doc;
          doc.tx("Move to Position", () => {
            for (const n of nodes) {
              const before = doc.snapshot(n, ["m"]);
              nudge(n, dx, dy);
              doc.touch(n);
              doc.recordSet(n, before, "Move to Position");
            }
          });
        },
      },
    ],
  });
}
