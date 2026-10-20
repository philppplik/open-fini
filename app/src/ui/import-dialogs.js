// Dialogs of the foreign-file importers: PDF import options, password prompt, progress with cancel, the shared import
// report, and the "convert this file first" guidance for formats OpenFini cannot read.
import { h } from "../core/util.js";
import { openDialog, promptDialog } from "./dialogs.js";
import { selectField, switchField } from "./controls.js";
import { PDF_DEFAULTS } from "../core/import-pdf.js";

const STATUS = {
  kept: { title: "Kept editable", icon: "check-circle", cls: "ok" },
  flattened: { title: "Flattened or replaced", icon: "layers-half", cls: "warn" },
  dropped: { title: "Not imported", icon: "x-circle", cls: "bad" },
  note: { title: "Notes", icon: "info-circle", cls: "info" },
};

/** Shows what an importer kept editable, flattened and dropped. */
export function showImportReport(report, app) {
  const body = h("div.of-report");
  body.append(h("p.of-report__summary", `${report.file || "Document"} (${report.format}): ${report.summary()}.`));
  for (const key of ["kept", "flattened", "dropped", "note"]) {
    const list = report.by(key);
    if (!list.length) continue;
    const meta = STATUS[key];
    body.append(h(`section.of-report__sec.of-report__sec--${meta.cls}`, h("h4", h("sl-icon", { name: meta.icon }), ` ${meta.title}`), h("ul", ...list.map((t) => h("li", t)))));
  }
  if (!report.items.length) body.append(h("p.of-dialog__text", "Nothing special to report."));
  return openDialog({
    title: "Import report",
    body,
    width: 560,
    cls: "of-report-dialog",
    buttons: [
      {
        label: "Copy report",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(report.toText());
            app?.toast("Report copied.", "success", 1500);
          } catch {
            app?.toast("Could not copy to the clipboard.", "warning");
          }
        },
      },
      { label: "Close", variant: "primary", onClick: (close) => close() },
    ],
  });
}

/** Password prompt for encrypted PDFs; resolves to the password or null. */
export function askPdfPassword(incorrect) {
  return promptDialog({ title: "Password required", label: incorrect ? "That password was not correct. Enter the password to open this PDF:" : "This PDF is password protected. Enter the password to open it:", type: "password", ok: "Open" });
}

/**
 * PDF import options.
 * @param {{name: string, pages: number, encrypted?: boolean, insert?: boolean}} info
 * @returns {Promise<null | typeof PDF_DEFAULTS>}
 */
export function pdfImportDialog(info) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const o = { ...PDF_DEFAULTS };
    const modes = [
      ["objects", "Editable objects", "Text becomes text frames, shapes become vector paths, pictures become image objects. Best for most PDFs."],
      ["images", "Page images", "Each page becomes a flat background image with the text laid over it as editable text. Use this for PDFs that are too complex or look wrong in the first mode."],
      ["text", "Text only", "Only the text is imported, as text frames, without graphics and pictures. Handy for translating or reusing copy."],
    ];
    const group = h("sl-radio-group", { label: "Import as", value: o.mode, name: "mode" });
    for (const [v, label, hint] of modes) group.append(h("div.of-pdfopt__mode", h("sl-radio", { value: v }, label), h("p.of-pdfopt__hint", hint)));
    group.addEventListener("sl-change", () => {
      o.mode = group.value;
      imgField.el.classList.toggle("hidden", o.mode !== "objects");
      pageDpi.el.classList.toggle("hidden", o.mode !== "images");
    });
    const range = h("sl-input", { label: `Pages (1-${info.pages})`, placeholder: "All pages, or e.g. 1-3, 5, 8-", size: "small", "help-text": info.pages > 1 ? "" : undefined });
    range.addEventListener("sl-input", () => (o.pages = range.value));
    const imgField = selectField({ label: "Image resolution", value: "0", options: [["0", "Keep original"], ["300", "Limit to 300 dpi"], ["200", "Limit to 200 dpi"], ["150", "Limit to 150 dpi"], ["96", "Limit to 96 dpi"]].map(([value, label]) => ({ value, label })), onChange: (v) => (o.imageDpi = +v) });
    const pageDpi = selectField({ label: "Page image resolution", value: "150", options: ["72", "100", "150", "200", "300"].map((v) => ({ value: v, label: `${v} dpi` })), onChange: (v) => (o.pageDpi = +v) });
    pageDpi.el.classList.add("hidden");
    const embed = switchField({ label: "Use fonts embedded in the PDF when possible", value: o.embedFonts, onChange: (v) => (o.embedFonts = v) });
    const reflow = switchField({ label: "Join lines into flowing paragraphs", value: o.reflow, onChange: (v) => (o.reflow = v) });
    const note = h("p.of-pdfopt__hint", info.insert ? "The pages are inserted after the current page of this document." : "Form fields are imported as static content, not as interactive fields. Embedded fonts are subsets: characters that are not in the original text may display in a fallback font.");
    const body = h("div.of-pdfopt", h("p.of-dialog__text", `${info.name}: ${info.pages} page${info.pages === 1 ? "" : "s"}.`), group, range, imgField.el, pageDpi.el, embed.el, reflow.el, note);
    const { dlg } = openDialog({
      title: info.insert ? "Insert pages from PDF" : "Open PDF",
      body,
      width: 520,
      buttons: [
        { label: "Cancel", onClick: (close) => (finish(null), close()) },
        { label: info.insert ? "Insert" : "Open", variant: "primary", onClick: (close) => (finish({ ...o, pages: range.value }), close()) },
      ],
      onClose: () => finish(null),
    });
    void dlg;
  });
}

/** A small modal progress dialog with a Cancel button. */
export function progressDialog(title) {
  const bar = h("sl-progress-bar", { value: 0, label: title });
  const text = h("p.of-dialog__text", "Preparing…");
  const state = { cancelled: false };
  const { close } = openDialog({
    title,
    body: h("div", text, bar),
    width: 420,
    buttons: [{ label: "Cancel", onClick: () => ((state.cancelled = true), (text.textContent = "Cancelling after the current page…")) }],
    onClose: () => (state.cancelled = state.cancelled || false),
  });
  return {
    get cancelled() {
      return state.cancelled;
    },
    update(done, total, page) {
      bar.value = total ? Math.round((done / total) * 100) : 0;
      text.textContent = page ? `Importing page ${page} (${done + 1} of ${total})…` : `Finished ${done} of ${total} pages.`;
    },
    close,
  };
}

/**
 * Explains how to move a proprietary file into OpenFini.
 * @param {{title:string, message:string, steps?: string[], formats?: string[]}} info
 * @param {{app: any, platform?: any, extra?: {label:string, run:()=>void}[]}} ctx
 */
export function foreignFormatDialog(info, ctx) {
  const body = h("div.of-foreign", h("p.of-dialog__text", info.message));
  if (info.steps?.length) body.append(h("ol.of-foreign__steps", ...info.steps.map((s) => h("li", s))));
  const buttons = [];
  for (const e of ctx.extra || []) buttons.push({ label: e.label, onClick: (close) => (close(), e.run()) });
  buttons.push({
    label: "Open converted file…",
    onClick: async (close) => {
      close();
      ctx.app.run("file.open");
    },
  });
  buttons.push({ label: "Close", variant: "primary", onClick: (close) => close() });
  return openDialog({ title: info.title, body, width: 520, buttons });
}
