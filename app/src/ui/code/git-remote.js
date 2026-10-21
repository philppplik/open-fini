// Remote side of Source Control: connect/clone dialogs, push and pull with confirmations, repository ZIP import.
// Honest transport rules (see docs/git-and-publishing.md): GitHub through its REST API (works from a browser with a
// personal access token); any other HTTPS Git server only through a CORS proxy you configure.
import { h } from "../../core/util.js";
import { openDialog, confirmDialog } from "../dialogs.js";
import { getSecret, setSecret } from "./secrets.js";
import { pickFiles } from "./import.js";
import { Doc } from "../../core/doc.js";
import { ensureWeb } from "../../core/web.js";
import { isTextPath } from "../../engine/web/index.js";
import { strFromU8 } from "../../../vendor/fflate/fflate.js";

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Opens a new project document from files (Map path → bytes) and an optional `.git` Map. */
export function openProjectDoc(app, { name, files, git }) {
  const obj = {};
  for (const [p, b] of files) obj[p] = isTextPath(p) ? strFromU8(b) : b;
  const doc = new Doc({ name: name || "Website", width: 1280, height: 800, studio: "code" });
  ensureWeb(doc, obj);
  if (git) doc.web.gitFiles = git;
  doc.history.clear();
  doc.saved = false;
  app.openDoc(doc);
  app.setStudio("code");
  return doc;
}

const field = (label, input, help) => h("label.of-gitform__field", h("span", label), input, help ? h("small", help) : null);
const input = (attrs) => h("input.of-gitform__input", { autocomplete: "off", spellcheck: "false", ...attrs });

/** Connect or edit the remote of this project. */
export function openRemoteDialog(ws, svc) {
  const app = ws.app;
  const existing = svc.repo.remotes()[0];
  const url = input({ type: "url", placeholder: "https://github.com/owner/repository", value: existing?.url || "" });
  const token = input({ type: "password", placeholder: "Personal access token", "aria-label": "Access token" });
  const proxy = input({ type: "url", placeholder: "Optional: https://cors-proxy.example/", value: svc.remoteSettings.proxy || "" });
  const note = h("p.of-git__hint");
  const upd = async () => {
    const u = url.value.trim();
    const t = /^https?:\/\/github\.com\//i.test(u) && !proxy.value.trim() ? "GitHub REST API (api.github.com)" : "smart HTTP through your CORS proxy";
    note.textContent = u ? `Transport: ${t}. The token is sent only to ${t.startsWith("GitHub") ? "api.github.com" : hostOf(proxy.value.trim()) || "the proxy (set one)"}.` : "";
    const have = u ? !!(await getSecret(`git:${hostOf(u)}`).catch(() => "")) : false;
    token.placeholder = have ? "Saved on this device — leave empty to keep" : "Personal access token";
  };
  url.addEventListener("input", upd);
  proxy.addEventListener("input", upd);
  upd();
  const body = h(
    "div.of-gitform",
    field("Repository address", url),
    field("Access token", token, "GitHub: a fine-grained token with Contents read/write for this repository. Stored privately on this device (never in the document)."),
    field("CORS proxy (only for non-GitHub servers)", proxy, "Browsers cannot talk to most Git servers directly. Use a proxy you trust: it can read your token and your code."),
    note,
    h("p.of-git__hint", "Nothing is sent until you press Push or Pull and confirm."),
  );
  openDialog({
    title: "Remote repository",
    body,
    width: 520,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      ...(existing ? [{ label: "Remove remote", onClick: async (c) => (await svc.setRemote(null), c(), svc.panel?.render()) }] : []),
      {
        label: "Save",
        variant: "primary",
        onClick: async (close) => {
          try {
            const u = url.value.trim();
            if (!/^https:\/\//i.test(u)) throw new Error("Enter an https:// repository address.");
            await svc.setRemote(u);
            svc.remoteSettings.proxy = proxy.value.trim();
            if (token.value) await setSecret(`git:${hostOf(u)}`, token.value.trim());
            close();
            svc.panel?.render();
            app.toast("Remote saved.", "success", 1800);
          } catch (err) {
            app.toast(err.message, "warning", 4500);
          }
        },
      },
    ],
  });
}

