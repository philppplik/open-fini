// OpenFini tools for publishing the website project: list targets, run the pre-publish checks, deploy.
import { tool, S } from "./helpers.js";
import { publishServiceFor } from "../../ui/code/publish-service.js";
import { getSecret } from "../../ui/code/secrets.js";
import { confirmDialog } from "../../ui/dialogs.js";
import { vibeStore } from "../store.js";

export function publishTools(app) {
  const svc = () => {
    const web = app.doc?.web;
    if (!web) throw new Error("The active document has no website project. Use create_website first.");
    return publishServiceFor(app, web);
  };
  const find = (s, name) => {
    const p = name ? s.profile(name) : s.profiles().length === 1 ? s.profiles()[0] : null;
    if (!p) throw new Error(name ? `There is no publish target “${name}”. Call list_publish_targets.` : "Several or no publish targets exist; pass target (see list_publish_targets).");
    return p;
  };

  return [
    tool("list_publish_targets", "Lists the saved publish targets of the project (Netlify, Vercel, GitHub Pages, WebDAV, server helper) with whether a token is saved, and the most recent deploys.", {}, [], async () => {
      const s = svc();
      const T = await import("../../engine/publish/targets.js");
      const targets = [];
      for (const p of s.profiles()) targets.push({ name: p.label, type: T.targetById(p.kind)?.label || p.kind, sendsTo: s.destination(p), tokenSaved: await s.hasSecret(p), configured: p.config });
      return { targets, availableTypes: T.TARGETS.filter((t) => !t.unavailable).map((t) => t.id), recent: s.history().slice(0, 5).map((e) => `${new Date(e.time).toISOString().slice(0, 16)} ${e.profile} ${e.url} (${e.files} files)`) };
    }, { readOnly: true }),

    tool("add_publish_target", "Adds a publish target to the project WITHOUT any secret. The person must paste the access token in Publish > target settings; never ask for it in chat.", {
      type: S.str("Target type", { enum: ["netlify", "vercel", "github-pages", "webdav", "helper"] }), name: S.str("Display name"), config: { type: "object", description: "Non-secret settings, e.g. { repo: 'me/site', branch: 'gh-pages' } for github-pages, { siteName } for netlify, { url, username } for webdav", additionalProperties: { type: "string" } },
    }, ["type"], async (a) => {
      const s = svc();
      const T = await import("../../engine/publish/targets.js");
      const t = T.targetById(a.type);
      if (!t || t.unavailable) throw new Error("That target type is not available.");
      const p = s.upsert({ kind: t.id, label: a.name || t.label, config: a.config || {} });
      return { ok: true, name: p.label, next: `Ask the person to open Publish, select “${p.label}” and paste the ${t.secret.toLowerCase()} (${t.secretHelp || ""}).` };
    }),

    tool("preflight_site", "Checks the site before publishing: broken links, missing alt text, missing title/description/viewport/lang, mixed content, large files. Also reports how many files would be uploaded. Fix errors first.", { target: S.str("Publish target name (applies its include/exclude patterns)") }, [], async (a) => {
      const s = svc();
      const p = a.target ? s.profile(a.target) : s.profiles()[0] || null;
      const plan = await s.plan(p);
      return { files: plan.summary.count, bytes: plan.summary.bytes, excluded: plan.skipped.length, issues: plan.issues.slice(0, 60).map((i) => `${i.severity} ${i.path}: ${i.message}`), buildWarnings: plan.buildWarnings.slice(0, 10) };
    }, { readOnly: true }),

    tool("publish_site", "Publishes the website to a saved target (the person must have saved its access token). Runs the checks first; refuses when errors remain unless ignoreErrors. This makes the site public.", {
      target: S.str("Publish target name (see list_publish_targets)"), ignoreErrors: S.bool("Publish even though the checks report errors"),
    }, [], async (a) => {
      const s = svc();
      const p = find(s, a.target);
      if (!(await s.hasSecret(p)) && p.kind !== "webdav") throw new Error(`No access token is saved for “${p.label}”. Ask the person to open Publish and paste it.`);
      if (p.kind === "helper" && !["sftp", "rsync"].includes(p.config.protocol || "sftp")) throw new Error("This target needs a password each time. Ask the person to publish from the Publish dialog.");
      const plan = await s.plan(p);
      const errors = plan.issues.filter((i) => i.severity === "error");
      if (errors.length && !a.ignoreErrors) return { published: false, reason: `${errors.length} error(s) in the checks`, errors: errors.slice(0, 10).map((e) => `${e.path}: ${e.message}`) };
      await vibeStore.load();
      if (vibeStore.settings.approval === "auto" || vibeStore.settings.autoAllow.includes("publish_site")) {
        if (!(await confirmDialog({ title: "Assistant request", message: `Publish ${plan.summary.count} files to ${p.label} (${s.destination(p)})? This makes the site public.`, ok: "Publish" }))) throw new Error("The person declined.");
      }
      let secret;
      if (p.kind === "helper") secret = JSON.stringify({ token: await getSecret(s.secretKey(p)), password: "" });
      const res = await s.run(p, { plan, secret });
      return { published: true, url: res.url, files: res.files, message: res.message };
    }, { needsApproval: (a) => {
      const web = app.doc?.web;
      const s = web ? publishServiceFor(app, web) : null;
      const p = s ? s.profile(a.target) || (s.profiles().length === 1 ? s.profiles()[0] : null) : null;
      return `Publish the website (about ${web?.files.size ?? "?"} project files) to ${p ? `${p.label} (${s.destination(p)})` : "a publish target"}? This makes it public.`;
    } }),
  ];
}
