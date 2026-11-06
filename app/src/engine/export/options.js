// Export options: the declarative schema behind the Export dialog, presets and the Vibe export tools. Pure (no DOM).
// See docs/export.md.
//
// Public API
//   EXPORT_FORMATS                    [{ id, label, ext, mime, kind: "raster"|"svg"|"pdf"|"psd", alpha, encoder? }]
//   EXPORT_OPTIONS                    [{ key, type, label, group, advanced, formats, default, when?, choices?, ... }]
//   EXPORT_GROUPS                     ordered group ids with their headings
//   BUILTIN_PRESETS                   [{ id, name, settings }]
//   normalizeExportSettings(input, env)  -> complete, valid settings (unknown keys dropped, legacy keys mapped)
//   visibleOptions(st, env)           -> the option definitions that change the output for these settings
//   availableFormats(env)             -> the formats this browser can encode
//   choicesOf(def, st, env)           -> the enum choices that apply now
//   parsePageRange(text, count)       -> 0-based page indices ("1-3, 5, 8-")
//   parseSizes(text)                  -> [{ kind: "scale"|"width"|"height"|"ppi", value, suffix }] ("1x, 2x, 512w, 64h, 300ppi")
//   formatFileName(template, vars)    -> safe file name without extension ("{name}-{page}{size}")
//   spreadGroups(indices, facing)     -> [[i], [j, k], ...] pages paired as on the pasteboard (page 1 alone, then pairs)
//   planExport(st, info)              -> { jobs, files, warnings }: one job per output file, with size and name
//   validPresetList(list), presetFile(presets), readPresetFile(text)
// Invariants
//   * Every option listed for a format changes that format's output; `when` hides options that would not (for example
//     PDF color conversion when a PDF/X standard already implies CMYK). The dialog and the Vibe tools use the same list.
//   * Defaults reproduce the output of the previous fixed dialog (PNG at 1x, page background, quality 90 %).
//   * Labels are English source strings marked with N_ (translated where they are shown).

const N_ = (s) => s; // marks text for the i18n extractor (engine code does not import the i18n runtime)

/** English text of a message template (plural branches resolved for English), for errors and warnings. */
const fill = (tpl, p = {}) => tpl.replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (m, k, one, other) => (p[k] === 1 ? one : other).replace("#", String(p[k]))).replace(/\{(\w+)\}/g, (m, k) => String(p[k] ?? ""));
/** An Error whose `i18n` holds [template, params], so the UI can show it translated. */
function fail(tpl, params) {
  const err = new Error(fill(tpl, params));
  err.i18n = [tpl, params];
  return err;
}

export const EXPORT_FORMATS = [
  { id: "png", label: N_("PNG — lossless, transparency"), ext: "png", mime: "image/png", kind: "raster", alpha: true },
  { id: "jpeg", label: N_("JPEG — photos, small files"), ext: "jpg", mime: "image/jpeg", kind: "raster", alpha: false },
  { id: "webp", label: N_("WebP — modern, small files"), ext: "webp", mime: "image/webp", kind: "raster", alpha: true, encoder: "image/webp" },
  { id: "avif", label: N_("AVIF — next generation, smallest files"), ext: "avif", mime: "image/avif", kind: "raster", alpha: true, encoder: "image/avif" },
  { id: "tiff", label: N_("TIFF — print, CMYK, lossless"), ext: "tif", mime: "image/tiff", kind: "raster", alpha: true },
  { id: "svg", label: N_("SVG — scalable vector"), ext: "svg", mime: "image/svg+xml", kind: "svg", alpha: true },
  { id: "pdf", label: N_("PDF — print and share"), ext: "pdf", mime: "application/pdf", kind: "pdf", alpha: false },
  { id: "psd", label: N_("PSD — Photoshop, one file layer per layer"), ext: "psd", mime: "image/vnd.adobe.photoshop", kind: "psd", alpha: true },
];
const FORMAT = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.id, f]));
export const formatInfo = (id) => FORMAT[id] || FORMAT.png;

const RASTER = ["png", "jpeg", "webp", "avif", "tiff"];
const LOSSY = ["jpeg", "webp", "avif"];
const WITH_META = ["png", "jpeg", "tiff", "svg", "pdf"];
const ALL = EXPORT_FORMATS.map((f) => f.id);

