// Help ▸ Doctor… and Settings ▸ Troubleshooting ▸ Doctor (docs/doctor.md): environment checks of the app and checks
// of the open document, each with an explanation and, where possible, a Fix button; "Fix all safe issues"; a redacted
// report to copy or save. Also the "could not open" dialog that offers "Repair with Doctor" for a damaged .ofini file.
// Loaded on demand (tests/architecture/guardrails.test.js ▸ LAZY_AREAS); the checks themselves are core/doctor/.
import { h, downloadName } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { openDialog, confirmDialog } from "./dialogs.js";
import { button } from "./controls.js";
import { platform } from "../platform/index.js";
import { diagnoseFile, repairFile, doctorReport, FIXES } from "../core/doctor/index.js";
import { runEnvironmentChecks, runEnvironmentFix } from "../core/doctor/collect.js";
import { saveOfini, loadOfini } from "../core/ofini.js";
import { buildInfo } from "../core/env.js";

const ICON = { error: "x-circle-fill", warning: "exclamation-triangle-fill", info: "info-circle-fill", ok: "check-circle-fill" };
const LABEL = { error: N_("Error"), warning: N_("Attention"), info: N_("Note"), ok: N_("OK") };
const tr = (f) => t(f.message, f.params || {});

/** Opens the repaired bytes as a new, unsaved document. */
async function openRepaired(app, bytes, name) {
  const doc = await loadOfini(bytes);
  doc.name = t("{name} (repaired)", { name: (doc.name && doc.name !== "Untitled" ? doc.name : name).replace(/\.ofini$/i, "") });
  doc.path = null;
  doc.saved = false;
  app.setStudio(["pixel", "layout", "code", "office", "scene"].includes(doc.studio) ? doc.studio : "vector");
  app.openDoc(doc);
  requestAnimationFrame(() => app.cv?.fitPage?.());
  return doc;
}

/** Repairs `bytes` with `fixes` ("safe", "all" or ids) and opens the result in a new tab. */
async function repairAndOpen(app, bytes, name, fixes) {
  const r = repairFile(bytes, { name: /\.ofini$/i.test(name) ? name : `${name}.ofini`, fixes });
  if (!r.bytes) {
    app.toast(t("Nothing could be repaired automatically."), "warning", 4000);
    return null;
  }
  if (r.after.counts.error) {
    app.toast(t("Some problems remain after the repair; the result opens as far as it can."), "warning", 6000);
  }
  try {
    const doc = await openRepaired(app, r.bytes, name);
    app.toast(t("Repaired copy opened in a new tab. The original file was not changed."), "success", 5000);
    return doc;
  } catch (e) {
    app.toast(t("The repaired copy still cannot be opened: {error}", { error: e.message }), "danger", 8000);
    return null;
  }
}

/**
 * The Doctor dialog.
 * @param {object} app
 * @param {{ bytes?: Uint8Array, name?: string }} [o] a file that failed to open (checked instead of the active document)
 */
