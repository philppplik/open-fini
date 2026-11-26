// A three-screen prototype for the T9 tests: Home → Details (smart animate) → Done, a menu overlay, a toggle variable
// and a button component with a hover variant. Built through the operation layer, so it is valid by construction.
import * as S from "../../app/src/engine/proto/schema.js";
import * as O from "../../app/src/engine/proto/ops.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";

export function flowModel() {
  let m = S.emptyDocument({ title: "Flow", created: "2026-01-01T00:00:00Z", pageId: "p1" });
  const run = (op) => {
    const r = O.apply(m, op, { random: seededRandom(7) });
    m = r.model;
    return r;
  };
  const frame = (id, name, x, children) =>
    run({ op: "node.create", type: "frame", page: "p1", id, fields: { name, x, y: 0, w: { mode: "fixed", value: 390 }, h: { mode: "fixed", value: 844 }, layout: { type: "flex", dir: "column", gap: 16, pad: [24, 24, 24, 24] } }, children });
  const text = (id, t, extra = {}) => ({ type: "text", id, fields: { name: t, text: { runs: [{ t, s: {} }], style: { ...S.DEFAULT_TEXT_STYLE }, autoSize: "width", maxLines: null }, ...extra } });
  const box = (id, name, h, color) => ({ type: "rect", id, fields: { name, pos: "flow", w: { mode: "fill" }, h: { mode: "fixed", value: h }, fills: [{ type: "solid", color }] } });
  frame("home", "Home", 0, [text("h1", "Welcome"), box("card1", "Card", 120, "#3b82f6"), box("go", "Next button", 48, "#1d4ed8")]);
  frame("details", "Details", 500, [text("h2", "Details"), box("card2", "Card", 320, "#2563eb"), box("done-btn", "Finish", 48, "#16a34a"), box("back-btn", "Back", 48, "#a1a1aa")]);
  frame("done", "Done", 1000, [text("h3", "All done")]);
  run({ op: "node.create", type: "frame", page: "p1", id: "menu", fields: { name: "Menu", x: 1500, y: 0, w: { mode: "fixed", value: 300 }, h: { mode: "fixed", value: 200 } } });
  run({ op: "collection.create", id: "c1", name: "State", modes: [{ id: "m1", name: "Default" }] });
  run({ op: "var.create", id: "v1", coll: "c1", name: "liked", type: "bool", value: false });
  run({ op: "var.create", id: "v2", coll: "c1", name: "count", type: "number", value: 0 });
  run({ op: "interaction.connect", from: "go", to: "details", tr: { type: "smart", dur: 300, ease: "ease-out" } });
  run({ op: "interaction.add", id: "back-btn", interaction: { on: { type: "click" }, do: [{ act: "back" }] } });
  run({ op: "interaction.add", id: "done-btn", interaction: { on: { type: "click" }, do: [{ act: "navigate", to: "done", tr: { type: "push", dir: "left", dur: 250 } }] } });
  run({ op: "interaction.add", id: "h1", interaction: { on: { type: "click" }, do: [{ act: "openOverlay", to: "menu", pos: "bottom" }] } });
  run({ op: "interaction.add", id: "card1", interaction: { on: { type: "click" }, do: [{ act: "set", var: "v1", value: { op: "not", args: [{ var: "v1" }] } }, { act: "set", var: "v2", value: { op: "+", args: [{ var: "v2" }, 1] } }] } });
  run({ op: "flow.create", start: "home", id: "f1", name: "Onboarding" });
  return m;
}
