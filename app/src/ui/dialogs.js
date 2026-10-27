// Modal dialogs built on Shoelace's <sl-dialog>.
import { h, prettyShortcut } from "../core/util.js";
import { t } from "../i18n/index.js";

// Dialog texts passed by callers are English source strings: openDialog/confirmDialog/promptDialog translate them with t()
// (a string without a catalog entry, for example one built from user data, is shown as is).
import { Doc } from "../core/doc.js";
import { numField, selectField, segmented, colorField, switchField, button } from "./controls.js";
import { STUDIOS, listStudios } from "../studios/registry.js";
import { createOnceRegistry } from "../core/single-flight.js";

const keyedDialogs = createOnceRegistry();

/** True while a dialog opened with this `key` is showing (callers can skip building an expensive body). */
export function isDialogOpen(key) {
  return keyedDialogs.has(key);
}

/**
 * Opens a modal dialog. With `key`, the request is idempotent: while a dialog with the same key is open,
 * the same instance is returned and nothing new is created (one prompt per user request).
 */
export function openDialog(options = {}) {
  return options.key ? keyedDialogs.open(options.key, (release) => buildDialog(options, release)) : buildDialog(options);
}

function buildDialog({ title, body, buttons = [], width = 520, cls = "", onClose } = {}, release) {
  const dlg = h("sl-dialog", { label: t(title), class: `of-dialog ${cls}` });
  dlg.style.setProperty("--width", `${width}px`); // custom properties need setProperty, not style["--x"]
  dlg.append(body);
  const footer = h("div", { slot: "footer", class: "of-dialog__footer" });
  const close = () => dlg.hide();
  for (const b of buttons) {
    const btn = h("sl-button", { variant: b.variant || "default", size: "medium", outline: b.outline || undefined }, t(b.label));
    btn.addEventListener("click", () => b.onClick?.(close, dlg));
    footer.append(btn);
  }
  if (buttons.length) dlg.append(footer);
  document.body.append(dlg);
  if (release) {
    dlg.addEventListener("sl-hide", (e) => {
      if (e.target === dlg) release();
    });
  }
  dlg.addEventListener("sl-after-hide", (e) => {
    if (e.target !== dlg) return;
    release?.();
    dlg.remove();
    onClose?.();
  });
  // the Shoelace autoloader registers <sl-dialog> lazily; show once it is defined (no dependency on animation frames)
  customElements.whenDefined("sl-dialog").then(() => dlg.show?.());
  return { dlg, close };
}

export function confirmDialog({ title = "Confirm", message, ok = "OK", cancel = "Cancel", danger = false, extra } = {}) {
  message = t(message);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const buttons = [{ label: cancel, onClick: (close) => (finish(false), close()) }];
    if (extra) buttons.push({ label: extra, onClick: (close) => (finish("extra"), close()) });
    buttons.push({ label: ok, variant: danger ? "danger" : "primary", onClick: (close) => (finish(true), close()) });
    openDialog({ title, body: h("p.of-dialog__text", message), buttons, width: 440, onClose: () => finish(false) });
  });
}

export function promptDialog({ title = "Enter a value", label = "", value = "", ok = "OK", type = "text" } = {}) {
  label = label ? t(label) : label;
  return new Promise((resolve) => {
    let done = false;
    const input = h("sl-input", { value, label, type, autofocus: true });
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const { dlg } = openDialog({
      title,
      body: input,
      width: 420,
      buttons: [
        { label: "Cancel", onClick: (close) => (finish(null), close()) },
        { label: ok, variant: "primary", onClick: (close) => (finish(input.value), close()) },
      ],
      onClose: () => finish(null),
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        finish(input.value);
        dlg.hide();
      }
    });
    dlg.addEventListener("sl-after-show", () => input.focus());
  });
}

// ------------------------------------------------------------------ units

export const UNITS = [
  { value: "px", label: "px" },
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
  { value: "in", label: "in" },
  { value: "pt", label: "pt" },
];

