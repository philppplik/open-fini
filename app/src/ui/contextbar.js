// Context toolbar: options of the active tool, tool-specific controls and selection actions.
import { h, empty } from "../core/util.js";
import { buildControls, iconButton } from "./controls.js";

function actionButton(app, id, extra = {}) {
  const c = app.commands.get(id);
  if (!c) return null;
  const [lib, name] = c.icon?.includes(":") ? c.icon.split(":") : [undefined, c.icon];
  const b = iconButton({ icon: name || "dot", lib: lib === "of" ? "of" : undefined, label: c.label, shortcut: c.shortcut, onClick: () => app.run(id), ...extra });
  b.dataset.cmd = id;
  b.disabled = !app.isEnabled(id);
  return b;
}

export function createContextBar(app) {
  const el = h("div.of-contextbar", { role: "toolbar", "aria-label": "Context" });
  let sig = "";

  function build() {
    empty(el);
    if (app.studio === "vibe") return; // the Vibe workspace has no context bar content
    if (app.studio === "code") {
      // the Code studio brings its own toolbar (views, page, breakpoints, zoom)
      if (app.codeUI?.toolbar) el.append(app.codeUI.toolbar);
      return;
    }
    const tool = app.tool;
    const Cls = tool && app.toolClasses.get(tool.id);
    const left = h("div.of-contextbar__left");
    if (Cls) {
      left.append(h("span.of-contextbar__title", Cls.label));
      const options = Cls.getOptions ? Cls.getOptions(app.studio) : Cls.options;
      if (options?.length) {
        left.append(
          buildControls(options, app.toolOptions(Cls.id), {
            onInput: (k, v) => app.setToolOption(Cls.id, k, v),
            onChange: (k, v) => app.setToolOption(Cls.id, k, v),
          }),
        );
      }
      const custom = tool.contextBar?.();
      if (custom) left.append(custom);
    }
    el.append(left);

    const right = h("div.of-contextbar__right");
    const studio = app.studio;
    const hasSel = app.selection.length > 0;
    if (app.doc && (studio === "vector" || studio === "layout") && hasSel) {
      const groups = [
        ["align.left", "align.centerH", "align.right", "align.top", "align.centerV", "align.bottom"],
        ["arrange.front", "arrange.back", "arrange.group", "arrange.ungroup"],
        ["bool.union", "bool.subtract", "bool.intersect", "bool.xor"],
        ["arrange.flipH", "arrange.flipV", "shape.convert"],
      ];
      for (const g of groups) {
        const seg = h("div.of-btngroup");
        for (const id of g) {
          const b = actionButton(app, id);
          if (b) seg.append(b);
        }
        if (seg.children.length) right.append(seg);
      }
    }
    if (app.doc) {
      const snap = actionButtonToggle(app, "view.snapping", "magnet");
      if (snap) right.append(snap);
    }
    el.append(right);
    refreshStates();
  }

  function actionButtonToggle(app2, id, icon) {
    const c = app2.commands.get(id);
    if (!c) return null;
    const b = iconButton({ icon, label: c.label, onClick: () => { app2.run(id); refreshStates(); } });
    b.dataset.cmd = id;
    return b;
  }

  function refreshStates() {
    for (const b of el.querySelectorAll("[data-cmd]")) {
      const c = app.commands.get(b.dataset.cmd);
      if (!c) continue;
      b.disabled = c.enabled ? !c.enabled(app) : false;
      if (c.checked) b.classList.toggle("active", !!c.checked(app));
    }
  }

  function maybeBuild(force) {
    const s = `${app.studio}|${app.tool?.id}|${app.selection.length > 0}|${app.selection[0]?.type}|${app.doc?.id}|${app.codeUI?.doc === app.doc && app.codeUI?.built}`;
    if (!force && s === sig) return refreshStates();
    sig = s;
    build();
  }

  for (const ev of ["studio", "tool", "selection", "doc", "codeui"]) app.on(ev, () => maybeBuild(false));
  app.on("contextbar", () => maybeBuild(true));
  app.on("docchange", () => refreshStates());
  maybeBuild(true);
  return { el, rebuild: () => maybeBuild(true) };
}