export async function doctorDialog(app, { bytes = null, name = "" } = {}) {
  const envHost = h("div.of-sec", { "aria-live": "polite" });
  const docHost = h("div.of-sec");
  const summary = h("p.of-sec__sum", { role: "status" }, t("Checking…"));
  let env = { status: null, findings: [] };
  let docReport = null;
  let docBytes = bytes;
  let docName = name;

  const row = (f, fixBtn) =>
    h(
      `div.of-sec__row.of-doctor__row.lv-${f.severity === "error" ? "error" : f.severity === "warning" ? "warn" : f.severity}`,
      h("sl-icon", { name: ICON[f.severity] || ICON.info, "aria-hidden": "true" }),
      h("div", h("div", h("span.of-sec__lv", t(LABEL[f.severity] || LABEL.info)), " ", f.area ? h("strong", t(f.area)) : null), h("div.of-hint", tr(f)), fixBtn),
    );

  async function runEnvFix(f) {
    if (f.fix.id === "clear-caches" && !(await confirmDialog({ title: t("Clear the offline cache"), message: t("OpenFini downloads its files again the next time it starts. Documents and settings are not touched."), ok: t("Clear") }))) return;
    try {
      const [msg, params] = await runEnvironmentFix(app, f.fix.id, env.status);
      app.toast(t(msg, params || {}), "success", 4000);
    } catch (e) {
      app.toast(t("The fix failed: {error}", { error: e.message }), "danger", 6000);
    }
    await checkEnv();
    updateSummary();
  }

  async function checkEnv() {
    envHost.replaceChildren(h("p.of-hint", t("Checking the app…")));
    try {
      env = await runEnvironmentChecks(app);
    } catch (e) {
      env = { status: null, findings: [] };
      envHost.replaceChildren(h("p.of-hint", t("The app checks could not run: {error}", { error: e.message })));
      return;
    }
    envHost.replaceChildren(...env.findings.map((f) => row(f, f.fix ? button(f.fix.label, () => runEnvFix(f), { cls: "of-doctor__fix" }) : null)));
  }

  async function checkDoc() {
    docHost.replaceChildren(h("p.of-hint", t("Checking the document…")));
    if (!bytes) {
      const doc = app.doc;
      if (!doc) {
        docReport = null;
        docHost.replaceChildren(h("p.of-hint", t("No document is open.")));
        return;
      }
      try {
        docBytes = await saveOfini(doc); // checks exactly what Save would write
        docName = `${doc.name || "document"}.ofini`;
      } catch (e) {
        docReport = null;
        docHost.replaceChildren(row({ severity: "error", message: N_("The document cannot be serialized: {error}"), params: { error: e.message } }, null));
        return;
      }
    }
    docReport = diagnoseFile(docBytes, { name: docName.endsWith(".ofini") ? docName : `${docName}.ofini` });
    const rows = docReport.findings.map((f) => row(f, f.fix ? button(f.fix.label, () => repairAndOpen(app, docBytes, docName, [f.fix.id]).then((d) => d && close?.()), { cls: "of-doctor__fix" }) : null));
    const n = docReport.counts;
    const head = h("p.of-hint", docReport.findings.length ? t("{errors} errors, {warnings} warnings, {notes} notes in “{name}”.", { errors: n.error, warnings: n.warning, notes: n.info, name: docName }) : t("No problems found in “{name}”.", { name: docName }));
    const acts = h(
      "div.of-sec__acts",
      n.fixable ? button(N_("Repair in a new tab"), () => repairAndOpen(app, docBytes, docName, "safe").then((d) => d && close?.()), { variant: "primary" }) : null,
      docReport.findings.some((f) => f.fix && !f.fix.safe) ? button(N_("Repair everything in a new tab"), async () => {
        if (await confirmDialog({ title: t("Repair everything"), message: t("This also removes broken layers, unused assets and clips without a source in the copy. The original stays unchanged."), ok: t("Repair") })) repairAndOpen(app, docBytes, docName, "all").then((d) => d && close?.());
      }) : null,
    );
    docHost.replaceChildren(head, ...rows, acts);
  }

  function updateSummary() {
    const all = [...env.findings, ...(docReport?.findings || [])];
    const bad = all.filter((f) => f.severity === "error" || f.severity === "warning").length;
    const fixable = all.filter((f) => f.fix && f.fix.safe).length;
    summary.textContent = bad ? t("{n, plural, one {# item needs} other {# items need}} attention; {fixable} can be fixed safely.", { n: bad, fixable }) : t("Nothing needs attention.");
  }

  async function fixAllSafe() {
    const safeEnv = env.findings.filter((f) => f.fix?.safe && f.severity !== "ok");
    for (const f of safeEnv) {
      try {
        await runEnvironmentFix(app, f.fix.id, env.status);
      } catch {
        /* reported by the next check */
      }
    }
    if (docReport?.counts.fixable && docReport.findings.some((f) => f.fix?.safe && (f.severity === "error" || f.severity === "warning"))) await repairAndOpen(app, docBytes, docName, "safe");
    await checkEnv();
    if (!bytes) await checkDoc();
    updateSummary();
    app.toast(t("Safe fixes applied: {n}.", { n: safeEnv.length }), "success", 3000);
  }

  const reportText = async () => doctorReport({ app: { version: (await buildInfo().catch(() => null))?.version || "", platform: `${platform.isDesktop ? "desktop" : "web"} ${platform.os || ""}`.trim() }, env: env.findings, doc: docReport, translate: (s, p) => t(s, p) });
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(await reportText());
      app.toast(t("Report copied. It contains no file contents, keys or personal paths."), "success", 3000);
    } catch {
      app.toast(t("Copying is not allowed here. Use Save instead."), "warning", 3500);
    }
  }
  async function saveReport() {
    const res = await platform.saveFile({ suggestedName: downloadName("openfini-doctor", "txt"), bytes: new TextEncoder().encode(await reportText()), mime: "text/plain", filters: [{ name: t("Text"), extensions: ["txt"] }] });
    if (res) app.toast(t("Saved {name}", { name: res.name }), "success", 2000);
  }

  const body = h(
    "div.of-doctor",
    h("p.of-hint", t("The Doctor checks this app and the open document, explains what it finds and repairs what can be repaired safely. Repairs of a document always open a copy in a new tab.")),
    summary,
    h("h3.of-doctor__h", bytes ? t("Damaged file") : t("Document")),
    docHost,
    h("h3.of-doctor__h", t("App")),
    envHost,
  );
  let close = null;
  const dlg = openDialog({
    title: N_("Doctor"),
    width: 780,
    key: "doctor",
    cls: "of-doctor-dialog",
    body,
    buttons: [
      { label: N_("Copy report"), onClick: () => copyReport() },
      { label: N_("Save report…"), onClick: () => saveReport() },
      { label: N_("Run again"), onClick: () => run() },
      { label: N_("Fix all safe issues"), variant: "primary", onClick: () => fixAllSafe() },
      { label: N_("Close"), onClick: (c) => c() },
    ],
  });
  close = dlg?.close;
  async function run() {
    summary.textContent = t("Checking…");
    await Promise.all([checkDoc(), checkEnv()]);
    updateSummary();
  }
  run();
  return dlg;
}