/** Converts a length in `unit` to pixels at `dpi`. */
export function toPx(v, unit, dpi) {
  switch (unit) {
    case "in":
      return v * dpi;
    case "mm":
      return (v * dpi) / 25.4;
    case "cm":
      return (v * dpi) / 2.54;
    case "pt":
      return (v * dpi) / 72;
    default:
      return v;
  }
}
export function fromPx(px, unit, dpi) {
  switch (unit) {
    case "in":
      return px / dpi;
    case "mm":
      return (px * 25.4) / dpi;
    case "cm":
      return (px * 2.54) / dpi;
    case "pt":
      return (px * 72) / dpi;
    default:
      return px;
  }
}

// ------------------------------------------------------------------ new document

const PRESETS = {
  Screen: [ // preset groups and names are shown through t() (N_ marks them for extraction)
    ["Full HD", 1920, 1080, "px", 96], ["HD", 1280, 720, "px", 96], ["Desktop", 1440, 900, "px", 96],
    ["Mobile", 390, 844, "px", 96], ["Tablet", 1024, 768, "px", 96], ["4K UHD", 3840, 2160, "px", 96],
  ],
  Print: [
    ["A4", 210, 297, "mm", 300], ["A5", 148, 210, "mm", 300], ["A3", 297, 420, "mm", 300], ["US Letter", 8.5, 11, "in", 300],
    ["US Legal", 8.5, 14, "in", 300], ["Tabloid", 11, 17, "in", 300], ["Business Card", 3.5, 2, "in", 300], ["Postcard", 6, 4, "in", 300],
  ],
  Photo: [
    ["4 × 6 in", 6, 4, "in", 300], ["5 × 7 in", 7, 5, "in", 300], ["8 × 10 in", 10, 8, "in", 300], ["12 MP", 4000, 3000, "px", 72], ["24 MP", 6000, 4000, "px", 72],
  ],
  Social: [
    ["Square Post", 1080, 1080, "px", 72], ["Story / Reel", 1080, 1920, "px", 72], ["Video Thumbnail", 1280, 720, "px", 72],
    ["Header 3:1", 1500, 500, "px", 72], ["Banner", 1584, 396, "px", 72], ["Open Graph", 1200, 630, "px", 72],
  ],
  Icon: [["App Icon", 1024, 1024, "px", 72], ["Icon 512", 512, 512, "px", 72], ["Icon 256", 256, 256, "px", 72], ["Icon 64", 64, 64, "px", 72]],
};

