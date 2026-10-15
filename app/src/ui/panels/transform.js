// Transform panel: position, size, rotation, alignment and arrangement of the selection.
import { h, frameScheduler, deg, rad } from "../../core/util.js";
import { translate, scaleAbout, rotateAbout, decompose } from "../../core/math.js";
import { pageBoundsOf, captureTransform, applyPageDelta, transformKeys } from "../../core/transform.js";
import { worldMatrix } from "../../core/nodes.js";
import { topLevelSelection } from "../../core/ops.js";
import { iconButton, numField, section } from "../controls.js";

export function createTransformPanel(app) {
  let lock = false;
  const fx = numField({ label: "X", precision: 2, unit: "px", onChange: (v) => setBox({ x: v }) });
  const fy = numField({ label: "Y", precision: 2, unit: "px", onChange: (v) => setBox({ y: v }) });
  const fw = numField({ label: "W", precision: 2, min: 0.01, unit: "px", onChange: (v) => setBox({ w: v }) });
  const fh = numField({ label: "H", precision: 2, min: 0.01, unit: "px", onChange: (v) => setBox({ h: v }) });
  const fr = numField({ label: "∠", precision: 1, unit: "°", step: 1, min: -360, max: 360, onChange: (v) => setRotation(v) });
  const lockBtn = iconButton({ icon: "link-45deg", label: "Lock aspect ratio", onClick: () => {
    lock = !lock;
    lockBtn.classList.toggle("active", lock);
  } });

  function targets() {
    return topLevelSelection(app).filter((n) => !n.locked);
  }

  function setBox(patch) {
    const nodes = targets();
    const b = pageBoundsOf(nodes);
    if (!b) return;
    const doc = app.doc;
    const nx = patch.x ?? b.x;
    const ny = patch.y ?? b.y;
    let sx = patch.w !== undefined ? patch.w / (b.w || 1) : 1;
    let sy = patch.h !== undefined ? patch.h / (b.h || 1) : 1;
    if (lock) {
      if (patch.w !== undefined && patch.h === undefined) sy = sx;
      else if (patch.h !== undefined && patch.w === undefined) sx = sy;
    }
    const D = [sx, 0, 0, sy, nx - sx * b.x, ny - sy * b.y];
    doc.tx("Transform", () => {
      for (const n of nodes) {
        const snap = captureTransform(n);
        const before = doc.snapshot(n, transformKeys(n));
        applyPageDelta(n, D, snap);
        doc.touch(n);
        doc.recordSet(n, before, "Transform");
      }
    });
  }

  function setRotation(degrees) {
    const nodes = targets();
    if (!nodes.length) return;
    const cur = nodes.length === 1 ? deg(decompose(worldMatrix(nodes[0])).rotation) : 0;
    const b = pageBoundsOf(nodes);
    const D = rotateAbout(rad(degrees - cur), b.x + b.w / 2, b.y + b.h / 2);
    const doc = app.doc;
    doc.tx("Rotate", () => {
      for (const n of nodes) {
        const snap = captureTransform(n);
        const before = doc.snapshot(n, transformKeys(n));
        applyPageDelta(n, D, snap, { bake: false });
        doc.touch(n);
        doc.recordSet(n, before, "Rotate");
      }
    });
  }

  const cmdBtn = (id) => {
    const c = app.commands.get(id);
    if (!c) return null;
    const [lib, name] = c.icon?.includes(":") ? c.icon.split(":") : [undefined, c.icon];
    const b = iconButton({ icon: name || "dot", lib: lib === "of" ? "of" : undefined, label: c.label, onClick: () => app.run(id) });
    b.dataset.cmd = id;
    return b;
  };
  const group = (...ids) => h("div.of-btngroup", ids.map(cmdBtn).filter(Boolean));

  const body = h(
    "div.of-form",
    h("div.of-row", fx.el, fy.el),
    h("div.of-row", fw.el, lockBtn, fh.el),
    h("div.of-row", fr.el),
  );
  const alignBox = h(
    "div.of-actions",
    group("align.left", "align.centerH", "align.right", "align.top", "align.centerV", "align.bottom"),
    group("distribute.h", "distribute.v", "arrange.flipH", "arrange.flipV", "arrange.rotateCCW", "arrange.rotateCW"),
    group("arrange.front", "arrange.forward", "arrange.backward", "arrange.back", "arrange.group", "arrange.ungroup"),
  );
  const el = h("div.of-panel", section("Transform", body), section("Align & Arrange", alignBox));

  function sync() {
    const nodes = topLevelSelection(app);
    const disabled = !nodes.length;
    for (const f of [fx, fy, fw, fh, fr]) f.disable(disabled);
    for (const b of el.querySelectorAll("[data-cmd]")) b.disabled = !app.isEnabled(b.dataset.cmd);
    if (disabled) return;
    const b = pageBoundsOf(nodes);
    if (!b) return;
    fx.set(b.x);
    fy.set(b.y);
    fw.set(b.w);
    fh.set(b.h);
    fr.set(nodes.length === 1 ? deg(decompose(worldMatrix(nodes[0])).rotation) : 0);
  }
  const sched = frameScheduler(sync);
  for (const ev of ["selection", "doc", "docchange", "transforming", "transformed", "page"]) app.on(ev, sched);
  sync();
  return { el, show: sync };
}

export { translate, scaleAbout };
