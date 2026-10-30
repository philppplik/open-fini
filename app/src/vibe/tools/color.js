// Vibe tools for print color management (group "Color"): document color mode and settings, CMYK conversion of
// layers, and the print preflight. Logic: core/color-doc.js, engine/color/ (docs/color-management.md).
import { tool, S, requireDoc, nodesById } from "./helpers.js";

const cm = () => import("../../core/color-doc.js");

export function colorTools(app) {
  return [
    tool("set_color_mode", "Sets the color settings of the active document: color mode rgb (screen) or cmyk (print: the Color panel shows CMYK sliders and PDF export writes DeviceCMYK), the RGB working space, the rendering intent and black point compensation. The CMYK output profile itself (a .icc file) can only be loaded by the user in File > Color Settings; without one OpenFini uses a built-in approximation. One undo step.", {
      mode: S.str("rgb or cmyk", { enum: ["rgb", "cmyk"] }),
      rgbSpace: S.str("RGB working space", { enum: ["srgb", "display-p3", "adobe-rgb"] }),
      intent: S.str("Rendering intent", { enum: ["perceptual", "relative", "saturation", "absolute"] }),
      blackPointCompensation: S.bool("Black point compensation (default true)"),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const { colorSettings, refreshCmykPreviews, getColorContext } = await cm();
      const s = colorSettings(doc);
      if (a.mode) s.mode = a.mode;
      if (a.rgbSpace) s.rgb = a.rgbSpace;
      if (a.intent) s.intent = ["perceptual", "relative", "saturation", "absolute"].indexOf(a.intent);
      if (a.blackPointCompensation !== undefined) s.bpc = !!a.blackPointCompensation;
      doc.tx("Color Settings", () => {
        doc.set(doc.settings, { color: s });
        refreshCmykPreviews(doc);
      });
      app.emit("colors");
      app.emit("render");
      const ctx = getColorContext(doc);
      return { ok: true, settings: ctx.settings, cmykProfile: ctx.profileName, approximate: ctx.approximate };
    }),

    tool("convert_colors", "Converts the fill and stroke colors (solid and gradient stops) of layers to native CMYK values (stored in percent and used as-is in print PDFs) or back to plain RGB, through the document's color settings. Without ids it converts the whole document and its swatches. One undo step. RGB colors outside the CMYK gamut change to the closest printable color.", {
      to: S.str("cmyk or rgb", { enum: ["cmyk", "rgb"] }),
      ids: S.ids("Layer ids (optional; default: every layer and the swatches)"),
    }, ["to"], async (a) => {
      const doc = requireDoc(app);
      const nodes = a.ids?.length ? nodesById(app, a.ids) : null;
      const { convertColors, getColorContext } = await cm();
      const changed = convertColors(doc, { nodes, to: a.to });
      app.emit("colors");
      return { ok: true, changed, approximate: getColorContext(doc).approximate };
    }),

    tool("preflight_pdf", "Checks the document for print output without saving anything: RGB objects, spot colors, total ink, image resolution below 300 ppi, transparency, missing bleed, fonts that cannot be embedded and the output profile, for PDF/X-1a, PDF/X-4 or plain PDF. Returns issues with severity and page. This is OpenFini's own check list, not a certified PDF/X validator. Reading only.", {
      standard: S.str("x1a, x4 or none (default x4)", { enum: ["x1a", "x4", "none"] }),
      pages: { type: "array", items: { type: "integer", minimum: 1 }, description: "1-based page numbers (default: all)" },
    }, [], async (a) => {
      const doc = requireDoc(app);
      const pages = a.pages?.length ? a.pages.map((n) => doc.pages[n - 1]).filter(Boolean) : doc.pages;
      if (!pages.length) throw new Error("None of these pages exist.");
      const std = a.standard === "none" ? null : a.standard || "x4";
      const { printPdf } = await cm();
      const r = await printPdf(app, pages, { standard: std, bleed: true, dryRun: true });
      const fill = (m, p) => m.replace(/\{(\w+)\}/g, (_, k) => String(p?.[k] ?? ""));
      return {
        standard: std || "plain PDF",
        issues: r.preflight.issues.map((i) => ({ severity: i.severity, code: i.code, page: i.page, message: fill(i.message, i.params) })),
        checked: r.preflight.checked,
        note: "Not a certified PDF/X validation." + (r.approximate ? " No CMYK ICC profile is loaded: colors use the built-in approximation." : ""),
      };
    }, { readOnly: true }),
  ];
}
