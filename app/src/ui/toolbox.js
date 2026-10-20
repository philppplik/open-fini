// Left toolbox: tool buttons per studio with flyout groups.
import { h, empty } from "../core/util.js";
import { STUDIOS, toolboxFor } from "../studios/index.js";

export function iconEl(spec) {
  if (!spec) return h("sl-icon");
  const [lib, name] = spec.includes(":") ? spec.split(":") : [undefined, spec];
  return h("sl-icon", { name, library: lib === "of" ? "of" : undefined });
}

export function createToolbox(app) {
  const el = h("div.of-toolbox", { role: "toolbar", "aria-orientation": "vertical", "aria-label": "Tools" });
  const lastInGroup = new Map();
  let flyout = null;

  const closeFlyout = () => {
    flyout?.remove();
    flyout = null;
  };
  document.addEventListener("pointerdown", (e) => {
    if (flyout && !flyout.contains(e.target)) closeFlyout();
  }, true);

  function toolIdFor(entry) {
    if (!entry.group) return entry.id;
    const reg = entry.group.filter((id) => app.toolClasses.has(id));
    if (app.tool && reg.includes(app.tool.id)) {
      lastInGroup.set(entry.group[0], app.tool.id);
      return app.tool.id;
    }
    const last = lastInGroup.get(entry.group[0]);
    return last && reg.includes(last) ? last : reg[0];
  }

  function openFlyout(anchor, entry) {
    closeFlyout();
    const reg = entry.group.filter((id) => app.toolClasses.has(id));
    flyout = h("div.of-flyout");
    for (const id of reg) {
      const C = app.toolClasses.get(id);
      const row = h("button.of-flyout__item", { type: "button", class: app.tool?.id === id ? "active" : "" }, iconEl(C.icon), h("span", C.label), C.shortcut ? h("kbd", C.shortcut) : null);
      row.addEventListener("click", () => {
        lastInGroup.set(entry.group[0], id);
        app.setTool(id);
        closeFlyout();
      });
      flyout.append(row);
    }
    document.body.append(flyout);
    const r = anchor.getBoundingClientRect();
    flyout.style.left = `${r.right + 6}px`;
    flyout.style.top = `${Math.min(r.top, innerHeight - flyout.offsetHeight - 8)}px`;
  }

  function render() {
    empty(el);
    // tool visibility, order and grouping come from Settings > Toolbox and menus (customize/toolbox-model.js)
    const entries = toolboxFor(app.studio);
    for (const entry of app.customize ? app.customize.arrangeToolbox(app.studio, entries) : entries) {
      const id = toolIdFor(entry);
      const C = id && app.toolClasses.get(id);
      if (!C) continue;
      const grouped = entry.group && entry.group.filter((g) => app.toolClasses.has(g)).length > 1;
      const btn = h(
        "button.of-tool",
        { type: "button", class: app.tool?.id === id ? "active" : "", "data-tool": id, "data-tip": C.label, "data-shortcut": C.shortcut || undefined, "data-tip-pos": "right", "aria-label": C.label },
        iconEl(C.icon),
        grouped ? h("span.of-tool__tri") : null,
      );
      btn.addEventListener("click", () => app.setTool(id));
      if (grouped) {
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openFlyout(btn, entry);
        });
        let timer = 0;
        btn.addEventListener("pointerdown", () => {
          timer = setTimeout(() => openFlyout(btn, entry), 380);
        });
        for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, () => clearTimeout(timer));
        btn.querySelector(".of-tool__tri").addEventListener("click", (e) => {
          e.stopPropagation();
          openFlyout(btn, entry);
        });
      }
      el.append(btn);
      if (["crop", "text", "eyedropper"].includes(id) && false) el.append(h("div.of-tool__sep"));
    }
    // command buttons contributed through app.customize.registerToolboxEntry (extensions, future studios)
    for (const x of app.customize?.toolboxExtras(app.studio) || []) {
      const b = h("button.of-tool", { type: "button", "data-tip": x.label, "data-tip-pos": "right", "aria-label": x.label, "data-cmd": x.command }, iconEl(x.icon));
      b.addEventListener("click", () => app.run(x.command));
      el.append(b);
    }
    // color chips for pixel painting
    if (app.studio === "pixel") el.append(colorChips(app));
  }

  app.on("studio", render);
  app.on("toolboxchanged", render);
  app.on("shortcuts", render);
  app.on("tool", () => {
    // update the active state / swapped group icons without a full rebuild
    render();
  });
  render();
  return { el, render, closeFlyout };
}

function colorChips(app) {
  const fg = h("button.of-chipbtn.fg", { type: "button", "data-tip": "Foreground color", "data-tip-pos": "right" });
  const bg = h("button.of-chipbtn.bg", { type: "button", "data-tip": "Background color", "data-tip-pos": "right" });
  const paint = () => {
    fg.style.background = app.style.primary;
    bg.style.background = app.style.secondary;
  };
  fg.addEventListener("click", () => app.emit("dialog", { id: "color", which: "primary" }));
  bg.addEventListener("click", () => app.emit("dialog", { id: "color", which: "secondary" }));
  const swap = h("button.of-chipswap", { type: "button", "data-tip": "Swap colors (X)", "data-tip-pos": "right", onclick: () => {
    [app.style.primary, app.style.secondary] = [app.style.secondary, app.style.primary];
    app.emit("colors");
  } }, "⇄");
  app.on("colors", paint);
  paint();
  return h("div.of-chips", bg, fg, swap);
}

export { STUDIOS };
