// The format research verdicts (docs/file-format-research.md) as data: what OpenFini does with each file format and
// why. Used by the Vibe tool `list_supported_formats` and the tests; the single table of OS-registered types is
// platform/file-types.js. Pure data, no DOM.
//
// status: 'supported' (opens / writes natively) | 'partial' (best effort or flattened) | 'export-route' (only through an
// export from the vendor application) | 'not-possible' (cannot be done legitimately or in a browser/webview).

/** @typedef {{ id: string, name: string, extensions: string[], status: 'supported'|'partial'|'export-route'|'not-possible', read: string, write: string, route: string }} FormatVerdict */

/** @type {FormatVerdict[]} */
export const FORMAT_VERDICTS = [
  { id: "ofini", name: "OpenFini document", extensions: ["ofini"], status: "supported", read: "yes", write: "yes", route: "Native format." },
  { id: "psd", name: "Photoshop PSD / PSB", extensions: ["psd", "psb"], status: "supported", read: "layers, masks, groups, text", write: "PSD 8-bit RGB", route: "Public Adobe specification." },
  { id: "pdf", name: "PDF", extensions: ["pdf"], status: "supported", read: "editable Layout pages (pdf.js)", write: "export", route: "Public ISO 32000." },
  { id: "ai", name: "Illustrator AI", extensions: ["ai"], status: "partial", read: "PDF-compatible content only", write: "no", route: "Opens the PDF stream; Illustrator-only data is not available. Save with Create PDF Compatible File, or export PDF / SVG." },
  { id: "eps", name: "EPS / PostScript", extensions: ["eps", "ps"], status: "partial", read: "EPS with a PDF inside, or the TIFF preview of a DOS EPS", write: "no", route: "OpenFini does not execute PostScript. Export PDF or SVG from the source application." },
  { id: "idml", name: "InDesign IDML", extensions: ["idml"], status: "supported", read: "pages, shapes, text frames, swatches", write: "no", route: "Public Adobe format." },
  { id: "indd", name: "InDesign INDD", extensions: ["indd", "indt"], status: "export-route", read: "no", write: "no", route: "Proprietary. In InDesign use File > Save a Copy As > IDML, or export PDF." },
  { id: "inx", name: "InDesign INX", extensions: ["inx"], status: "export-route", read: "no", write: "no", route: "Legacy interchange for InDesign CS2; use IDML or PDF." },
  { id: "xd", name: "Adobe XD", extensions: ["xd"], status: "export-route", read: "no", write: "no", route: "Discontinued, undocumented; export SVG or PDF from XD." },
  { id: "afdesign", name: "Affinity (.af, .afdesign, .afphoto, .afpub)", extensions: ["af", "afdesign", "afphoto", "afpub"], status: "export-route", read: "embedded plain preview image only (if present)", write: "no", route: "Proprietary, no public specification or SDK. In Affinity use File > Export to PDF, PSD or SVG, then open that file." },
  { id: "figma", name: "Figma .fig", extensions: ["fig"], status: "export-route", read: "no", write: "no", route: "Proprietary. Export frames to PDF, SVG or PNG from Figma." },
  { id: "sketch", name: "Sketch", extensions: ["sketch"], status: "partial", read: "best effort (documented ZIP + JSON)", write: "no", route: "Open format description by Sketch." },
  { id: "svg", name: "SVG", extensions: ["svg"], status: "supported", read: "editable vector", write: "export", route: "W3C standard." },
  { id: "raster", name: "PNG, JPEG, WebP, BMP, AVIF", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "avif"], status: "supported", read: "yes (browser decoders)", write: "PNG, JPEG, WebP", route: "Decoded by the browser engine." },
  { id: "gif", name: "Animated GIF", extensions: ["gif"], status: "supported", read: "every frame as a layer", write: "no", route: "Own GIF decoder; no timeline yet." },
  { id: "tiff", name: "TIFF", extensions: ["tif", "tiff"], status: "supported", read: "pages as layers; none, LZW, PackBits, Deflate; 1-16 bit; CMYK naive", write: "no", route: "Public TIFF 6.0 specification. JPEG-in-TIFF, BigTIFF, planar and Lab are not supported." },
  { id: "ora", name: "OpenRaster", extensions: ["ora"], status: "supported", read: "layers, groups, opacity, blend modes", write: "yes (plain pixel layers)", route: "Open specification (openraster.org)." },
  { id: "kra", name: "Krita", extensions: ["kra"], status: "partial", read: "flattened merged image only", write: "no", route: "Krita layer data is not interpreted; export OpenRaster or PSD from Krita for layers." },
  { id: "xcf", name: "GIMP XCF", extensions: ["xcf"], status: "export-route", read: "not yet (documented format, feasible later)", write: "no", route: "In GIMP use Export As > OpenRaster or PSD." },
  { id: "ico", name: "ICO / CUR", extensions: ["ico", "cur"], status: "supported", read: "largest image", write: "no", route: "Public format." },
  { id: "heic", name: "HEIC / HEIF", extensions: ["heic", "heif"], status: "not-possible", read: "only where the OS or browser decodes it", write: "no", route: "Patent-encumbered; no bundled decoder. Convert to JPEG, PNG or AVIF first." },
  { id: "raw", name: "Camera RAW (CR2, NEF, ARW), DNG", extensions: ["dng", "cr2", "nef", "arw"], status: "not-possible", read: "no", write: "no", route: "Vendor specific; DNG is TIFF based but needs a full raw pipeline. Develop in a RAW converter and export TIFF or JPEG." },
  { id: "emf", name: "WMF / EMF", extensions: ["wmf", "emf"], status: "export-route", read: "no", write: "no", route: "Documented by Microsoft; a vector subset reader is possible later. Export SVG or PDF from the source." },
  { id: "dxf", name: "DXF / DWG", extensions: ["dxf", "dwg"], status: "export-route", read: "no", write: "no", route: "Out of scope for a design suite; export SVG or PDF from the CAD program." },
  { id: "palettes", name: "Palettes GPL, ASE, ACO", extensions: ["gpl", "ase", "aco"], status: "supported", read: "into document swatches", write: "yes (all three)", route: "GPL text; ACO per Adobe's Photoshop file format spec; ASE per the community description." },
  { id: "abr", name: "Photoshop brushes ABR", extensions: ["abr"], status: "not-possible", read: "no", write: "no", route: "Complex, partly undocumented; not implemented." },
  { id: "icc", name: "ICC profiles", extensions: ["icc", "icm"], status: "not-possible", read: "no", write: "no", route: "No color-managed pipeline yet." },
  { id: "text", name: "Text and data files", extensions: ["txt", "md", "markdown", "tex", "bib", "json", "yaml", "yml", "xml", "toml", "ini", "html", "css", "js", "srt", "vtt"], status: "supported", read: "Code studio", write: "yes", route: "Markdown and LaTeX have a live preview." },
  { id: "csv", name: "CSV / TSV", extensions: ["csv", "tsv"], status: "supported", read: "Code studio, or Layout > Import CSV / TSV as Table", write: "table export", route: "Delimiter detection and header toggle in the import dialog." },
  { id: "fonts", name: "Fonts TTF, OTF, WOFF, WOFF2, TTC", extensions: ["ttf", "otf", "woff", "woff2", "ttc", "otc"], status: "supported", read: "Type panel, Add font file (WOFF unwrapped, TTC first font, WOFF2 on screen only)", write: "no", route: "WOFF2 is not decoded to TTF, so PDF export cannot embed it." },
  { id: "docx", name: "Word, ODT, RTF", extensions: ["docx", "odt", "rtf"], status: "supported", read: "Office Studio", write: "Office Studio", route: "See the Office Studio documentation." },
];

/** The verdict whose extension list contains `ext` (no dot), or null. */
export function verdictForExtension(ext) {
  const e = String(ext || "").replace(/^\./, "").toLowerCase();
  return FORMAT_VERDICTS.find((v) => v.extensions.includes(e)) || null;
}
