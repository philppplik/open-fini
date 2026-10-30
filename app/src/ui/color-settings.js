// Color management UI (lazy): Color Settings dialog, Convert Colors, soft proof / gamut warning, the print preflight
// report and the CMYK sliders of the Color panel. Logic lives in core/color-doc.js and engine/color/.
import { h, empty } from "../core/util.js";
import { t } from "../i18n/index.js";
import { openDialog } from "./dialogs.js";
import { selectField, switchField, button } from "./controls.js";
import { platform } from "../platform/index.js";
import { colorSettings, getColorContext, convertColors, refreshCmykPreviews, printPdf } from "../core/color-doc.js";
import { applyProof } from "../engine/color/context.js";
import { parseICC } from "../engine/color/icc.js";
import { hasFillStroke } from "../core/nodes.js";

const RGB_OPTS = [
  { value: "srgb", label: "sRGB IEC61966-2.1" },
  { value: "display-p3", label: "Display P3" },
  { value: "adobe-rgb", label: "Adobe RGB (1998)" },
];
const INTENT_OPTS = [
  { value: 0, label: "Perceptual" },
  { value: 1, label: "Relative colorimetric" },
  { value: 2, label: "Saturation" },
  { value: 3, label: "Absolute colorimetric" },
];
// styles of the lazily loaded color UI live here, not in a start-up stylesheet
if (typeof document !== "undefined" && !document.getElementById("of-color-css")) {
  document.head.append(
    h("style#of-color-css", `
.of-cmyk{display:grid;gap:4px;margin:6px 0}
.of-cmyk__row{display:grid;grid-template-columns:14px 1fr 34px;align-items:center;gap:6px;font-size:var(--of-font-size-sm,12px)}
.of-cmyk__row input{width:100%}
.of-cmyk__val{text-align:right;font-variant-numeric:tabular-nums}
.of-cmyk__gamut{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--sl-color-warning-600);font-size:12px}
.of-preflight{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.of-preflight li{display:flex;gap:8px;align-items:flex-start}
.of-preflight sl-icon{flex:none;margin-top:2px}
.of-preflight__error sl-icon{color:var(--sl-color-danger-600)}
.of-preflight__warning sl-icon{color:var(--sl-color-warning-600)}
.of-preflight__info sl-icon{color:var(--sl-color-primary-600)}`),
  );
}

export const STANDARD_OPTS = [
  { value: "none", label: "Plain PDF" },
  { value: "x1a", label: "PDF/X-1a:2003 (CMYK, no transparency)" },
  { value: "x4", label: "PDF/X-4 (CMYK, live transparency)" },
];

export function colorSettingsDialog(app) {
  const doc = app.doc;
  const st = { ...colorSettings(doc) };
  let loaded = null; // { bytes, name, file }
  const profName = h("div.of-hint");
  const showProfile = () => {
    profName.textContent = loaded ? loaded.name : st.cmyk && doc.assets[st.cmyk] ? st.cmykName || doc.assets[st.cmyk].name : t("Built-in approximation (not a measured printing condition)");
  };
  showProfile();
  const load = button("Load CMYK profile (.icc)…", async () => {
    const files = await platform.openFiles({ accept: [{ name: "ICC profiles", extensions: ["icc", "icm"] }] });
    if (!files.length) return;
    try {
      const p = parseICC(files[0].bytes);
      if (p.colorSpace !== "CMYK") throw new Error(t("This is not a CMYK profile."));
      loaded = { bytes: files[0].bytes, name: p.name, file: files[0].name };
      showProfile();
    } catch (err) {
      app.toast(err.message, "danger", 6000);
    }
  });
  const builtin = button("Use the built-in approximation", () => {
    loaded = null;
    st.cmyk = null;
    st.cmykName = "";
    showProfile();
  });
  const body = h(
    "div.of-form",
    selectField({ label: "Document color mode", value: st.mode, options: [{ value: "rgb", label: "RGB (screen)" }, { value: "cmyk", label: "CMYK (print)" }], onChange: (v) => (st.mode = v) }).el,
    selectField({ label: "RGB working space", value: st.rgb, options: RGB_OPTS, onChange: (v) => (st.rgb = v) }).el,
    h("div.of-form__group", t("CMYK output profile")),
    profName,
    h("div.of-row", load, builtin),
    selectField({ label: "Rendering intent", value: st.intent, options: INTENT_OPTS, onChange: (v) => (st.intent = Number(v)) }).el,
    switchField({ label: "Black point compensation", value: st.bpc, onChange: (v) => (st.bpc = v) }).el,
    h("p.of-hint", t("OpenFini cannot ship FOGRA, GRACoL or SWOP profiles because their licenses do not allow redistribution. Ask your print shop for the profile of its printing condition (or download it from eci.org or color.org) and load it here; it is saved inside the document.")),
  );
  openDialog({
    key: "color-settings",
    title: "Color Settings",
    body,
    width: 500,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (close) => {
          doc.tx("Color Settings", () => {
            if (loaded) {
              st.cmyk = doc.addAsset({ name: loaded.file, mime: "application/vnd.iccprofile", bytes: loaded.bytes });
              st.cmykName = loaded.name;
            }
            doc.set(doc.settings, { color: { ...st } });
            refreshCmykPreviews(doc);
          });
          app.emit("colors");
          app.emit("render");
          close();
        },
      },
    ],
  });
}

