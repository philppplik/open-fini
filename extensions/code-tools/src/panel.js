// Code Tools panel: snippet manager and formatter. lib.js and lib-format.js are prepended by the packer.
const $ = (id) => document.getElementById(id);
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const say = (text) => { $("status").textContent = text; };
let custom = [];
let files = [];

function show(tab) {
  for (const [id, panel] of [["t-snip", "p-snip"], ["t-fmt", "p-fmt"]]) {
    $(id).setAttribute("aria-selected", String(id === tab));
    $(panel).hidden = id !== tab;
  }
  if (tab === "t-fmt") loadFiles();
}

async function renderList() {
  const all = [...custom.map((s) => ({ ...s, custom: true })), ...SNIPPETS];
  const list = filterSnippets(all, { language: $("lang").value, query: $("q").value }).slice(0, 80);
  $("list").replaceChildren(...list.map((s) => {
    const row = document.createElement("div");
    row.className = "item";
    row.setAttribute("role", "listitem");
    const meta = document.createElement("div");
    meta.className = "meta";
    const b = document.createElement("b");
    b.textContent = s.label;
    const small = document.createElement("small");
    small.textContent = `${s.detail || ""} `;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = s.custom ? `${s.language} · yours` : s.language;
    small.append(tag);
    meta.append(b, small);
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Insert";
    add.title = s.language === "html" ? "Insert into the page body" : "Append to a project file";
    add.addEventListener("click", () => insert(s));
    row.append(meta, add);
    if (s.custom) {
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => { custom = custom.filter((c) => c !== custom.find((x) => x.label === s.label && x.language === s.language)); await openfini.storage.set("snippets", custom); renderList(); });
      row.append(del);
    }
    return row;
  }));
}

async function insert(s) {
  try {
    let file;
    if (s.language !== "html") {
      const want = s.language === "css" ? ["css"] : ["js"];
      const choices = (await projectFiles(openfini)).filter((f) => want.includes(f.lang));
      if (!choices.length) return say(`The project has no ${s.language} file to add this to.`);
      const v = await openfini.ui.form({ title: `Add “${s.label}” to…`, ok: "Add", fields: [{ name: "file", label: "File", type: "select", default: choices[0].path, options: choices.map((c) => c.path) }] });
      if (!v) return;
      file = v.file;
    }
    await insertSnippet(openfini, s, { file });
    say(`Inserted “${s.label}”.`);
  } catch (e) { say(e.message); }
}

async function saveSnippet() {
  const s = { language: $("n-lang").value, label: $("n-label").value.trim(), detail: "Your snippet", body: $("n-body").value };
  const err = snippetError(s);
  if (err) return say(err);
  custom = [...custom.filter((c) => !(c.label === s.label && c.language === s.language)), s];
  await openfini.storage.set("snippets", custom);
  $("n-label").value = "";
  $("n-body").value = "";
  say(t("snippetSaved"));
  renderList();
}

async function loadFiles() {
  try {
    files = await projectFiles(openfini);
    $("file").replaceChildren(...files.map((f) => Object.assign(document.createElement("option"), { value: f.path, textContent: f.path })));
    if (!files.length) say(t("noProject"));
  } catch { files = []; $("file").replaceChildren(); say(t("noProject")); }
}

async function onFile(mode) {
  const path = $("file").value;
  if (!path) return say(t("noProject"));
  try {
    const r = await processFile(openfini, path, mode);
    say(mode === "minify" ? t("minified", { path: r.target, before: r.before, after: r.after }) : mode === "sort" ? t("sorted", r) : t(r.changed ? "formatted" : "unchanged", r));
    if (mode === "minify") loadFiles();
  } catch (e) { say(t("failed", { path, error: e.message })); }
}

function onScratch(mode) {
  const lang = $("s-lang").value;
  try {
    const text = $("scratch").value;
    $("scratch").value = mode === "format" ? formatCode(lang, text) : mode === "sort" ? sortCssProperties(text) : minifyCode(lang, text);
    say("Done.");
  } catch (e) { say(e.message); }
}

async function boot() {
  custom = await openfini.storage.get("snippets", []);
  $("t-snip").addEventListener("click", () => show("t-snip"));
  $("t-fmt").addEventListener("click", () => show("t-fmt"));
  $("q").addEventListener("input", renderList);
  $("lang").addEventListener("change", renderList);
  $("n-save").addEventListener("click", saveSnippet);
  $("reload").addEventListener("click", loadFiles);
  $("b-format").addEventListener("click", () => onFile("format"));
  $("b-sort").addEventListener("click", () => onFile("sort"));
  $("b-min").addEventListener("click", () => onFile("minify"));
  $("s-format").addEventListener("click", () => onScratch("format"));
  $("s-min").addEventListener("click", () => onScratch("minify"));
  $("s-sort").addEventListener("click", () => onScratch("sort"));
  $("s-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("scratch").value); say("Copied."); } catch { say("Select the text and copy it."); } });
  renderList();
}
boot();