export function newDocumentDialog(app, { studio = app.studio === "code" ? "vector" : app.studio } = {}) {
  const state = { studio, name: "Untitled", w: 1920, h: 1080, unit: "px", dpi: 96, pages: 1, bg: "#ffffff", transparent: false, bleed: 0, facing: false };
  const dd = app.prefs.newDocDefaults?.[studio]; // Settings > Defaults for new things
  if (dd) Object.assign(state, { w: dd.width ?? state.w, h: dd.height ?? state.h, unit: dd.unit ?? state.unit, dpi: dd.dpi ?? state.dpi, bg: dd.bg ?? state.bg, transparent: dd.transparent ?? state.transparent });
  const cats = Object.keys(PRESETS);
  let cat = studio === "layout" ? "Print" : studio === "pixel" ? "Photo" : "Screen";
  const grid = h("div.of-presets");
  const customBox = h("div.of-form");

  const fw = numField({ label: t("Width"), value: state.w, min: 1, max: 100000, precision: 2, wide: true, onChange: (v) => (state.w = v) });
  const fh = numField({ label: t("Height"), value: state.h, min: 1, max: 100000, precision: 2, wide: true, onChange: (v) => (state.h = v) });
  const unit = selectField({ label: t("Unit"), value: state.unit, options: UNITS, onChange: (u) => {
    const px = { w: toPx(state.w, state.unit, state.dpi), h: toPx(state.h, state.unit, state.dpi) };
    state.unit = u;
    state.w = fromPx(px.w, u, state.dpi);
    state.h = fromPx(px.h, u, state.dpi);
    fw.set(state.w);
    fh.set(state.h);
  } });
  const dpi = numField({ label: t("DPI"), value: state.dpi, min: 1, max: 2400, precision: 0, wide: true, onChange: (v) => (state.dpi = v) });
  const pages = numField({ label: t("Pages"), value: 1, min: 1, max: 200, precision: 0, wide: true, onChange: (v) => (state.pages = Math.round(v)) });
  const bleed = numField({ label: t("Bleed"), value: 0, min: 0, max: 100, precision: 1, unit: "mm", wide: true, onChange: (v) => (state.bleed = v) });
  const name = h("sl-input", { value: state.name, label: t("Name"), size: "small" });
  name.addEventListener("sl-input", () => (state.name = name.value));
  const bg = colorField({ value: "#ffffff", alpha: false, label: t("Background"), onChange: (c) => (state.bg = c) });
  const transparent = switchField({ label: t("Transparent background"), value: false, onChange: (v) => (state.transparent = v) });
  const studioSeg = segmented(
    listStudios().filter((s) => s.document || s.newDocument).map((s) => ({ value: s.id, label: t("{studio} studio — {blurb}", { studio: s.label, blurb: t(s.blurb) }), text: s.label })),
    state.studio,
    (v) => {
      if (STUDIOS[v]?.newDocument) {
        // a studio with its own start dialog (Code: a template gallery instead of a canvas size)
        dialogRef?.close();
        STUDIOS[v].newDocument(app, {});
        return;
      }
      state.studio = v;
    },
  );

  function applyPreset([label, w, h2, u, d]) {
    state.w = w;
    state.h = h2;
    state.unit = u;
    state.dpi = d;
    state.name = t(label);
    name.value = t(label);
    fw.set(w);
    fh.set(h2);
    unit.set(u);
    dpi.set(d);
  }

  function renderPresets() {
    grid.replaceChildren(
      h("div.of-presets__tabs", cats.map((c) => h("button.of-presets__tab", { type: "button", class: c === cat ? "active" : "", onclick: () => { cat = c; renderPresets(); } }, t(c)))),
      h("div.of-presets__list", PRESETS[cat].map((p) => {
        const [label, w, hh, u] = p;
        const b = h("button.of-preset", { type: "button" }, h("strong", t(label)), h("span", `${w} × ${hh} ${u}`));
        b.addEventListener("click", () => applyPreset(p));
        return b;
      })),
    );
  }
  renderPresets();
  applyPreset(PRESETS[cat][0]);
  customBox.append(name, h("div.of-row", fw.el, fh.el), h("div.of-row", unit.el, dpi.el), h("div.of-row", pages.el, bleed.el), h("div.of-row", bg.el), transparent.el);

  const body = h("div.of-newdoc", h("div.of-newdoc__studio", h("span.of-slider__label", t("Start in")), studioSeg.el), h("div.of-newdoc__cols", grid, customBox));

  const dialogRef = openDialog({
    title: t("New Document"),
    body,
    width: 760,
    buttons: [
      { label: t("Cancel"), onClick: (c) => c() },
      {
        label: t("Create"),
        variant: "primary",
        onClick: (close) => {
          const wpx = Math.round(toPx(state.w, state.unit, state.dpi));
          const hpx = Math.round(toPx(state.h, state.unit, state.dpi));
          if (wpx * hpx > 150e6) {
            app.toast(t("That canvas is too large (over 150 megapixels)."), "warning");
            return;
          }
          const doc = createDocument(app, { ...state, width: wpx, height: hpx });
          close();
          app.setStudio(state.studio);
          app.openDoc(doc);
          requestAnimationFrame(() => app.cv?.fitPage());
        },
      },
    ],
  });
}

/** Creates a configured Doc (pixel studio documents start with an empty pixel layer). */
export function createDocument(app, o) {
  const doc = new Doc({ name: o.name || "Untitled", width: o.width, height: o.height, dpi: o.dpi, unit: o.unit === "px" ? "px" : o.unit, bg: o.transparent ? null : o.bg, studio: o.studio, pages: o.pages || 1 });
  const bleedPx = toPx(o.bleed || 0, "mm", o.dpi);
  if (bleedPx) for (const p of doc.pages) p.bleed = bleedPx;
  if (o.studio === "layout") {
    const m = Math.round(toPx(12, "mm", o.dpi));
    for (const p of doc.pages) p.margins = { top: m, right: m, bottom: m, left: m };
  }
  doc.history.clear();
  doc.saved = true;
  return doc;
}

