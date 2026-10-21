// Document tab strip.
import { h, empty } from "../core/util.js";
import { markContext } from "./context-menu/index.js";
import { displayName } from "../core/source-format.js";

export function createDocTabs(app) {
  const el = h("div.of-doctabs", { role: "tablist", "aria-label": "Documents" });

  function render() {
    empty(el);
    for (const doc of app.docs) {
      const active = doc === app.doc;
      const label = displayName(doc, { enabled: app.prefs.saveOriginalFormat !== false }); // opened file name with its extension while Save writes that format
      const tab = h(
        "div.of-doctab",
        { role: "tab", class: active ? "active" : "", "aria-selected": String(active), title: label },
        h("span.of-doctab__name", label),
        doc.saved ? null : h("span.of-doctab__dot", { "aria-label": "Unsaved changes" }),
        h("button.of-doctab__close", { type: "button", "aria-label": `Close ${doc.name}`, onclick: (e) => {
          e.stopPropagation();
          app.run("file.close", doc);
        } }, "×"),
      );
      markContext(tab, "doc-tab", { doc });
      tab.addEventListener("click", () => app.activateDoc(doc));
      tab.addEventListener("auxclick", (e) => e.button === 1 && app.run("file.close", doc));
      el.append(tab);
    }
    el.append(h("button.of-doctab__new", { type: "button", "aria-label": "New document", "data-tip": "New document", onclick: () => app.run("file.new") }, h("sl-icon", { name: "plus-lg" })));
    el.classList.toggle("empty", !app.docs.length);
  }
  for (const ev of ["docs", "doc", "prefs"]) app.on(ev, render);
  app.on("docchange", () => {
    // only refresh the unsaved indicator
    const dots = el.querySelectorAll(".of-doctab");
    app.docs.forEach((d, i) => {
      const tab = dots[i];
      if (!tab) return;
      const dot = tab.querySelector(".of-doctab__dot");
      if (!d.saved && !dot) tab.insertBefore(h("span.of-doctab__dot"), tab.querySelector(".of-doctab__close"));
      if (d.saved && dot) dot.remove();
    });
  });
  app.on("saved", render);
  render();
  return { el, render };
}
