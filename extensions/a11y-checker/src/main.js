// Accessibility Checker: commands. lib.js (and the shared color math) are prepended by the packer.
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

async function activate(openfini) {
  await openfini.commands.register("open", () => openfini.ui.openPanel("a11y"));

  await openfini.commands.register("audit", async () => {
    const res = await runAudit(openfini);
    const s = summarize(res.issues);
    await openfini.storage.set("last", { target: res.target, issues: res.issues.slice(0, 200) });
    await openfini.ui.showMessage(res.issues.length ? t("summary", s) : t("clean"), s.errors ? "warning" : "success");
    await openfini.ui.openPanel("a11y");
    return { target: res.target, ...s, issues: res.issues.slice(0, 50).map((i) => ({ rule: i.rule, severity: i.severity, where: i.where, message: i.message, fixable: !!i.fix })) };
  });

  await openfini.commands.register("report", async () => {
    const res = await runAudit(openfini);
    const md = toMarkdown({ target: res.target, issues: res.issues, date: new Date().toISOString().slice(0, 10) });
    const saved = await openfini.files.save({ name: "accessibility-report.md", data: md, mime: "text/markdown" });
    if (saved.saved) await openfini.ui.showMessage(t("report"), "success");
    return { saved: saved.saved, ...summarize(res.issues) };
  });
}
