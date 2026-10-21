// File-format commands: import / export color palettes (GPL, ASE, ACO), export a Pixel document as OpenRaster.
// The format engines live in engine/formats and are loaded lazily; see docs/file-compat.md.
import { downloadName } from "../core/util.js";
import { platform } from "../platform/index.js";

const hasDoc = (a) => !!a.doc;
const PALETTE = {
  gpl: { label: "GIMP palette (.gpl)", mime: "text/plain" },
  ase: { label: "Adobe Swatch Exchange (.ase)", mime: "application/octet-stream" },
  aco: { label: "Photoshop swatches (.aco)", mime: "application/octet-stream" },
};

export function registerFormatCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });

  def("file.importPalette", "Import Palette (GPL, ASE, ACO)…", async (a) => {
    const files = await platform.openFiles({ accept: [{ name: "Color palettes", extensions: ["gpl", "ase", "aco"] }], multiple: true });
    for (const f of files) {
      try {
        await (await import("../core/import-raster.js")).importPaletteFile(a, f);
      } catch (err) {
        a.toast(err.message, "danger", 6000);
      }
    }
  }, { enabled: hasDoc, icon: "palette" });

  for (const [fmt, info] of Object.entries(PALETTE)) {
    def(`file.exportPalette.${fmt}`, `Export Swatches as ${info.label}…`, async (a) => {
      try {
        const bytes = await (await import("../core/import-raster.js")).exportPaletteText(a, fmt);
        const res = await platform.saveFile({ suggestedName: downloadName(`${a.doc.name} swatches`, fmt), bytes, mime: info.mime, filters: [{ name: info.label, extensions: [fmt] }] });
        if (res) a.toast(`Saved ${a.doc.swatches.length} swatches to ${res.name}.`, "success", 2600);
      } catch (err) {
        a.toast(err.message, "danger", 6000);
      }
    }, { enabled: hasDoc });
  }

  def("file.exportOra", "Export as OpenRaster (.ora)…", async (a) => {
    try {
      a.status("Writing OpenRaster…");
      const { bytes, layers, skipped } = await (await import("../core/import-raster.js")).exportOraFile(a);
      const res = await platform.saveFile({ suggestedName: downloadName(a.doc.name, "ora"), bytes, mime: "image/openraster", filters: [{ name: "OpenRaster", extensions: ["ora"] }] });
      if (res) a.toast(`Saved ${layers} layer${layers === 1 ? "" : "s"} to ${res.name}${skipped ? ` (${skipped} non-pixel or transformed layer${skipped === 1 ? " is" : "s are"} only in the merged image)` : ""}.`, skipped ? "warning" : "success", 4200);
    } catch (err) {
      a.toast(err.message, "danger", 6000);
    } finally {
      a.status("");
    }
  }, { enabled: (a) => !!a.doc && a.studio === "pixel" });
}