export function convertCommand(app, to) {
  const nodes = app.selection.filter(hasFillStroke);
  const n = convertColors(app.doc, { nodes: nodes.length ? nodes : null, to });
  app.emit("colors");
  app.toast(to === "cmyk" ? t("Converted {n} colors to CMYK.", { n }) : t("Converted {n} colors to RGB.", { n }), "success", 2400);
}

/** Toggles the soft proof ("proof") or the gamut warning ("warn") of the canvas. */
export function toggleProof(app, which) {
  const s = { proof: false, warn: false, ...(app.proofState || {}) };
  s[which] = !s[which];
  app.proofState = s;
  app.proof =
    s.proof || s.warn
      ? (ctx, x, y, w, hh) => {
          if (!app.doc) return;
          const x0 = Math.max(0, Math.floor(x));
          const y0 = Math.max(0, Math.floor(y));
          const x1 = Math.min(ctx.canvas.width, Math.ceil(x + w));
          const y1 = Math.min(ctx.canvas.height, Math.ceil(y + hh));
          if (x1 <= x0 || y1 <= y0) return;
          const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
          applyProof(img.data, getColorContext(app.doc).proofTables(), s);
          ctx.putImageData(img, x0, y0);
        }
      : null;
  if (s[which]) app.status(s.proof ? t("Proofing: {name}", { name: getColorContext(app.doc).profileName }) : t("Gamut warning: out-of-gamut colors are gray"));
  else app.status("");
  app.emit("render");
}

/** The issues list of a preflight result. */
export function preflightReport(pf) {
  const icon = { error: "x-octagon", warning: "exclamation-triangle", info: "info-circle" };
  const list = pf.issues.length
    ? h("ul.of-preflight", pf.issues.map((i) => h("li", { class: `of-preflight__${i.severity}` }, h("sl-icon", { name: icon[i.severity] }), h("span", (i.page ? t("Page {n}", { n: i.page }) + ": " : "") + t(i.message, i.params)))))
    : h("p", t("No issues found."));
  return h(
    "div.of-form",
    list,
    h("details", h("summary", t("What was checked")), h("ul", pf.checked.map((c) => h("li", t(c))))),
    h("p.of-hint", t("This is OpenFini's own preflight, not a certified PDF/X validator (such as Acrobat Preflight or veraPDF). Check important jobs with your print shop.")),
  );
}

export function showPreflightReport(pf) {
  openDialog({ key: "preflight", title: "Preflight", body: preflightReport(pf), width: 560, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
}

/** File > Print Preflight…: choose a standard, run a dry-run export, show the report. */
export function preflightDialog(app) {
  const st = { standard: app.doc.settings.color?.mode === "cmyk" ? "x4" : "x1a" };
  const out = h("div");
  const run = async () => {
    empty(out);
    out.append(h("p.of-hint", t("Checking…")));
    try {
      const r = await printPdf(app, app.doc.pages, { standard: st.standard === "none" ? null : st.standard, bleed: true, dryRun: true });
      empty(out);
      out.append(preflightReport(r.preflight));
    } catch (err) {
      empty(out);
      out.append(h("p", err.message));
    }
  };
  const body = h("div.of-form", selectField({ label: "Check for", value: st.standard, options: STANDARD_OPTS, onChange: (v) => { st.standard = v; run(); } }).el, out);
  openDialog({ key: "preflight", title: "Print Preflight", body, width: 580, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
  run();
}

/** CMYK sliders and the gamut hint for the Color panel (shown in CMYK documents). */
export function cmykControls(app, { current, apply }) {
  const vals = [0, 0, 0, 0];
  const names = ["C", "M", "Y", "K"];
  const inputs = names.map((n, i) => {
    const inp = h("input", { type: "range", min: 0, max: 100, step: 0.5, value: 0, "aria-label": n });
    const num = h("span.of-cmyk__val", "0");
    inp.addEventListener("input", () => {
      vals[i] = Number(inp.value);
      num.textContent = String(vals[i]);
      commit(false);
    });
    inp.addEventListener("change", () => commit(true));
    return { el: h("label.of-cmyk__row", h("span.of-cmyk__ch", n), inp, num), inp, num };
  });
  const spot = h("sl-input", { size: "small", placeholder: t("Spot color name (optional)"), clearable: true });
  spot.addEventListener("sl-change", () => commit(true));
  const gamut = h("div.of-cmyk__gamut.hidden");
  const fix = button("Use the printable color", () => commit(true));
  gamut.append(h("sl-icon", { name: "exclamation-triangle" }), h("span", t("Out of the CMYK gamut")), fix);
  const el = h("div.of-cmyk", inputs.map((x) => x.el), spot, gamut);
  function commit(final) {
    const ctx = getColorContext(app.doc);
    apply({ cmyk: vals.slice(), color: ctx.cmykToHex(vals), spot: spot.value.trim() || undefined }, final);
  }
  function sync() {
    const doc = app.doc;
    if (!doc) return;
    const ctx = getColorContext(doc);
    const p = current();
    const v = p && Array.isArray(p.cmyk) ? p.cmyk : p?.color ? ctx.rgbToCmyk(p.color) : [0, 0, 0, 0];
    v.forEach((x, i) => {
      vals[i] = x;
      inputs[i].inp.value = String(x);
      inputs[i].num.textContent = String(x);
    });
    if (spot.value !== (p?.spot || "")) spot.value = p?.spot || "";
    gamut.classList.toggle("hidden", !p?.color || Array.isArray(p.cmyk) || ctx.inGamut(p.color));
  }
  return { el, sync };
}