export const EXPORT_GROUPS = [
  { id: "general", label: N_("General") },
  { id: "size", label: N_("Size") },
  { id: "output", label: N_("Output") },
  { id: "print", label: N_("Print") },
  { id: "images", label: N_("Images") },
  { id: "compression", label: N_("Compression") },
  { id: "text", label: N_("Fonts and text") },
  { id: "viewer", label: N_("Viewer") },
  { id: "files", label: N_("Files") },
  { id: "metadata", label: N_("Metadata") },
];

const isRaster = (st) => RASTER.includes(st.format);
const cmykOutput = (st, env) => st.format === "pdf" && (st.standard !== "none" || st.pdfColor === "cmyk" || !!env.cmykDoc);
const multiPage = (env) => (env.pages || 1) > 1;

/**
 * Option definitions. type: enum | number | bool | text | color. `formats` limits an option to output formats;
 * `when(st, env)` hides it when it would not change the output; enum `choices` entries may carry their own `when`.
 * `default` may be a function of env (document-dependent defaults such as embedding a wide-gamut profile).
 */
export const EXPORT_OPTIONS = [
  // ---------------------------------------------------------------- general
  {
    key: "scope", type: "enum", label: N_("Pages"), group: "general", formats: ALL, default: "page",
    choices: [
      { value: "page", label: N_("Current page") },
      { value: "all", label: N_("All pages"), when: (st, env) => multiPage(env) },
      { value: "range", label: N_("Page range"), when: (st, env) => multiPage(env) },
      { value: "selection", label: N_("Selection only"), when: (st, env) => !!env.hasSelection && (isRaster(st) || st.format === "svg") },
      { value: "layers", label: N_("Each top-level layer as a file"), when: (st, env) => (env.layers ?? 1) > 0 && (isRaster(st) || st.format === "svg") },
    ],
  },
  { key: "range", type: "text", label: N_("Page range"), placeholder: "1-3, 5, 8-", hint: N_("Page numbers and ranges, separated by commas. \"8-\" means page 8 to the end."), group: "general", formats: ALL, default: "", when: (st) => st.scope === "range" },
  { key: "spreads", type: "bool", label: N_("Spreads (facing pages side by side)"), group: "general", formats: ["pdf"], default: false, when: (st, env) => !!env.facing && multiPage(env) && st.scope !== "page" },
  { key: "padding", type: "number", label: N_("Padding"), unit: "px", min: 0, max: 2000, precision: 0, group: "general", formats: [...RASTER, "svg"], default: 0, advanced: true, when: (st) => st.scope === "selection" || st.scope === "layers" },

  // ---------------------------------------------------------------- size (raster)
  {
    key: "sizeMode", type: "enum", label: N_("Size"), group: "size", formats: RASTER, default: "scale",
    choices: [
      { value: "scale", label: N_("Scale") },
      { value: "width", label: N_("Width") },
      { value: "height", label: N_("Height") },
      { value: "ppi", label: N_("Resolution") },
    ],
    when: (st) => !st.sizes,
  },
  { key: "scale", type: "number", label: N_("Scale"), unit: "×", min: 0.01, max: 16, precision: 2, step: 0.25, group: "size", formats: RASTER, default: 1, when: (st) => !st.sizes && st.sizeMode === "scale" },
  { key: "width", type: "number", label: N_("Width"), unit: "px", min: 1, max: 16384, precision: 0, group: "size", formats: RASTER, default: 1920, when: (st) => !st.sizes && st.sizeMode === "width" },
  { key: "height", type: "number", label: N_("Height"), unit: "px", min: 1, max: 16384, precision: 0, group: "size", formats: RASTER, default: 1080, when: (st) => !st.sizes && st.sizeMode === "height" },
  { key: "ppi", type: "number", label: N_("Resolution"), unit: "ppi", min: 36, max: 2400, precision: 0, group: "size", formats: RASTER, default: 300, hint: N_("Pixels per inch of the printed page size; also written into the file."), when: (st) => !st.sizes && st.sizeMode === "ppi" },
  { key: "sizes", type: "text", label: N_("Export several sizes"), placeholder: "1x, 2x, 3x", hint: N_("One file per size: scales (2x), widths (512w), heights (64h) or resolutions (300ppi), separated by commas. Overrides Size."), group: "files", formats: RASTER, default: "", advanced: true },

  // ---------------------------------------------------------------- output
  { key: "quality", type: "number", label: N_("Quality"), unit: "%", min: 1, max: 100, precision: 0, group: "output", formats: [...LOSSY, "svg"], default: 90, when: (st) => st.format !== "svg" || st.svgImages === "jpeg" },
  {
    key: "background", type: "enum", label: N_("Background"), group: "output", formats: RASTER, default: "page",
    choices: [
      { value: "page", label: N_("Page color") },
      { value: "transparent", label: N_("Transparent"), when: (st) => formatInfo(st.format).alpha && (st.format !== "tiff" || st.colorMode === "rgb") },
      { value: "white", label: N_("White") },
      { value: "custom", label: N_("Custom color") },
    ],
  },
  { key: "bgColor", type: "color", label: N_("Background color"), group: "output", formats: RASTER, default: "#ffffff", when: (st) => st.background === "custom" },
  {
    key: "colorMode", type: "enum", label: N_("Color"), group: "output", formats: RASTER, default: "rgb",
    choices: [
      { value: "rgb", label: N_("Color (RGB)") },
      { value: "gray", label: N_("Grayscale") },
      { value: "indexed", label: N_("Indexed colors (PNG-8)"), when: (st) => st.format === "png" },
      { value: "cmyk", label: N_("CMYK (document color settings)"), when: (st) => st.format === "tiff" },
    ],
  },
  { key: "colors", type: "number", label: N_("Colors"), min: 2, max: 256, precision: 0, group: "output", formats: ["png"], default: 256, when: (st) => st.colorMode === "indexed" },
  { key: "dither", type: "bool", label: N_("Dither"), hint: N_("Mixes palette colors to imitate gradients; turn off for flat artwork and smaller files."), group: "output", formats: ["png"], default: true, when: (st) => st.colorMode === "indexed" },
  { key: "embedProfile", type: "bool", label: N_("Embed color profile"), hint: N_("Tags the file with the document's RGB working space, or its CMYK profile for CMYK TIFF."), group: "output", formats: ["png", "jpeg", "tiff"], default: (env) => !!env.wideGamut, advanced: true, when: (st) => st.colorMode !== "gray" },
  { key: "interlace", type: "bool", label: N_("Interlaced (Adam7)"), hint: N_("Shows a coarse preview while the file loads; files get slightly larger."), group: "compression", formats: ["png"], default: false, advanced: true },
  { key: "pngLevel", type: "number", label: N_("Compression level"), min: 0, max: 9, precision: 0, group: "compression", formats: ["png"], default: 6, advanced: true, hint: N_("0 = fastest and largest, 9 = smallest. Lossless at every level.") },
  {
    key: "tiffCompression", type: "enum", label: N_("Compression"), group: "compression", formats: ["tiff"], default: "lzw",
    choices: [
      { value: "lzw", label: N_("LZW (lossless, widely supported)") },
      { value: "deflate", label: N_("ZIP / Deflate (lossless, smaller)") },
      { value: "packbits", label: N_("PackBits (lossless, fast)") },
      { value: "none", label: N_("None") },
    ],
  },

  // ---------------------------------------------------------------- SVG
  { key: "svgBackground", type: "bool", label: N_("Include page color"), group: "output", formats: ["svg"], default: true },
  {
    key: "svgUnit", type: "enum", label: N_("Units"), group: "output", formats: ["svg"], default: "px",
    choices: [{ value: "px", label: N_("Pixels (px)") }, { value: "pt", label: N_("Points (pt)") }, { value: "mm", label: N_("Millimeters (mm)") }, { value: "cm", label: N_("Centimeters (cm)") }, { value: "in", label: N_("Inches (in)") }],
    when: (st) => !st.svgResponsive,
  },
  { key: "svgResponsive", type: "bool", label: N_("Responsive (no fixed width and height)"), group: "output", formats: ["svg"], default: false, advanced: true },
  { key: "svgPrecision", type: "number", label: N_("Decimal places"), min: 0, max: 6, precision: 0, group: "compression", formats: ["svg"], default: 3, advanced: true, hint: N_("Fewer decimals make smaller files; 1 or 2 are enough for screen graphics.") },
  {
    key: "svgImages", type: "enum", label: N_("Embedded images"), group: "images", formats: ["svg"], default: "png", advanced: true,
    choices: [{ value: "png", label: N_("PNG (lossless)") }, { value: "jpeg", label: N_("JPEG (smaller, opaque images only)") }],
  },
  {
    key: "svgFonts", type: "enum", label: N_("Fonts"), group: "text", formats: ["svg"], default: "reference", advanced: true,
    choices: [{ value: "reference", label: N_("Reference by name") }, { value: "embed", label: N_("Embed the fonts you added"), when: (st, env) => !!env.userFonts }],
    when: (st, env) => !!env.userFonts && !!env.hasText,
  },

  // ---------------------------------------------------------------- PDF / print
  {
    key: "standard", type: "enum", label: N_("PDF standard"), group: "print", formats: ["pdf"], default: "none",
    choices: [{ value: "none", label: N_("Plain PDF") }, { value: "x1a", label: N_("PDF/X-1a:2003 (CMYK, no transparency)") }, { value: "x4", label: N_("PDF/X-4 (CMYK, live transparency)") }],
  },
  {
    key: "pdfColor", type: "enum", label: N_("Color conversion"), group: "print", formats: ["pdf"], default: "rgb",
    choices: [{ value: "rgb", label: N_("Keep RGB") }, { value: "cmyk", label: N_("Convert to CMYK (document color settings)") }],
    when: (st, env) => st.standard === "none" && !env.cmykDoc,
  },
  {
    key: "bleed", type: "enum", label: N_("Bleed"), group: "print", formats: ["pdf"], default: "none",
    choices: [{ value: "none", label: N_("None") }, { value: "document", label: N_("Document bleed") }, { value: "custom", label: N_("Custom") }],
  },
  { key: "bleedMm", type: "number", label: N_("Bleed"), unit: "mm", min: 0, max: 50, precision: 1, group: "print", formats: ["pdf"], default: 3, when: (st) => st.bleed === "custom" },
  { key: "cropMarks", type: "bool", label: N_("Crop marks"), group: "print", formats: ["pdf"], default: false },
  { key: "registrationMarks", type: "bool", label: N_("Registration marks"), group: "print", formats: ["pdf"], default: false, advanced: true },
  { key: "colorBars", type: "bool", label: N_("Color bars"), group: "print", formats: ["pdf"], default: false, advanced: true },
  { key: "pageInfo", type: "bool", label: N_("Page information"), hint: N_("File name, page number and date in the slug. Not available for PDF/X (it uses a font that is not embedded)."), group: "print", formats: ["pdf"], default: false, advanced: true, when: (st) => st.standard === "none" },
  { key: "rasterDpi", type: "number", label: N_("Effects resolution"), unit: "dpi", min: 72, max: 600, precision: 0, group: "images", formats: ["pdf", "svg"], default: 200, hint: N_("Live effects, masks and adjustments are flattened to images at this resolution; everything else stays vector.") },
  { key: "downsample", type: "bool", label: N_("Downsample images"), hint: N_("Images above 1.5 times the target resolution are resampled to it."), group: "images", formats: ["pdf"], default: false, advanced: true },
  { key: "downsamplePpi", type: "number", label: N_("Target resolution"), unit: "ppi", min: 36, max: 2400, precision: 0, group: "images", formats: ["pdf"], default: 300, advanced: true, when: (st) => st.downsample },
  {
    key: "imageCompression", type: "enum", label: N_("Image compression"), group: "images", formats: ["pdf"], default: "auto", advanced: true,
    choices: [
      { value: "auto", label: N_("Automatic (keep JPEG photos, lossless for the rest)") },
      { value: "jpeg", label: N_("JPEG (lossy, opaque images)"), when: (st, env) => !cmykOutput(st, env) },
      { value: "zip", label: N_("ZIP (lossless)") },
    ],
  },
  { key: "imageQuality", type: "number", label: N_("Image quality"), unit: "%", min: 1, max: 100, precision: 0, group: "images", formats: ["pdf"], default: 80, advanced: true, when: (st) => st.imageCompression === "jpeg" },
  { key: "embedFonts", type: "bool", label: N_("Embed fonts (subset)"), hint: N_("Off: text uses the standard PDF fonts (Helvetica, Times, Courier) and the file gets smaller, but looks different."), group: "text", formats: ["pdf"], default: true, advanced: true, when: (st, env) => st.standard === "none" && !!env.hasText },
  { key: "compress", type: "bool", label: N_("Compress text and line art"), group: "compression", formats: ["pdf"], default: true, advanced: true },
  {
    key: "pageLayout", type: "enum", label: N_("Open in viewer as"), group: "viewer", formats: ["pdf"], default: "default", advanced: true,
    choices: [{ value: "default", label: N_("Viewer default") }, { value: "single", label: N_("Single page") }, { value: "continuous", label: N_("Continuous") }, { value: "facing", label: N_("Two pages") }, { value: "facingCover", label: N_("Two pages with cover") }],
  },

  // ---------------------------------------------------------------- files and metadata
  { key: "naming", type: "text", label: N_("File names"), placeholder: "{name}-{page}{size}", hint: N_("{name} document, {page} page number, {pageName}, {layer}, {size} size suffix, {w} and {h} pixels, {date}. Missing parts are added when files would get the same name."), group: "files", formats: ALL, default: "{name}", advanced: true },
  { key: "metadata", type: "bool", label: N_("Include metadata"), group: "metadata", formats: WITH_META, default: true, advanced: true },
  { key: "metaTitle", type: "text", label: N_("Title"), placeholder: N_("Document name"), group: "metadata", formats: WITH_META, default: "", advanced: true, when: (st) => st.metadata },
  { key: "metaAuthor", type: "text", label: N_("Author"), group: "metadata", formats: WITH_META, default: "", advanced: true, when: (st) => st.metadata },
  { key: "metaCopyright", type: "text", label: N_("Copyright"), group: "metadata", formats: WITH_META, default: "", advanced: true, when: (st) => st.metadata },
  { key: "metaDescription", type: "text", label: N_("Description"), group: "metadata", formats: WITH_META, default: "", advanced: true, when: (st) => st.metadata },
  { key: "metaKeywords", type: "text", label: N_("Keywords"), placeholder: N_("comma separated"), group: "metadata", formats: WITH_META, default: "", advanced: true, when: (st) => st.metadata },
];
const BY_KEY = new Map(EXPORT_OPTIONS.map((o) => [o.key, o]));
export const optionDef = (key) => BY_KEY.get(key) || null;

