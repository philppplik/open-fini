// Manifest of the Document app (the word processor): plain data for the launcher, file routing and the Vibe prompt.
// The implementation (office/document/app.js, which wraps ui/office/ and engine/office/) loads on first use.
// Template ids must match ui/office/dialogs.js ▸ templateModel.
export const DOCUMENT_APP = {
  kind: "document",
  label: "Document",
  icon: "file-earmark-text",
  blurb: "Letters, reports and anything with pages: Word, OpenDocument, RTF",
  order: 10,
  formats: [
    { id: "docx", label: "Word document", ext: ["docx", "docm"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", read: true, write: true },
    { id: "dotx", label: "Word template", ext: ["dotx", "dotm"], read: true, template: true },
    { id: "odt", label: "OpenDocument text", ext: ["odt", "fodt"], mime: "application/vnd.oasis.opendocument.text", read: true, write: true },
    { id: "ott", label: "OpenDocument text template", ext: ["ott"], read: true, template: true },
    { id: "rtf", label: "Rich Text", ext: ["rtf"], mime: "application/rtf", read: true, write: true },
    { id: "html", label: "Web page (HTML)", ext: ["html", "htm", "xhtml"], mime: "text/html", read: true, write: true, lossy: true },
    { id: "md", label: "Markdown", ext: ["md", "markdown"], mime: "text/markdown", read: true, write: true, lossy: true },
    { id: "txt", label: "Plain text", ext: ["txt", "text"], mime: "text/plain", read: true, write: true, lossy: true },
    { id: "pdf", label: "PDF", ext: ["pdf"], mime: "application/pdf", write: true },
  ],
  templates: [
    { id: "blank", label: "Blank document", description: "An empty page", icon: "file-earmark", category: "Basic" },
    { id: "letter", label: "Letter", description: "Sender, recipient, date, subject and signature", icon: "envelope", category: "Business" },
    { id: "report", label: "Report", description: "Title, summary, headings and a table", icon: "journal-text", category: "Business" },
    { id: "invoice", label: "Invoice", description: "Sender, customer, items table and totals", icon: "currency-dollar", category: "Business" },
    { id: "memo", label: "Memo", description: "To, from, date, subject and body", icon: "sticky", category: "Business" },
    { id: "meeting", label: "Meeting notes", description: "Attendees, agenda, decisions and action items", icon: "people", category: "Business" },
    { id: "resume", label: "Resume", description: "Name, contact line and sections", icon: "person", category: "Personal" },
  ],
  aiNote: "The active Office document is a word-processing document (pages, styles, lists, tables). Read it with office_read_document before editing; use the office_ tools (office_insert_blocks, office_replace_text, office_set_style, office_apply_format, office_insert_table, office_set_page_setup). Every call is one undoable step.",
  load: () => import("./app.js"),
};
