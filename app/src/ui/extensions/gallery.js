// "Available extensions" gallery of the extension manager: lists the extensions that ship with OpenFini
// (extensions/catalog.json, copied next to the app by the build; see docs/bundled-extensions.md). Nothing here is
// installed or enabled by default: every Install goes through the normal consent dialog.
//
// Public API: renderGallery(app, host, el) fills `el` and returns a function that re-renders after state changes.
// The data logic (catalog fetch, installed/update state, install) is in extensions/catalog.js.
import { h, empty } from "../../core/util.js";
import { describePermission } from "../../extensions/manifest.js";
import { entryState, fetchCatalog, installEntry } from "../../extensions/catalog.js";
import { consentDialog } from "./dialogs.js";

const STUDIO_LABEL = { vector: "Vector", pixel: "Pixel", layout: "Layout", code: "Code" };

export function renderGallery(app, host, el) {
  let entries = null;
  let error = "";
  const draw = () => {
    empty(el);
    el.append(h("p.of-hint", "These extensions ship with OpenFini but are not installed. Installing shows what each one is allowed to do first."));
    if (error) return el.append(h("div.of-empty", error));
    if (!entries) return el.append(h("div.of-empty", "Loading…"));
    const grid = h("div.of-gallery");
    for (const e of entries) {
      const installed = host.get(e.id);
      const state = entryState(e, installed, host.hostVersion);
      const busy = { v: false };
      const label = { available: "Install", update: "Update", installed: "Installed", incompatible: "Needs a newer OpenFini" }[state];
      const btn = h("sl-button", { size: "small", variant: state === "installed" || state === "incompatible" ? "default" : "primary", ...(state === "installed" || state === "incompatible" ? { disabled: true } : {}) }, label);
      btn.addEventListener("click", async () => {
        if (busy.v) return;
        busy.v = true;
        btn.loading = true;
        try {
          const done = await installEntry(host, e, consentDialog);
          if (done) app.toast(done.updated ? `${e.name} updated.` : `${e.name} installed.`, "success", 2400);
        } catch (err) {
          app.toast(err.message, "danger", 8000);
        } finally {
          busy.v = false;
          btn.loading = false;
        }
      });
      const perms = (e.permissions || []).length
        ? (e.permissions || []).map((p) => {
            const d = describePermission(p);
            return h("span", { class: `of-gallery__perm risk-${d.risk}`, title: d.text }, d.label);
          })
        : [h("span.of-gallery__perm.risk-low", "No special permissions")];
      grid.append(
        h("article.of-gallery__card", { "aria-label": e.name },
          h("div.of-gallery__head", h("sl-icon", { name: e.icon || "puzzle" }), h("div", h("h3", e.name), h("small", `v${e.version}${installed && state !== "available" ? ` · installed v${installed.manifest?.version}` : ""}`))),
          h("p", e.description),
          h("div.of-gallery__chips", ...((e.studios || []).map((s) => h("span.of-gallery__studio", STUDIO_LABEL[s] || s)))),
          h("div.of-gallery__chips", { "aria-label": "Permissions" }, ...perms),
          h("div.of-gallery__foot", btn),
        ),
      );
    }
    el.append(entries.length ? grid : h("div.of-empty", "This build has no bundled extensions."));
  };
  draw();
  fetchCatalog().then((list) => { entries = list; draw(); }).catch((err) => { error = err.message; draw(); });
  return draw;
}
