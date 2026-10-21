// Attachment tools (group "Attachments"): files the user attached in the CURRENT Vibe chat can be listed and opened
// as new documents through the same importers as File ▸ Open (app.openFile): images -> Pixel (SVG -> Vector),
// PDF / Illustrator -> Layout (PDF importer, default options, no dialog), PSD / PSB / IDML / Sketch -> their importers,
// text, Markdown, HTML, CSS, JS, JSON, CSV -> Code studio. The File objects live only in memory for the chat session
// (they are not stored with the chat), so after reloading the app the user has to attach the file again.
import { tool, S } from "./helpers.js";

/** Which studio / importer a file name goes to (pure, for listing). */
export function attachmentKind(name, type = "") {
  const n = String(name).toLowerCase();
  if (/\.svg$/.test(n) || type === "image/svg+xml") return { kind: "vector image", studio: "vector" };
  if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|bmp|avif|tiff?)$/.test(n)) return { kind: "image", studio: "pixel" };
  if (/\.(pdf|ai|eps)$/.test(n)) return { kind: "PDF document", studio: "layout" };
  if (/\.(psd|psb)$/.test(n)) return { kind: "Photoshop document", studio: "pixel" };
  if (/\.idml$/.test(n)) return { kind: "InDesign (IDML) document", studio: "layout" };
  if (/\.sketch$/.test(n)) return { kind: "Sketch document", studio: "vector" };
  if (/\.ofini$/.test(n)) return { kind: "OpenFini document", studio: "auto" };
  if (/\.(docx|odt|rtf)$/.test(n)) return { kind: "word processing document", studio: "office" };
  if (/\.(md|markdown|txt|html?|css|m?js|json|csv|tsv|xml|ya?ml|ts|tsx|jsx|py|sql|tex)$/.test(n)) return { kind: "text file", studio: "code" };
  return { kind: "unknown", studio: null };
}

export function attachmentTools(app, ctx) {
  const list = () => (ctx.attachments?.() || []);
  const find = (a) => {
    const all = list();
    if (!all.length) throw new Error("No files are attached in this chat. Ask the user to attach the file with the paperclip button.");
    let f = null;
    if (a.index != null) f = all[a.index - 1] || null;
    else if (a.name) f = all.find((x) => x.name === a.name) || all.find((x) => x.name.toLowerCase().includes(String(a.name).toLowerCase())) || null;
    else if (all.length === 1) f = all[0];
    if (!f) throw new Error(`No attachment matches. Attached: ${all.map((x, i) => `${i + 1}. ${x.name}`).join(", ")}. Pass name or index.`);
    return f;
  };
  return [
    tool("list_attachments", "Lists the files the user attached in this chat (name, type, size, kind, target studio, whether it was already opened as a document).", {}, [], () => ({
      attachments: list().map((f, i) => ({ index: i + 1, name: f.name, type: f.type || "unknown", size: f.size, ...attachmentKind(f.name, f.type), opened: !!f.openedDoc })),
    }), { readOnly: true }),

    tool("open_attachment", "Opens a file attached in this chat as a NEW document, with the same importers as File ▸ Open (images -> Pixel, SVG -> Vector, PDF/AI -> Layout, PSD -> Pixel, IDML -> Layout, Sketch -> Vector, text/HTML/CSS/JS/JSON/CSV -> Code). Returns the new document's info. The document becomes the active one, so your next tools work on it.", {
      name: S.str("File name (or part of it)"), index: S.num("1-based position from list_attachments", { minimum: 1 }),
      mode: S.str("PDF import mode: objects (editable, default), images (page images + text), text (text only)", { enum: ["objects", "images", "text"] }),
    }, [], async (a) => {
      const f = find(a);
      if (!app.openFile) throw new Error("Opening files is not available here.");
      const bytes = new Uint8Array(await f.file.arrayBuffer());
      const before = app.doc;
      const doc = await app.openFile({ name: f.name, bytes, mime: f.type, importOptions: { mode: a.mode || "objects" } });
      const opened = doc && typeof doc === "object" && doc.pages ? doc : app.doc !== before ? app.doc : null;
      if (!opened) return { opened: false, note: "The file was not opened as a document (unsupported, cancelled or handled by an extension). Tell the user what happened." };
      f.openedDoc = opened;
      const report = opened.importReport || opened._importReport;
      return {
        opened: true,
        document: { name: opened.name, studio: app.studio, pages: opened.pages.length, page: opened.pages[0] && { id: opened.pages[0].id, width: Math.round(opened.pages[0].w), height: Math.round(opened.pages[0].h) }, website: !!opened.web, files: opened.web ? [...opened.web.paths].slice(0, 20) : undefined },
        importReport: report?.summary ? report.summary() : undefined,
        next: "Use describe_page / query_layers (or list_files for text files) to see the content; get_import_report shows what could not be converted.",
      };
    }),
  ];
}
