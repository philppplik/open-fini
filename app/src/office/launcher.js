// Office Suite launcher (start page of the Office studio): New (one card per registered app), templates per kind with
// a kind filter, recent Office files, Open file…, and "Import from Google" guidance. Data-driven: an app appears here
// only when it is registered (office/index.js), never as a placeholder.
//
// Public API: renderLauncher(app, { doc, kind }) → HTMLElement
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { officeApps, appForFile } from "./index.js";

const OFFICE_RECENT = /\.(docx|docm|dotx|dotm|odt|ott|fodt|rtf|xlsx|xlsm|xltx|ods|fods|ots|csv|tsv|pptx|potx|odp|fodp|otp|excalidraw|tldraw)$/i;

export function renderLauncher(app, { doc = null, kind = null } = {}) {
  const apps = officeApps();
  let filter = kind && apps.some((m) => m.kind === kind) ? kind : null;
  const create = (k, template) => import("../ui/office/open.js").then((m) => m.createOfficeDocument(app, k, { template })).catch((e) => app.toast(e.message, "danger", 5000));

  // ---- New
  const cards = h("div.of-launch__new", { role: "list" },
    ...apps.map((m) => {
      const b = h("button.of-launch__card", { type: "button", role: "listitem", "data-kind": m.kind },
        h("sl-icon", { name: m.icon, class: "of-launch__cardicon" }),
        h("strong", t("Blank {app}", { app: t(m.label).toLowerCase() })),
        h("span", t(m.blurb || "")));
      // the word processor keeps its page-size dialog (paper, orientation) for "blank"
      b.addEventListener("click", () => (m.kind === "document" ? import("../ui/office/dialogs.js").then((d) => d.newOfficeDocumentDialog(app)) : create(m.kind, "blank")));
      return b;
    }));

  // ---- Templates (kind switcher as a filter)
  const tplGrid = h("div.of-launch__templates", { role: "list" });
  const chips = h("div.of-launch__chips", { role: "radiogroup", "aria-label": t("Template kind") });
  const renderTemplates = () => {
    chips.replaceChildren(
      ...[null, ...apps.map((m) => m.kind)].map((k) => {
        const m = apps.find((x) => x.kind === k);
        const c = h("button.of-launch__chip", { type: "button", role: "radio", "aria-checked": String(filter === k) }, k ? t(m.label) : t("All"));
        c.addEventListener("click", () => {
          filter = k;
          renderTemplates();
        });
        return c;
      }),
    );
    const list = apps.filter((m) => !filter || m.kind === filter).flatMap((m) => m.templates.filter((x) => x.id !== "blank").map((x) => ({ m, x })));
    tplGrid.replaceChildren(
      ...list.map(({ m, x }) => {
        const b = h("button.of-launch__tpl", { type: "button", role: "listitem", title: t(x.description || x.label) },
          h("span.of-launch__tplthumb", { "data-kind": m.kind }, h("sl-icon", { name: x.icon || m.icon })),
          h("strong", t(x.label)),
          h("span", `${t(m.label)}${x.category ? ` · ${t(x.category)}` : ""}`));
        b.addEventListener("click", () => create(m.kind, x.id));
        return b;
      }),
    );
    if (!list.length) tplGrid.append(h("p.of-launch__empty", t("No templates for this kind yet.")));
  };
  renderTemplates();

  // ---- Recent Office files
  const recent = h("div.of-launch__recent", { role: "list" }, h("p.of-launch__empty", t("Loading…")));
  import("../core/storage.js")
    .then((s) => s.getRecents())
    .then((list) => {
      const rows = list.filter((r) => !r.isDir && OFFICE_RECENT.test(r.name || "")).slice(0, 8);
      recent.replaceChildren(
        ...rows.map((r) => {
          const hit = appForFile(r.name);
          const b = h("button.of-launch__file", { type: "button", role: "listitem", title: r.path || r.name }, h("sl-icon", { name: hit?.app.icon || "file-earmark" }), h("span", r.name));
          b.addEventListener("click", () => app.run("file.openRecent", r));
          return b;
        }),
      );
      if (!rows.length) recent.replaceChildren(h("p.of-launch__empty", t("Office files you open appear here.")));
    })
    .catch(() => recent.replaceChildren(h("p.of-launch__empty", t("Recent files are not available."))));

  // ---- Open, import
  const open = h("sl-button", { variant: "primary" }, h("sl-icon", { slot: "prefix", name: "folder2-open" }), t("Open file…"));
  open.addEventListener("click", () => app.run("file.open"));
  const google = h("sl-button", {}, h("sl-icon", { slot: "prefix", name: "cloud-arrow-down" }), t("Import from Google…"));
  google.addEventListener("click", () => googleImportDialog(app));
  const formats = apps.flatMap((m) => m.formats.filter((f) => f.read).flatMap((f) => f.ext.map((e) => `.${e}`)));

  const note = doc && !doc.office ? h("p.of-launch__note", t("“{name}” is a design document. Office edits documents, spreadsheets, presentations and whiteboards: create one or open a file.", { name: doc.name })) : null;
  return h("div.of-launch", { role: "region", "aria-label": t("Office home") },
    h("div.of-launch__inner",
      h("header.of-launch__head", h("h1", t("Office")), h("div.of-launch__actions", open, google)),
      note,
      h("section", { "aria-label": t("New") }, h("h2", t("New")), cards),
      h("section", { "aria-label": t("Templates") }, h("div.of-launch__row", h("h2", t("Templates")), chips), tplGrid),
      h("section", { "aria-label": t("Recent") }, h("h2", t("Recent")), recent),
      h("p.of-launch__formats", t("Opens: {list}", { list: formats.join(" ") }))));
}

/** Google Docs / Sheets / Slides live in the cloud: explain the export path (no Google account integration). */
export function googleImportDialog(app) {
  const rows = [
    [t("Google Docs"), t("File ▸ Download ▸ Microsoft Word (.docx) or OpenDocument (.odt)")],
    [t("Google Sheets"), t("File ▸ Download ▸ Microsoft Excel (.xlsx), OpenDocument (.ods) or CSV")],
    [t("Google Slides"), t("File ▸ Download ▸ Microsoft PowerPoint (.pptx) or ODP")],
  ];
  const body = h("div.of-foreign",
    h("p.of-dialog__text", t("Files in Google Drive (.gdoc, .gsheet, .gslides on your disk) are only links to the cloud. Download a copy in an open format and open it here; to send changes back, upload the exported file to Google Drive.")),
    h("dl.of-launch__google", ...rows.flatMap(([k, v]) => [h("dt", k), h("dd", v)])),
    h("p.of-hint", t("OpenFini has no Google account integration: nothing is uploaded or downloaded without you.")));
  import("../ui/dialogs.js").then(({ openDialog }) =>
    openDialog({
      title: t("Import from Google"),
      body,
      width: 560,
      buttons: [
        { label: t("Open Google Drive"), onClick: (c) => (c(), import("../ui/links.js").then((m) => m.openLink("https://drive.google.com/", { app }))) },
        { label: t("Open file…"), onClick: (c) => (c(), app.run("file.open")) },
        { label: t("Close"), variant: "primary", onClick: (c) => c() },
      ],
    }),
  );
}