// ------------------------------------------------------------------ preferences / about / shortcuts

export function preferencesDialog(app, section, opts) {
  import("./settings-dialog.js").then((m) => m.settingsDialog(app, section, opts));
}

export function aboutDialog() {
  const version = h("p.of-hint", t("MIT License"));
  fetch("./build-info.json").then((r) => (r.ok ? r.json() : null)).then((j) => j && (version.textContent = t("Version {version} (build {build}) · MIT License", { version: j.version, build: String(j.buildId).split("-").pop() }))).catch(() => {});
  openDialog({
    title: t("About OpenFini"),
    width: 480,
    body: h(
      "div.of-about",
      h("img", { src: "./icons/icon.svg", width: 72, height: 72, alt: "" }),
      h("h2", "OpenFini"),
      h("p", t("A lightweight, open-source creative suite with Vector, Pixel, Layout and Code studios.")),
      version,
      h("p.of-hint", t("OpenFini is an independent project. It is not affiliated with, endorsed by or derived from any commercial product. All product names are trademarks of their respective owners.")),
      h("p", h("a", { href: "https://github.com/philppplik/open-fini", rel: "noopener", onclick: (e) => { e.preventDefault(); import("./links.js").then((m) => m.openLink("https://github.com/philppplik/open-fini")); } }, "github.com/philppplik/open-fini")),
    ),
    buttons: [{ label: t("Close"), variant: "primary", onClick: (c) => c() }],
  });
}

export function shortcutsDialog(app) {
  openDialog({ title: t("Keyboard Shortcuts"), body: shortcutsContent(app), width: 720, buttons: [{ label: t("Close"), variant: "primary", onClick: (c) => c() }] });
}

export function shortcutsContent(app) {
  const groups = new Map();
  const group = (c) => c.id.split(".")[0];
  const names = { file: t("File"), edit: t("Edit"), arrange: t("Arrange"), align: t("Align"), view: t("View"), studio: t("Studios"), layer: t("Layer"), select: t("Select"), doc: t("Document"), help: t("Help"), bool: t("Shape"), shape: t("Shape"), pixel: "Pixel", filter: t("Filter"), distribute: t("Align") };
  for (const c of app.commands.values()) {
    if (!c.shortcut) continue;
    const g = names[group(c)] || t("Other");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const toolRows = [];
  for (const C of app.toolClasses.values()) if (C.shortcut) toolRows.push(h("div.of-sc__row", h("span", t(C.label)), h("kbd", C.shortcut)));
  return h(
    "div.of-shortcuts",
    ...[...groups].map(([g, cmds]) => h("section", h("h3", g), ...cmds.map((c) => h("div.of-sc__row", h("span", c.label), h("kbd", prettyShortcut(c.shortcut)))))),
    h("section", h("h3", t("Tools")), ...toolRows),
    h("section", h("h3", t("Navigation")), h("div.of-sc__row", h("span", t("Pan")), h("kbd", t("Space + drag"))), h("div.of-sc__row", h("span", t("Zoom")), h("kbd", t("Ctrl + wheel"))), h("div.of-sc__row", h("span", t("Constrain / uniform")), h("kbd", "Shift")), h("div.of-sc__row", h("span", t("From center / copy")), h("kbd", "Alt"))),
  );
}

export function colorDialog(app, which) {
  const picker = h("sl-color-picker", { inline: true, value: app.style[which], format: "hex", size: "large", "no-format-toggle": false });
  picker.addEventListener("sl-input", () => {
    app.style[which] = picker.value;
    app.emit("colors");
  });
  openDialog({ title: which === "primary" ? t("Foreground Color") : t("Background Color"), body: h("div.of-center", picker), width: 360, buttons: [{ label: t("Done"), variant: "primary", onClick: (c) => c() }] });
}

export { button };
