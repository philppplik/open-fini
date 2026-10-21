// Batch Export & Rename: pure logic (file names, templates, bulk rename, ZIP writer). No OpenFini API in here.
// The packer strips `export` and prepends this file to main.js / panel.js; keep it import-free.

export const STRINGS = {
  title: "Batch Export & Rename",
  nothing: "Nothing to export: select layers, or choose pages.",
  exported: "Exported {n} files.",
  renamed: "Renamed {n} layers.",
  noRename: "No layer names would change.",
};

export const DEFAULT_TEMPLATE = "{name}@{scale}x";

/** Makes a string safe as a file name (no path separators or reserved characters). */
export function sanitizeFileName(name) {
  const s = String(name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
  return (s || "untitled").slice(0, 100);
}

const EXT = { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp", svg: "svg" };
export const FORMATS = ["png", "jpg", "webp", "svg"];

/** Formats a scale for file names: 1 -> "1", 1.5 -> "1.5", 2 -> "2". */
export const scaleLabel = (s) => String(Math.round(s * 100) / 100);

/** Replaces {name} {scale} {format} {index} {page} {width} {height} in a template. Unknown {tokens} stay as they are. */
export function applyTemplate(template, vars) {
  return String(template || DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] !== undefined ? String(vars[k]) : m));
}

/**
 * Expands targets x scales x formats into jobs with unique file names.
 * @param {{id?: string, page?: number, name: string}[]} targets  layers ({id,name}) or pages ({page,name})
 * @param {{scales: number[], formats: string[], template?: string, folder?: boolean}} o
 */
export function buildJobs(targets, { scales = [1], formats = ["png"], template = DEFAULT_TEMPLATE, folder = false } = {}) {
  const jobs = [];
  const used = new Map();
  let index = 0;
  for (const t of targets) {
    index++;
    for (const format of formats) {
      for (const scale of format === "svg" ? [1] : scales) {
        let base = sanitizeFileName(applyTemplate(template, { name: sanitizeFileName(t.name), scale: scaleLabel(scale), format, index, page: (t.page ?? 0) + 1 }));
        const ext = EXT[format] || format;
        let file = `${base}.${ext}`;
        const key = file.toLowerCase();
        const n = used.get(key) || 0;
        used.set(key, n + 1);
        if (n) file = `${base}-${n + 1}.${ext}`;
        jobs.push({ target: t, format, scale, file: folder ? `${format}/${file}` : file });
      }
    }
  }
  return jobs;
}

/**
 * Bulk rename. Options are applied in this order: find/replace, case, prefix/suffix, numbering.
 * @param {string[]} names
 * @param {{find?: string, replace?: string, regex?: boolean, caseSensitive?: boolean, prefix?: string, suffix?: string,
 *   caseMode?: "keep"|"lower"|"upper"|"title"|"kebab"|"snake", number?: boolean, start?: number, pad?: number, numberPosition?: "suffix"|"prefix", separator?: string}} o
 * @returns {string[]}
 */
export function renameNames(names, o = {}) {
  const sep = o.separator ?? " ";
  return names.map((original, i) => {
    let s = String(original);
    if (o.find) {
      let re;
      try {
        re = o.regex ? new RegExp(o.find, o.caseSensitive ? "g" : "gi") : new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.caseSensitive ? "g" : "gi");
      } catch {
        re = null;
      }
      if (re) s = s.replace(re, o.replace ?? "");
    }
    s = applyCase(s, o.caseMode);
    s = `${o.prefix ?? ""}${s}${o.suffix ?? ""}`;
    if (o.number) {
      const num = String((o.start ?? 1) + i).padStart(o.pad ?? 2, "0");
      s = o.numberPosition === "prefix" ? `${num}${sep}${s}` : `${s}${sep}${num}`;
    }
    return s;
  });
}

export function applyCase(s, mode) {
  const words = () => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-]+/).filter(Boolean);
  switch (mode) {
    case "lower": return s.toLowerCase();
    case "upper": return s.toUpperCase();
    case "title": return s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
    case "kebab": return words().join("-").toLowerCase();
    case "snake": return words().join("_").toLowerCase();
    default: return s;
  }
}

/** Preview of a rename: [{id, from, to, changed}] */
export function renamePlan(layers, o) {
  const to = renameNames(layers.map((l) => l.name || ""), o);
  return layers.map((l, i) => ({ id: l.id, from: l.name || "", to: to[i], changed: (l.name || "") !== to[i] }));
}

// ---- ZIP (store only) -------------------------------------------------------------------------------------------

export function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    let c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

/** Uncompressed ZIP of { path: Uint8Array } (images are already compressed). */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of Object.entries(files)) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
    parts.push(local, nb, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const count = Object.keys(files).length;
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(count), ...u16(count), ...u32(cdSize), ...u32(offset), 0, 0]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of all) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

// ---- API-driven operations (take the `openfini` object so tests can pass a mock) ----------------------------------

/**
 * Exports targets in several sizes/formats. Resolves { files: [{file, bytes}], saved, name }.
 * @param {object} api the `openfini` API
 * @param {{source: "selection"|"page"|"pages", scales: number[], formats: string[], template: string, zip?: boolean, folders?: boolean}} o
 */
export async function runExport(api, o) {
  let targets = [];
  if (o.source === "selection") {
    const { selection } = await api.document.readSelection();
    targets = selection.map((l) => ({ id: l.id, name: l.name || l.type }));
  } else {
    const info = await api.document.info();
    const pages = info.activeDocument?.pages || [];
    if (o.source === "page") {
      const i = Math.max(0, pages.findIndex((p) => p.active));
      targets = pages[i] ? [{ page: i, name: pages[i].name }] : [];
    } else targets = pages.map((p, i) => ({ page: i, name: p.name }));
  }
  if (!targets.length) return { files: [], saved: false, empty: true };
  const jobs = buildJobs(targets, { scales: o.scales, formats: o.formats, template: o.template, folder: !!o.folders });
  const files = [];
  for (const job of jobs) {
    const opts = { format: job.format, scale: job.scale };
    if (job.target.id) opts.ids = [job.target.id];
    else opts.page = job.target.page;
    const r = await api.document.export(opts);
    files.push({ file: job.file, bytes: r.data });
  }
  if (files.length === 1 && !o.zip) {
    const res = await api.files.save({ name: files[0].file.split("/").pop(), data: files[0].bytes });
    return { files, saved: res.saved, name: res.name };
  }
  const zip = zipStore(Object.fromEntries(files.map((f) => [f.file, f.bytes])));
  const res = await api.files.save({ name: `${sanitizeFileName(o.zipName || "export")}.zip`, data: zip, mime: "application/zip" });
  return { files, saved: res.saved, name: res.name };
}

/** Renames the selected layers (set_style name, one tool call per distinct new name). Returns the plan. */
export async function runRename(api, o, { apply = true } = {}) {
  const { selection } = await api.document.readSelection();
  const plan = renamePlan(selection, o);
  if (apply) for (const p of plan) if (p.changed) await api.document.callTool("set_style", { ids: [p.id], name: p.to });
  return plan;
}