export const BUILTIN_PRESETS = [
  { id: "web-png", name: N_("Web — PNG at 1x, 2x and 3x"), settings: { format: "png", sizes: "1x, 2x, 3x", naming: "{name}{size}", metadata: false } },
  { id: "web-jpeg", name: N_("Web — JPEG 80 %, no metadata"), settings: { format: "jpeg", quality: 80, metadata: false } },
  { id: "app-icons", name: N_("App icons — PNG 16 to 1024 px"), settings: { format: "png", sizes: "16w, 32w, 48w, 64w, 128w, 256w, 512w, 1024w", naming: "{name}-{w}", background: "transparent", metadata: false } },
  { id: "print-tiff", name: N_("Print — TIFF CMYK 300 ppi"), settings: { format: "tiff", sizeMode: "ppi", ppi: 300, colorMode: "cmyk", tiffCompression: "lzw", embedProfile: true } },
  { id: "pdf-hq", name: N_("High-quality print PDF"), settings: { format: "pdf", scope: "all", standard: "none", rasterDpi: 300, embedFonts: true } },
  { id: "pdf-x4", name: N_("Press quality — PDF/X-4"), settings: { format: "pdf", scope: "all", standard: "x4", bleed: "document", cropMarks: true, registrationMarks: true, colorBars: true, rasterDpi: 300, downsample: true, downsamplePpi: 300 } },
  { id: "pdf-x1a", name: N_("Press — PDF/X-1a:2003"), settings: { format: "pdf", scope: "all", standard: "x1a", bleed: "document", cropMarks: true, rasterDpi: 300, downsample: true, downsamplePpi: 300 } },
  { id: "pdf-small", name: N_("Smallest file size PDF"), settings: { format: "pdf", scope: "all", rasterDpi: 150, downsample: true, downsamplePpi: 150, imageCompression: "jpeg", imageQuality: 60, metadata: false } },
  { id: "svg-web", name: N_("SVG for the web"), settings: { format: "svg", svgResponsive: true, svgPrecision: 2, svgBackground: false, metadata: false } },
];

