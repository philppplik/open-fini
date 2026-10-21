// Accessibility Checker panel. lib.js and the shared color math are prepended by the packer.
const $ = (id) => document.getElementById(id);
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
let last = { target: "", issues: [] };

const say = (text) => { $("summary").textContent = text; };

function render() {
  const f = $("filter").value;
  const shown = last.issues.filter((it) => f === "all" || it.severity === f);
  const s = summarize(last.issues);
  $("summary").textContent = last.issues.length ? `${last.target}: ${t("summary", s)}` : last.target ? `${last.target}: ${t("clean")}` : "Run the audit to check the current document.";
  $("issues").replaceChildren(...shown.slice(0, 200).map((it) => {
    const li = document.createElement("li");
    li.className = `issue ${it.severity}`;
    const badge = Object.assign(document.createElement("span"), { className: "badge", textContent: it.severity });
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.append(document.createTextNode(it.message));
    msg.append(Object.assign(document.createElement("span"), { className: "where", textContent: `${it.where} · ${it.rule}` }));
    const btns = document.createElement("div");
    btns.className = "btns";
    const sel = Object.assign(document.createElement("button"), { type: "button", textContent: "Select", title: "Select the layer or element" });
    sel.addEventListener("click", async () => {
      try { if (!(await selectIssue(openfini, it))) say(`Could not locate it automatically: ${it.where}`); } catch (e) { say(e.message); }
    });
    btns.append(sel);
    if (it.fix) {
      const fix = Object.assign(document.createElement("button"), { type: "button", textContent: "Fix", title: it.fix.label });
      fix.addEventListener("click", async () => {
        try { await applyFix(openfini, it); last.issues = last.issues.filter((x) => x !== it); render(); say(`${t("fixed")} ${it.fix.label}`); } catch (e) { say(e.message); }
      });
      btns.append(fix);
    }
    li.append(badge, msg, btns);
    return li;
  }));
}

async function run() {
  $("run").disabled = true;
  say("Checking…");
  try {
    last = await runAudit(openfini);
    await openfini.storage.set("last", { target: last.target, issues: last.issues.slice(0, 200) }).catch(() => {});
    render();
  } catch (e) { say(e.message); } finally { $("run").disabled = false; }
}

async function fixAll() {
  const fixable = last.issues.filter((it) => it.fix);
  if (!fixable.length) return say("Nothing can be fixed automatically.");
  let n = 0;
  for (const it of fixable) {
    try { await applyFix(openfini, it); n++; } catch (e) { say(e.message); break; }
  }
  await run();
  say(`Applied ${n} fixes. ${$("summary").textContent}`);
}

async function report() {
  try {
    if (!last.target) await run();
    const md = toMarkdown({ target: last.target, issues: last.issues, date: new Date().toISOString().slice(0, 10) });
    const res = await openfini.files.save({ name: "accessibility-report.md", data: md, mime: "text/markdown" });
    if (res.saved) say(t("report"));
  } catch (e) { say(e.message); }
}

$("run").addEventListener("click", run);
$("fixall").addEventListener("click", fixAll);
$("report").addEventListener("click", report);
$("filter").addEventListener("change", render);
openfini.storage.get("last", null).then((v) => { if (v) { last = v; render(); } });
