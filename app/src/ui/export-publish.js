// "Publish" tab of the export popup: one-click deployment of the Code studio project. Targets, include/exclude
// patterns, dry run with checks, confirmation, progress with cancel, result with copy/open, deploy history.
// The deploy code (engine/publish) and the service load on first use.
import { h, empty, formatBytes } from "../core/util.js";
import { openDialog, confirmDialog, promptDialog } from "./dialogs.js";
import { publishServiceFor } from "./code/publish-service.js";

const when = (t) => new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function createPublishTab(app, web) {
  const svc = publishServiceFor(app, web);
  let T = null; // engine targets, loaded lazily
  let cur = svc.profiles()[0] || null;
  let draft = null; // unsaved new profile
  const root = h("div.of-gitform.of-pub");
  const out = h("div");

  const field = (label, ctl, help) => h("label.of-gitform__field", h("span", label), ctl, help ? h("small", help) : null);

  async function render() {
    T ||= await import("../engine/publish/targets.js");
    empty(root);
    const profile = draft || cur;
    // target chooser
    const sel = h("select.of-gitform__input", { "aria-label": "Publish target" });
    for (const p of svc.profiles()) sel.append(h("option", { value: p.id, selected: !draft && cur?.id === p.id }, `${p.label} — ${T.targetById(p.kind)?.label || p.kind}`));
    if (!svc.profiles().length) sel.append(h("option", { value: "" }, "No target yet — add one"));
    sel.addEventListener("change", () => ((cur = svc.profile(sel.value)), (draft = null), render()));
    const kinds = h("select.of-gitform__input", { "aria-label": "New target type" }, h("option", { value: "" }, "Add a target…"), ...T.TARGETS.map((t) => h("option", { value: t.id }, t.label + (t.unavailable ? " (not available)" : ""))));
    kinds.addEventListener("change", () => {
      const t = T.targetById(kinds.value);
      if (!t) return;
      draft = { id: null, kind: t.id, label: t.label, config: {}, include: "", exclude: "" };
      render();
    });
    root.append(h("div.of-pub__row", field("Target", sel), field("New", kinds)));
    if (!profile) {
      root.append(h("p.of-git__hint", "Publish sends your finished site (not the editor files) to a web host. Pick a target above. Tokens are kept on this device only, never in the document."));
      return void root.append(historyBlock());
    }
    const t = T.targetById(profile.kind);
    if (t.unavailable) return void root.append(h("p.of-git__hint", t.unavailable));
    root.append(profileForm(profile, t));
    root.append(out, historyBlock());
  }

  function profileForm(profile, t) {
    const name = h("input.of-gitform__input", { value: profile.label, "aria-label": "Name" });
    const inputs = {};
    const fields = [field("Name", name)];
    for (const f of t.fields) {
      const ctl = f.options
        ? h("select.of-gitform__input", ...f.options.map(([v, l]) => h("option", { value: v, selected: (profile.config[f.key] || f.options[0][0]) === v }, l)))
        : h("input.of-gitform__input", { value: profile.config[f.key] || "", placeholder: f.placeholder || "", autocomplete: "off", spellcheck: "false" });
      inputs[f.key] = ctl;
      fields.push(field(f.label, ctl));
    }
    const secret = h("input.of-gitform__input", { type: "password", placeholder: "Not saved yet", autocomplete: "off", "aria-label": t.secret });
    svc.hasSecret(profile).then((has) => has && (secret.placeholder = "Saved on this device — leave empty to keep"));
    const include = h("textarea", { placeholder: "Only these (optional), e.g. *.html", "aria-label": "Include patterns" }, profile.include || "");
    const exclude = h("textarea", { placeholder: "Never upload, e.g. *.map\ndrafts/", "aria-label": "Exclude patterns" }, profile.exclude || "");
    const save = h("sl-button", { size: "small", variant: "default" }, draft ? "Save target" : "Save changes");
    const del = h("sl-button", { size: "small", variant: "text" }, "Remove");
    const apply = () => {
      const config = {};
      for (const [k, el] of Object.entries(inputs)) config[k] = el.value.trim();
      return { ...profile, label: name.value.trim() || t.label, config: { ...profile.config, ...config }, include: include.value, exclude: exclude.value };
    };
    save.addEventListener("click", async () => {
      try {
        const rec = svc.upsert(apply());
        if (secret.value) await svc.setSecret(rec, secret.value.trim());
        cur = rec;
        draft = null;
        app.toast("Target saved.", "success", 1600);
        render();
      } catch (err) {
        app.toast(err.message, "warning", 4500);
      }
    });
    del.addEventListener("click", async () => {
      if (draft) return ((draft = null), render());
      if (await confirmDialog({ title: "Remove target", message: `Remove “${profile.label}”? Its saved token stays in this device's storage until you overwrite it.`, ok: "Remove", danger: true })) {
        svc.remove(profile.id);
        cur = svc.profiles()[0] || null;
        render();
      }
    });
    // built-in FTP/FTPS (desktop app): a clear note in the browser, "Test connection" on the desktop
    const desktop = typeof window !== "undefined" && !!window.__TAURI__?.core;
    const nativeNote = t.desktopOnly && !desktop ? h("p.of-git__hint", { role: "note" }, "This target is built into the OpenFini desktop app. A browser or the installed web app cannot open FTP connections: install the desktop app, or use WebDAV, a hosted service or the publish helper here.") : null;
    const testOut = h("p.of-git__hint", { "aria-live": "polite" });
    let testBtn = null;
    if (t.testable && desktop) {
      testBtn = h("sl-button", { size: "small" }, "Test connection");
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testOut.textContent = "Connecting…";
        try {
          const rec = draft ? { ...apply(), id: "test" } : Object.assign(profile, apply());
          testOut.textContent = await svc.test(rec, secret.value.trim());
        } catch (err) {
          testOut.textContent = err.message || String(err);
        } finally {
          testBtn.disabled = false;
        }
      });
    }
    const check = h("sl-button", { size: "small" }, "Check and list files");
    check.addEventListener("click", async () => {
      Object.assign(profile, apply());
      await showPlan(profile);
    });
    state.current = () => ({ profile: draft ? null : cur, apply, secret: secret.value.trim() });
    return h(
      "div.of-gitform",
      nativeNote,
      ...fields,
      field(t.secret, secret, t.secretHelp),
      testBtn ? h("div.of-pub__row", testBtn, testOut) : null,
      field("Include only (one pattern per line, optional)", include, "gitignore-style patterns such as *.html or assets/**"),
      field("Exclude", exclude, ".git, .DS_Store and Thumbs.db are always left out."),
      h("div.of-pub__row", save, del, h("span", { style: { flex: 1 } }), check),
    );
  }
  const state = { current: () => ({}) };

  async function showPlan(profile) {
    empty(out);
    out.append(h("p.of-git__hint", "Checking…"));
    try {
      const p = await svc.plan(profile);
      empty(out);
      const { summarizeIssues } = await import("../engine/publish/preflight.js");
      const issues = [...p.issues, ...p.buildWarnings.map((w) => ({ severity: "warning", path: "", message: w }))];
      out.append(h("p", h("strong", `${p.summary.count} files · ${formatBytes(p.summary.bytes)}`), ` will be uploaded. Checks: ${summarizeIssues(issues)}.`));
      if (issues.length) out.append(h("div.of-pub__issues", { role: "list" }, ...issues.map((i) => h("div.of-pub__issue", { role: "listitem" }, h("span.sev", { "data-s": i.severity }, i.severity), h("span", i.path ? `${i.path}: ${i.message}` : i.message)))));
      out.append(h("div.of-pub__files", { "aria-label": "Files to upload" }, ...p.files.slice(0, 400).map((f) => h("div", h("span", f.path), h("span", formatBytes(f.bytes.length)))), ...p.skipped.slice(0, 50).map((s) => h("div.skip", h("span", s), h("span", "excluded")))));
    } catch (err) {
      empty(out);
      out.append(h("p.of-git__hint", err.message));
    }
  }

  function historyBlock() {
    const hist = svc.history();
    if (!hist.length) return h("div");
    return h("div.of-pub__history", h("strong", "Deploy history"), ...hist.slice(0, 8).map((e) => h("div", `${when(e.time)} · ${e.profile} · ${e.files} files, ${formatBytes(e.bytes)} · `, e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", onclick: (ev) => (ev.preventDefault(), import("./links.js").then((m) => m.openLink(e.url, { app }))) }, e.url) : "—")));
  }

  /** The primary button: saves the form, then confirms and deploys. */
  async function run() {
    const { profile: p0, apply, secret } = state.current();
    let profile = p0 || (draft ? svc.upsert(apply()) : null);
    if (!profile) return app.toast("Add a publish target first.", "warning", 2600);
    profile = svc.upsert({ ...apply(), id: profile.id });
    if (secret) await svc.setSecret(profile, secret);
    await deployWithConfirm(app, svc, profile);
    cur = profile;
    draft = null;
    render();
  }

  render();
  return { id: "publish", label: "Publish", action: "Publish…", el: root, run };
}

/** Confirmation → progress → result. Everything outward-facing happens only after the user confirms. */
export async function deployWithConfirm(app, svc, profile) {
  const T = await import("../engine/publish/targets.js");
  const t = T.targetById(profile.kind);
  let plan;
  try {
    plan = await svc.plan(profile);
  } catch (err) {
    return app.toast(err.message, "danger", 6000);
  }
  if (!plan.files.length) return app.toast("There are no files to publish. Check the include and exclude patterns.", "warning", 4000);
  const errors = plan.issues.filter((i) => i.severity === "error");
  const warns = plan.issues.filter((i) => i.severity === "warning");
  const lines = [`Upload ${plan.summary.count} files (${formatBytes(plan.summary.bytes)}) to ${profile.label} (${t.label}, ${svc.destination(profile)})?`, "This makes the site public at that address. Your token is sent only to that service."];
  if (profile.kind === "github-pages") lines.push(`Everything on the branch “${profile.config.branch || "gh-pages"}” is replaced.`);
  if (errors.length) lines.push(`Checks found ${errors.length} error${errors.length === 1 ? "" : "s"} (for example: ${errors[0].message.slice(0, 90)}). You can publish anyway.`);
  else if (warns.length) lines.push(`Checks found ${warns.length} warning${warns.length === 1 ? "" : "s"}.`);
  if (!(await confirmDialog({ title: "Publish website", message: lines.join("\n\n"), ok: errors.length ? "Publish anyway" : "Publish" }))) return;
  let secret;
  if (profile.kind === "helper") {
    const token = await svc.hasSecret(profile).then(async (has) => (has ? (await import("./code/secrets.js")).getSecret(svc.secretKey(profile)) : ""));
    if (!token) return app.toast("Add the helper token in the target settings.", "warning", 4000);
    const protocol = profile.config.protocol || "sftp";
    let password = "";
    if (protocol !== "sftp" && protocol !== "rsync") {
      password = (await promptDialog({ title: `Password for ${profile.config.host}`, label: "Used for this upload only; it is never saved.", type: "password", ok: "Continue" })) ?? null;
      if (password === null) return;
    }
    secret = JSON.stringify({ token, password });
  }
  await progressDialog(app, svc, profile, plan, secret);
}

function progressDialog(app, svc, profile, plan, secret) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const text = h("div", { role: "status", "aria-live": "polite" }, "Starting…");
    const bar = h("div.of-pub__bar", h("i"));
    const body = h("div.of-pub__result", text, bar);
    let finished = false;
    const { dlg, close } = openDialog({
      title: `Publishing to ${profile.label}`,
      body,
      width: 460,
      buttons: [{ label: "Cancel", onClick: (c) => (finished ? c() : (ac.abort(), c())) }],
      onClose: () => (ac.abort(), resolve()),
    });
    const finish = (children, label = "Close") => {
      finished = true;
      empty(body);
      body.append(...children);
      const btn = dlg.querySelector('[slot="footer"] sl-button');
      if (btn) btn.textContent = label;
    };
    svc
      .run(profile, { secret, signal: ac.signal, plan, onProgress: (p) => {
        if (p?.text) text.textContent = p.text;
        if (p?.total) bar.firstChild.style.width = `${Math.round(((p.done || 0) / p.total) * 100)}%`;
      } })
      .then((res) => {
        const url = res.url;
        const kids = [h("p", h("strong", "Done. "), `${res.message} ${res.files} files, ${formatBytes(res.bytes)}.`)];
        if (url) {
          const copy = h("sl-button", { size: "small" }, "Copy address");
          copy.addEventListener("click", () => navigator.clipboard?.writeText(url).then(() => app.toast("Address copied.", "success", 1400)));
          const open = h("sl-button", { size: "small", variant: "primary" }, "Open site");
          open.addEventListener("click", () => import("./links.js").then((m) => m.openLink(url, { app, confirmed: true })));
          kids.push(h("div.of-pub__url", url), h("div.of-pub__row", copy, open));
        }
        finish(kids);
      })
      .catch((err) => {
        if (err.name === "AbortError" || err.code === "CANCELLED") return close();
        const kids = [h("p", h("strong", "Publishing failed. "), err.message || "Unknown error."), h("p.of-git__hint", "Nothing is lost: your project is unchanged. Fix the problem and try again.")];
        // the helper is a Node.js program: when it does not answer, explain how to start it instead of a raw error
        if (profile.kind === "helper" && err.code === "NETWORK") {
          const how = h("sl-button", { size: "small", variant: "primary" }, "How to start the helper");
          how.addEventListener("click", () => import("./node-tools.js").then((m) => m.nodeToolDialog(app, "publish-helper")));
          kids.push(how);
        }
        finish(kids);
      });
  });
}
