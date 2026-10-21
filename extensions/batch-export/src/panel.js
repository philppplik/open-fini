// Batch Export & Rename panel. lib.js is prepended by the packer.
const $ = (id) => document.getElementById(id);
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const say = (text) => { $("status").textContent = text; };
const checked = (name) => [...document.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.value);

const exportOptions = () => ({ source: $("source").value, scales: checked("scale").map(Number), formats: checked("format"), template: $("template").value, folders: $("folders").checked, zip: true });
const renameOptions = () => ({ find: $("find").value, replace: $("replace").value, regex: $("regex").checked, prefix: $("prefix").value, suffix: $("suffix").value, caseMode: $("caseMode").value, number: $("number").checked, numberPosition: $("numpre").checked ? "prefix" : "suffix", start: Number($("start").value) || 0 });

async function previewExport() {
  try {
    const o = exportOptions();
    let targets = [];
    if (o.source === "selection") targets = (await openfini.document.readSelection()).selection.map((l) => ({ id: l.id, name: l.name || l.type }));
    else {
      const pages = (await openfini.document.info()).activeDocument?.pages || [];
      targets = o.source === "page" ? pages.filter((p) => p.active).map((p) => ({ page: pages.indexOf(p), name: p.name })) : pages.map((p, i) => ({ page: i, name: p.name }));
    }
    const jobs = buildJobs(targets, { scales: o.scales, formats: o.formats, template: o.template, folder: o.folders });
    $("preview").replaceChildren(...jobs.slice(0, 60).map((j) => Object.assign(document.createElement("div"), { textContent: j.file })));
    say(jobs.length ? `${jobs.length} files will be created.` : t("nothing"));
  } catch (e) { say(e.message); }
}

async function doExport() {
  const o = exportOptions();
  if (!o.scales.length || !o.formats.length) return say("Choose at least one size and one format.");
  $("export").disabled = true;
  say("Exporting…");
  try {
    const res = await runExport(openfini, o);
    say(res.empty ? t("nothing") : res.saved ? t("exported", { n: res.files.length }) : "Cancelled.");
  } catch (e) { say(e.message); } finally { $("export").disabled = false; }
}

async function previewRename() {
  try {
    const plan = await runRename(openfini, renameOptions(), { apply: false });
    $("renames").replaceChildren(...plan.slice(0, 80).map((p) => Object.assign(document.createElement("div"), { textContent: p.changed ? `${p.from}  →  ${p.to}` : `${p.from}  (unchanged)` })));
    say(plan.length ? `${plan.filter((p) => p.changed).length} of ${plan.length} layers would change.` : "Select layers to rename.");
  } catch (e) { say(e.message); }
}

async function doRename() {
  try {
    const plan = await runRename(openfini, renameOptions());
    const n = plan.filter((p) => p.changed).length;
    say(n ? t("renamed", { n }) : t("noRename"));
    previewRename();
  } catch (e) { say(e.message); }
}

for (const el of document.querySelectorAll("#source, #template, #folders, input[name=scale], input[name=format]")) el.addEventListener("input", previewExport);
$("export").addEventListener("click", doExport);
$("refresh").addEventListener("click", () => { previewExport(); previewRename(); });
$("rename").addEventListener("click", doRename);
for (const id of ["find", "replace", "prefix", "suffix", "caseMode", "start", "regex", "number", "numpre"]) $(id).addEventListener("input", previewRename);
openfini.events.on("selectionChanged", () => { previewExport(); previewRename(); });
previewExport();
previewRename();