/** Push or pull after a confirmation that names the destination. */
export async function syncAction(ws, svc, kind) {
  const app = ws.app;
  const remote = svc.repo.remotes()[0];
  if (!remote) return openRemoteDialog(ws, svc);
  const host = hostOf(remote.url);
  let token = "";
  try {
    token = await getSecret(`git:${host}`);
  } catch (err) {
    return app.toast(err.message, "warning", 5000);
  }
  if (!token && kind === "push") return openRemoteDialog(ws, svc);
  const st = svc.status;
  const where = svc.transportFor(remote.url) === "github-api" ? "api.github.com" : hostOf(svc.remoteSettings.proxy) || host;
  const what = kind === "push" ? `Push the branch “${st?.branch}” (${st?.upstream ? `${st.upstream.ahead} new commit${st.upstream.ahead === 1 ? "" : "s"}` : "all commits"}) to ${remote.url}?` : `Download new commits of “${st?.branch}” from ${remote.url} and merge them?`;
  if (!(await confirmDialog({ title: kind === "push" ? "Push to remote" : "Pull from remote", message: `${what}\nYour access token is sent only to ${where}.`, ok: kind === "push" ? "Push" : "Pull" }))) return;
  const ac = new AbortController();
  app.status(kind === "push" ? "Pushing…" : "Pulling…");
  try {
    const onProgress = (t) => app.status(typeof t === "string" ? t : t?.text || "");
    const res = await svc[kind]({ token, onProgress, signal: ac.signal });
    if (kind === "pull" && res.result === "conflict") app.toast(`Pulled, but ${res.conflicts.length} file${res.conflicts.length === 1 ? " conflicts" : "s conflict"}. Resolve them, stage and commit.`, "warning", 8000);
    else app.toast(kind === "push" ? res.message : { "up-to-date": "Already up to date.", "fast-forward": "Pulled new commits.", merged: "Pulled and merged." }[res.result], "success", 3000);
  } catch (err) {
    if (err.name !== "AbortError") app.toast(err.message, "warning", 7000);
  } finally {
    app.status("");
    svc.panel?.render();
  }
}

/** Clone a GitHub repository into a new project document. */
export function openCloneDialog(ws) {
  const app = ws.app;
  const repo = input({ placeholder: "owner/repository or https://github.com/owner/repository" });
  const branch = input({ placeholder: "Branch (default branch if empty)" });
  const token = input({ type: "password", placeholder: "Personal access token" });
  const remember = h("input", { type: "checkbox", id: "of-git-remember" });
  const body = h("div.of-gitform", field("Repository", repo), field("Branch", branch), field("Access token", token, "Needed by the GitHub API (public repositories too). Sent only to api.github.com."), h("label.of-gitform__check", remember, "Remember the token on this device"), h("p.of-git__hint", "Clones the branch's latest 100 commits into a new project. Other Git servers: open a repository ZIP instead."));
  openDialog({
    title: "Clone from GitHub",
    body,
    width: 500,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Clone",
        variant: "primary",
        onClick: async (close) => {
          try {
            app.network?.assert?.("publish", "https://api.github.com");
            const G = await import("../../engine/git/index.js");
            const r = G.parseGitHubRepo(repo.value);
            if (!r) throw new Error("Enter the repository as owner/name.");
            let tk = token.value.trim();
            if (!tk) tk = await getSecret("git:github.com");
            if (!tk) throw new Error("Enter a GitHub personal access token.");
            close();
            app.status("Cloning…");
            const api = new G.GitHubApi({ token: tk, fetch: (...a) => fetch(...a) });
            const out = await G.cloneFromGitHub(api, { owner: r.owner, name: r.name, branch: branch.value.trim() || undefined, onProgress: (t) => app.status(t) });
            if (remember.checked && token.value.trim()) await setSecret("git:github.com", token.value.trim());
            openProjectDoc(app, { name: r.name, files: out.files, git: out.git });
            app.toast(`Cloned ${r.owner}/${r.name}.`, "success", 2500);
          } catch (err) {
            app.toast(err.message, "warning", 7000);
          } finally {
            app.status("");
          }
        },
      },
    ],
  });
}

/** Opens a ZIP with a .git folder (or a plain site ZIP) as a new project. */
export async function importRepoZipDialog(ws) {
  const app = ws.app;
  const [file] = await pickFiles({ accept: ".zip,application/zip", multiple: false });
  if (!file) return;
  try {
    const { importRepoZip } = await import("../../engine/git/index.js");
    const { files, git } = importRepoZip(new Uint8Array(await file.arrayBuffer()));
    if (!files.size) throw new Error("The ZIP contains no files.");
    openProjectDoc(app, { name: file.name.replace(/\.zip$/i, ""), files, git });
    app.toast(git ? "Opened the repository with its history." : "Opened the ZIP as a project (it has no .git folder).", "success", 3000);
  } catch (err) {
    app.toast(err.message || "That ZIP could not be opened.", "danger", 5000);
  }
}
