// Import reports: what an importer kept editable, what it flattened and what it dropped. Shared by the PSD, IDML, PDF,
// AI and SVG importers (and read by the Vibe tool `get_import_report`). Pure, no DOM.

/** @typedef {'kept'|'flattened'|'dropped'|'note'} ReportStatus */

export class ImportReport {
  /** @param {string} format e.g. "PDF", "Photoshop (PSD)" @param {string} [file] */
  constructor(format, file = "") {
    this.format = format;
    this.file = file;
    /** @type {{status: ReportStatus, text: string}[]} */
    this.items = [];
    this.createdAt = Date.now();
  }
  add(status, text) {
    if (text && !this.items.some((i) => i.status === status && i.text === text)) this.items.push({ status, text: String(text) });
    return this;
  }
  kept(t) {
    return this.add("kept", t);
  }
  flattened(t) {
    return this.add("flattened", t);
  }
  dropped(t) {
    return this.add("dropped", t);
  }
  note(t) {
    return this.add("note", t);
  }
  /** Adds every warning of an engine's `warnings` list as notes. */
  warnings(list) {
    for (const w of list || []) this.note(w);
    return this;
  }
  by(status) {
    return this.items.filter((i) => i.status === status).map((i) => i.text);
  }
  /** True when the user should see the report right away (something was flattened, dropped or needs a note). */
  get attention() {
    return this.items.some((i) => i.status !== "kept");
  }
  counts() {
    const c = { kept: 0, flattened: 0, dropped: 0, note: 0 };
    for (const i of this.items) c[i.status]++;
    return c;
  }
  summary() {
    const c = this.counts();
    const parts = [];
    if (c.kept) parts.push(`${c.kept} kept editable`);
    if (c.flattened) parts.push(`${c.flattened} flattened`);
    if (c.dropped) parts.push(`${c.dropped} not imported`);
    if (c.note) parts.push(`${c.note} note${c.note === 1 ? "" : "s"}`);
    return parts.join(", ") || "Nothing to report";
  }
  toText() {
    const lines = [`Import report: ${this.file || "document"} (${this.format})`];
    for (const [status, title] of [["kept", "Kept editable"], ["flattened", "Flattened"], ["dropped", "Not imported"], ["note", "Notes"]]) {
      const list = this.by(status);
      if (!list.length) continue;
      lines.push("", `${title}:`, ...list.map((t) => `- ${t}`));
    }
    return lines.join("\n");
  }
  toJSON() {
    return { format: this.format, file: this.file, items: this.items, summary: this.summary() };
  }
}

/** Attaches a report to a document (runtime only; it is not saved in the .ofini file). */
export function attachReport(doc, report) {
  Object.defineProperty(doc, "importReport", { value: report, writable: true, configurable: true, enumerable: false });
  return report;
}