/** The default of one option for this document. */
const defaultOf = (def, env) => (typeof def.default === "function" ? def.default(env || {}) : def.default);

/** Formats the current browser can write (WebP and AVIF depend on the browser's encoder). */
export function availableFormats(env = {}) {
  return EXPORT_FORMATS.filter((f) => !f.encoder || !env.encoders || env.encoders.has(f.encoder));
}

/** The enum choices that apply now. */
export function choicesOf(def, st, env = {}) {
  return (def.choices || []).filter((c) => !c.when || c.when(st, env));
}

const active = (def, st, env) => def.formats.includes(st.format) && (!def.when || def.when(st, env));

/** Option definitions that change the output for these settings (in schema order). */
export function visibleOptions(st, env = {}) {
  return EXPORT_OPTIONS.filter((d) => active(d, st, env) && (d.type !== "enum" || choicesOf(d, st, env).length > 1));
}

/** Maps the settings of the previous dialog and of Settings ▸ Defaults (exportDefaults) onto the schema. */
function migrate(input) {
  const o = { ...input };
  if (o.format === "jpg") o.format = "jpeg";
  if (o.format === "tif") o.format = "tiff";
  if (typeof o.quality === "number" && o.quality > 0 && o.quality <= 1) o.quality = Math.round(o.quality * 100);
  if (o.transparent === true && o.background === undefined) o.background = "transparent";
  if (typeof o.bleed === "boolean") o.bleed = o.bleed ? "document" : "none";
  if (o.marks !== undefined && o.cropMarks === undefined) o.cropMarks = !!o.marks;
  return o;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Complete, valid settings: every option key present (invisible ones keep their defaults), values clamped and
 * enum values checked against the choices available for `env`. Unknown keys are dropped.
 * @param {object} input partial settings (dialog state, preset, Vibe tool arguments, legacy settings)
 * @param {object} [env] { pages, hasSelection, layers, facing, cmykDoc, wideGamut, encoders:Set, userFonts, hasText }
 */
export function normalizeExportSettings(input = {}, env = {}) {
  const src = migrate(input || {});
  const formats = availableFormats(env).map((f) => f.id);
  const st = { format: formats.includes(src.format) ? src.format : "png" };
  for (const def of EXPORT_OPTIONS) {
    const v = src[def.key];
    const d = defaultOf(def, env);
    let out = d;
    if (def.type === "bool") out = typeof v === "boolean" ? v : d;
    else if (def.type === "number") out = Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.min(def.max, Math.max(def.min, Number(v))) : d;
    else if (def.type === "text") out = typeof v === "string" ? v.slice(0, 500) : d;
    else if (def.type === "color") out = typeof v === "string" && COLOR_RE.test(v) ? v.toLowerCase() : d;
    else if (def.type === "enum") out = def.choices.some((c) => c.value === v) ? v : d;
    if (def.type === "number" && def.precision === 0) out = Math.round(out);
    st[def.key] = out;
  }
  // enum values that are not available for this document/format fall back to the first available choice
  // (twice: a choice may depend on an enum that is corrected later in the list)
  for (let pass = 0; pass < 2; pass++) {
    for (const def of EXPORT_OPTIONS) {
      if (def.type !== "enum" || !def.formats.includes(st.format)) continue;
      const avail = choicesOf(def, st, env);
      const d = defaultOf(def, env);
      if (avail.length && !avail.some((c) => c.value === st[def.key])) st[def.key] = avail.some((c) => c.value === d) ? d : avail[0].value;
    }
  }
  if (st.sizes && !parseSizes(st.sizes).length) st.sizes = "";
  return st;
}

/** Settings that differ from the defaults (what presets store). */
export function changedSettings(st, env = {}) {
  const out = { format: st.format };
  for (const def of EXPORT_OPTIONS) if (st[def.key] !== undefined && st[def.key] !== defaultOf(def, env)) out[def.key] = st[def.key];
  return out;
}

// ------------------------------------------------------------------ parsers and naming

/**
 * "1-3, 5, 8-" -> 0-based indices in the order given (duplicates removed). Empty text means every page.
 * @throws {Error} for text that is not a page list or names pages that do not exist
 */
export function parsePageRange(text, count) {
  const s = String(text ?? "").trim();
  if (!s) return Array.from({ length: count }, (_, i) => i);
  const out = [];
  for (const part of s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)?\s*(?:(-|–|\.\.)\s*(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw fail(N_("\"{part}\" is not a page number or range."), { part });
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : count) : a;
    if (a < 1 || b < 1 || a > count || b > count) throw fail(N_("The document has {count, plural, one {# page} other {# pages}}; \"{part}\" is outside."), { count, part });
    const step = a <= b ? 1 : -1;
    for (let p = a; p !== b + step; p += step) if (!out.includes(p - 1)) out.push(p - 1);
  }
  return out;
}

/** "1x, 2x, 512w, 64h, 300ppi" -> size specs (at most 24, duplicates removed). Invalid parts are ignored. */
export function parseSizes(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*(x|w|h|ppi|dpi)$/i.exec(raw.trim());
    if (!m) continue;
    const value = Number(m[1]);
    const unit = m[2].toLowerCase();
    let spec;
    if (unit === "x" && value >= 0.01 && value <= 16) spec = { kind: "scale", value, suffix: value === 1 ? "" : `@${value}x` };
    else if (unit === "w" && value >= 1 && value <= 16384) spec = { kind: "width", value: Math.round(value), suffix: `-${Math.round(value)}w` };
    else if (unit === "h" && value >= 1 && value <= 16384) spec = { kind: "height", value: Math.round(value), suffix: `-${Math.round(value)}h` };
    else if ((unit === "ppi" || unit === "dpi") && value >= 36 && value <= 2400) spec = { kind: "ppi", value: Math.round(value), suffix: `-${Math.round(value)}ppi` };
    if (spec && !out.some((x) => x.kind === spec.kind && x.value === spec.value)) out.push(spec);
    if (out.length >= 24) break;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
/** Fills a naming template; the result is a safe file name without extension. */
export function formatFileName(template, vars = {}) {
  const d = vars.date instanceof Date ? vars.date : new Date();
  const map = { ...vars, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  let s = String(template || "{name}").replace(/\{(\w+)\}/g, (m, k) => (map[k] === undefined || map[k] === null ? "" : String(map[k])));
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return s.slice(0, 180) || "export";
}

/** Pages paired as on the pasteboard with facing pages: page 1 alone (a right-hand page), then left/right pairs. */
export function spreadGroups(indices, facing) {
  if (!facing) return indices.map((i) => [i]);
  const spreadOf = (i) => (i === 0 ? 0 : Math.floor((i + 1) / 2));
  const groups = new Map();
  for (const i of indices) {
    const k = spreadOf(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a - b));
}

// ------------------------------------------------------------------ planning

/** Pixel size of an area for one size spec (or the Size settings). */
export function pixelSize(area, spec, dpi = 96) {
  let scale;
  if (spec.kind === "width") scale = spec.value / area.w;
  else if (spec.kind === "height") scale = spec.value / area.h;
  else if (spec.kind === "ppi") scale = spec.value / dpi;
  else scale = spec.value;
  return { scale, width: Math.max(1, Math.round(area.w * scale)), height: Math.max(1, Math.round(area.h * scale)), ppi: Math.round(dpi * scale * 100) / 100 };
}

/** The size specs of these settings (the multi-size list, or the single Size setting). */
export function sizeSpecs(st) {
  const list = st.sizes ? parseSizes(st.sizes) : [];
  if (list.length) return list;
  const value = st.sizeMode === "width" ? st.width : st.sizeMode === "height" ? st.height : st.sizeMode === "ppi" ? st.ppi : st.scale;
  return [{ kind: st.sizeMode || "scale", value, suffix: "" }];
}

/**
 * One job per output file.
 * @param {object} st normalized settings
 * @param {{name:string, dpi:number, current:number, pages:{name?:string, w:number, h:number}[], selection?:{x,y,w,h}|null, layers?:{name:string, bounds:{x,y,w,h}|null}[], facing?:boolean, date?:Date}} info
 * @returns {{jobs:object[], files:number, warnings:string[], warningKeys:[string, object][]}} jobs: { pages:number[], page:number, layer:number|null, area, size, name }
 */
export function planExport(st, info) {
  const f = formatInfo(st.format);
  const n = info.pages.length;
  const warnings = [];
  let pages;
  if (st.scope === "all") pages = info.pages.map((_, i) => i);
  else if (st.scope === "range") pages = parsePageRange(st.range, n);
  else pages = [info.current];
  if (!pages.length) throw fail(N_("No pages to export."));
  const vars = (i, extra = {}) => ({ name: info.name, page: i + 1, pages: n, pageName: info.pages[i]?.name || `${i + 1}`, format: f.ext, date: info.date, ...extra });
  const jobs = [];
  const padPx = st.padding || 0;
  const grow = (b) => ({ x: b.x - padPx, y: b.y - padPx, w: b.w + 2 * padPx, h: b.h + 2 * padPx });
  if (f.kind === "pdf") {
    const groups = st.spreads ? spreadGroups(pages, info.facing) : pages.map((i) => [i]);
    jobs.push({ pages: pages.slice(), groups, page: pages[0], layer: null, name: formatFileName(st.naming, vars(pages[0], { page: pages.length > 1 ? "" : pages[0] + 1 })) });
  } else {
    const units = [];
    if (st.scope === "layers") {
      (info.layers || []).forEach((l, li) => {
        if (l.bounds && l.bounds.w > 0 && l.bounds.h > 0) units.push({ page: info.current, layer: li, area: grow(l.bounds), layerName: l.name });
      });
      if (!units.length) throw fail(N_("No visible layers to export."));
    } else if (st.scope === "selection" && info.selection) units.push({ page: info.current, layer: null, area: grow(info.selection) });
    else for (const i of pages) units.push({ page: i, layer: null, area: { x: 0, y: 0, w: info.pages[i].w, h: info.pages[i].h } });
    const specs = f.kind === "raster" ? sizeSpecs(st) : [{ kind: "scale", value: 1, suffix: "" }];
    for (const u of units) {
      for (const spec of specs) {
        const size = f.kind === "raster" ? pixelSize(u.area, spec, info.dpi) : null;
        jobs.push({ pages: [u.page], page: u.page, layer: u.layer, area: u.area, size, spec, name: formatFileName(st.naming, vars(u.page, { layer: u.layerName || "", size: spec.suffix, w: size?.width ?? Math.round(u.area.w), h: size?.height ?? Math.round(u.area.h) })) });
      }
    }
  }
  // keep names unique: add what tells the files apart, then a counter as a last resort
  if (jobs.length > 1) {
    const template = st.naming || "{name}";
    const needs = [];
    if (new Set(jobs.map((j) => j.page)).size > 1 && !/\{page(Name)?\}/.test(template)) needs.push("-{page}");
    if (st.scope === "layers" && !/\{layer\}/.test(template)) needs.push("-{layer}");
    if (new Set(jobs.map((j) => j.spec?.suffix)).size > 1 && !/\{(size|w|h)\}/.test(template)) needs.push("{size}");
    if (needs.length) {
      for (const j of jobs) j.name = formatFileName(template + needs.join(""), vars(j.page, { layer: j.layer === null ? "" : info.layers[j.layer].name, size: j.spec?.suffix || "", w: j.size?.width, h: j.size?.height }));
    }
    const seen = new Map();
    for (const j of jobs) {
      const k = j.name.toLowerCase();
      const c = seen.get(k) || 0;
      seen.set(k, c + 1);
      if (c) j.name = `${j.name}-${c + 1}`;
    }
  }
  for (const j of jobs) if (j.size && (j.size.width > 16384 || j.size.height > 16384 || j.size.width * j.size.height > 140e6)) warnings.push([N_("{name}: {w} × {h} px is too large. Use a smaller size."), { name: j.name, w: j.size.width, h: j.size.height }]);
  return { jobs, files: jobs.length, warnings: warnings.map(([tpl, p]) => fill(tpl, p)), warningKeys: warnings };
}

// ------------------------------------------------------------------ presets

const PRESET_NAME = /^[^\u0000-\u001f]{1,80}$/;
/** True for a list of user presets as stored in preferences (exportPresets). */
export function validPresetList(v) {
  return Array.isArray(v) && v.length <= 100 && v.every((p) => p && typeof p === "object" && typeof p.name === "string" && PRESET_NAME.test(p.name) && p.settings && typeof p.settings === "object" && !Array.isArray(p.settings));
}

/** A preset file (JSON text) for sharing presets between machines and people. */
export function presetFile(presets) {
  return JSON.stringify({ openfiniExportPresets: 1, presets: presets.map((p) => ({ name: p.name, settings: p.settings })) }, null, 2);
}

/** Reads a preset file; settings are normalized, so foreign or old files cannot inject unknown keys. */
export function readPresetFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw fail(N_("This is not an OpenFini export preset file."));
  }
  const list = Array.isArray(data) ? data : data?.presets;
  if (!validPresetList(list)) throw fail(N_("This is not an OpenFini export preset file."));
  return list.map((p) => ({ name: p.name.trim(), settings: changedSettings(normalizeExportSettings(p.settings)) }));
}