/**
 * Shown when an .ofini file cannot be opened: the reason, plus "Repair with Doctor" (opens a repaired copy) and
 * "Details" (the Doctor dialog for this file).
 */
export async function damagedFileDialog(app, file, err) {
  const report = diagnoseFile(file.bytes, { name: /\.ofini$/i.test(file.name) ? file.name : `${file.name}.ofini` });
  const canFix = report.counts.fixable > 0;
  openDialog({
    title: N_("This document could not be opened"),
    width: 520,
    body: h(
      "div",
      h("p.of-dialog__text", err?.message || t("The file is damaged.")),
      h("p.of-hint", canFix ? t("The Doctor found {n} problems it can repair. Repairing opens a copy in a new tab; the file itself is not changed.", { n: report.counts.fixable }) : t("The Doctor cannot repair this file automatically. Details shows what is wrong; the command line tool “ofini extract --assets” can still save the readable pictures and media.")),
    ),
    buttons: [
      { label: N_("Details…"), onClick: (c) => (c(), doctorDialog(app, { bytes: file.bytes, name: file.name })) },
      ...(canFix ? [{ label: N_("Repair with Doctor"), variant: "primary", onClick: (c) => (c(), repairAndOpen(app, file.bytes, file.name, "safe")) }] : []),
      { label: N_("Close"), onClick: (c) => c() },
    ],
  });
  return null;
}

export { FIXES };
