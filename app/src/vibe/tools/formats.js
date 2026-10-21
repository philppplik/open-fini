// OpenFini tools for file formats: what can be opened or converted, and color palettes (GPL text / hex lists in,
// GPL text out). Palette BINARY files (ASE, ACO) cannot travel through chat: the user imports them with File > Swatches.
import { tool, S, requireDoc } from "./helpers.js";
import { FORMAT_VERDICTS, verdictForExtension } from "../../platform/format-verdicts.js";
import { describeSupportedTypes } from "../../platform/file-types.js";

export function formatTools(app) {
  return [
    tool("list_supported_formats", "Lists which file formats OpenFini can open, write or only handle through an export route, with the reason and the best conversion route for each (PSD, AI, INDD, Affinity, Figma, TIFF, OpenRaster, palettes, fonts ...). Pass an extension to get the verdict for one file type. Reading only.", {
      extension: S.str("File extension such as afdesign, psd, tiff (optional)"),
    }, [], (a) => {
      if (a.extension) {
        const v = verdictForExtension(a.extension);
        if (!v) return { extension: a.extension, status: "unknown", route: "OpenFini does not know this format. Ask the user to export PDF, SVG, PSD, TIFF or PNG from the source application." };
        return v;
      }
      return { registeredWithTheOs: describeSupportedTypes().map((t) => ({ name: t.name, extensions: t.extensions })), verdicts: FORMAT_VERDICTS, note: "status: supported = opens natively; partial = best effort or flattened; export-route = only via export from the vendor application; not-possible = not feasible here." };
    }, { readOnly: true }),

    tool("import_palette_from_text", "Adds colors to the swatches of the active document from GIMP palette (.gpl) text or a list of hex colors (one per line, optionally 'name #rrggbb', or comma separated). One undo step; duplicates are skipped.", {
      text: S.str("GPL file contents or hex colors"),
    }, ["text"], async (a) => {
      requireDoc(app);
      const E = await import("../../engine/formats/palette.js");
      const { addSwatches } = await import("../../core/import-raster.js");
      const colors = /^\s*GIMP Palette/i.test(a.text) ? E.readGpl(a.text).colors : E.readHexList(a.text);
      if (!colors.length) throw new Error("No colors found. Give GPL text or hex colors such as #ff6b35.");
      const r = addSwatches(app, colors);
      return { ok: true, ...r, totalSwatches: app.doc.swatches.length };
    }),

    tool("export_palette", "Returns the swatches of the active document as GIMP palette (.gpl) text. Reading only (it does not save a file; the user can use File > Swatches to save GPL, ASE or ACO).", {}, [], async () => {
      requireDoc(app);
      const { writeGpl } = await import("../../engine/formats/palette.js");
      const colors = app.doc.swatches.map((s) => ({ name: s.name, color: s.color }));
      return { count: colors.length, gpl: writeGpl(colors, app.doc.name) };
    }, { readOnly: true }),
  ];
}
