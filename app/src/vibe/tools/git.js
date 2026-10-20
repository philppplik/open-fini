// OpenFini tools for Source Control (Git) of the website project. Reads are free; changes to history are local;
// push/pull talk to the network and need approval.
import { tool, S } from "./helpers.js";
import { gitServiceFor } from "../../ui/code/git-service.js";
import { getSecret } from "../../ui/code/secrets.js";
import { confirmDialog } from "../../ui/dialogs.js";
import { vibeStore } from "../store.js";

const clip = (s, n = 12000) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);

export function gitTools(app) {
  const svc = async ({ needRepo = true } = {}) => {
    const web = app.doc?.web;
    if (!web) throw new Error("The active document has no website project. Use create_website first.");
    const s = gitServiceFor(app, web);
    await s.ready();
    if (needRepo && !s.exists) throw new Error("This project has no Git repository yet. Call git_init first.");
    return s;
  };
  /** In "auto" approval mode the session skips approval cards; outward actions still ask the person. */
  const confirmOutward = async (message, name) => {
    await vibeStore.load();
    if (vibeStore.settings.approval === "auto" || vibeStore.settings.autoAllow.includes(name)) {
      if (!(await confirmDialog({ title: "Assistant request", message, ok: "Allow" }))) throw new Error("The person declined.");
    }
  };
  const short = (st) => ({
    branch: st.branch || `(detached ${st.head?.slice(0, 7)})`,
    head: st.head?.slice(0, 7) || null,
    merging: st.merging ? { conflicts: st.merging.conflicts } : null,
    ahead: st.upstream?.ahead ?? null,
    behind: st.upstream?.behind ?? null,
    changes: st.changes.map((c) => `${c.conflict ? "!" : c.staged || " "}${c.unstaged || " "} ${c.path}`),
  });

  return [
    tool("git_init", "Creates a Git repository for the website project (history is stored inside the document).", { branch: S.str("Initial branch name (default main)") }, [], async (a) => {
      const s = await svc({ needRepo: false });
      if (s.exists) return { ok: true, note: "A repository already exists." };
      await s.init({ branch: a.branch || "main" });
      return { ok: true, branch: a.branch || "main" };
    }),

    tool("git_status", "Shows the Git branch and the changed files. Status letters: first column staged (A/M/D), second unstaged (M/D/U = untracked), ! = merge conflict.", {}, [], async () => short(await (await svc()).refresh()), { readOnly: true }),

    tool("git_diff", "Returns a unified diff: of one file (working tree vs index, or staged with staged:true, or a commit's change with commit) or the diffs of all changed files.", {
      path: S.str("File path; omit for all changed files"), staged: S.bool("Compare the staged version with HEAD"), commit: S.str("Show this commit's change instead (id or revision)"),
    }, [], async (a) => {
      const s = await svc();
      if (a.commit) {
        const oid = s.repo.resolve(a.commit);
        if (!oid) throw new Error(`Unknown commit “${a.commit}”.`);
        const info = await s.commitInfo(oid);
        const files = a.path ? info.changes.filter((c) => c.path === a.path) : info.changes;
        const parts = [`${oid.slice(0, 7)} ${info.message.split("\n")[0]}`];
        for (const f of files.slice(0, 30)) parts.push(await s.unifiedDiff(f.path, { commit: oid }));
        return clip(parts.join("\n"));
      }
      const st = await s.refresh();
      const list = a.path ? [a.path] : st.changes.map((c) => c.path);
      const parts = [];
      for (const p of list.slice(0, 40)) {
        const c = st.changes.find((x) => x.path === p);
        if (a.staged || (!a.path && c?.staged && !c?.unstaged)) parts.push(await s.unifiedDiff(p, "staged"));
        else if (c?.unstaged === "U") parts.push(`Untracked file ${p} (${(s.web.text(p) || "").split("\n").length} lines).`);
        else parts.push(await s.unifiedDiff(p, "unstaged"));
      }
      return clip(parts.filter(Boolean).join("\n") || "No changes.");
    }, { readOnly: true }),

    tool("git_log", "Lists recent commits (newest first) with branch and tag labels.", { limit: S.num("How many (default 20, max 100)"), search: S.str("Only commits whose message or author contains this text"), path: S.str("Only commits that changed this file") }, [], async (a) => {
      const s = await svc();
      const list = await s.log({ limit: Math.min(a.limit || 20, 100), search: a.search || "", path: a.path || null, all: false });
      return list.map((c) => `${c.short} ${c.subject} — ${c.author}, ${new Date(c.ts * 1000).toISOString().slice(0, 10)}${c.refs.length ? ` (${c.refs.map((r) => r.name).join(", ")})` : ""}`);
    }, { readOnly: true }),

    tool("git_commit", "Commits changes locally. By default stages every changed file first. Write a clear message: a short imperative summary line, optional details after a blank line. Check git_status and git_diff first.", {
      message: S.str("Commit message"), all: S.bool("Stage all changes first (default true)"),
    }, ["message"], async (a) => {
      const s = await svc();
      const oid = await s.commit(a.message, { all: a.all !== false });
      return { ok: true, commit: oid.slice(0, 7), branch: s.status?.branch };
    }),

    tool("git_branch", "Lists, creates, deletes or merges branches.", {
      action: S.str("What to do", { enum: ["list", "create", "delete", "merge"] }), name: S.str("Branch name (for create, delete, merge)"), checkout: S.bool("Switch to the new branch (create only, default true)"),
    }, ["action"], async (a) => {
      const s = await svc();
      if (a.action === "list") {
        const b = await s.branches();
        return { current: b.current, local: b.local.map((x) => x.name), remote: b.remote.map((x) => x.name), tags: (await s.tags()).map((t) => t.name) };
      }
      if (!a.name) throw new Error("A branch name is required.");
      if (a.action === "create") {
        await s.createBranch(a.name, { checkout: a.checkout !== false });
        return { ok: true, branch: a.name };
      }
      if (a.action === "delete") {
        await s.deleteBranch(a.name);
        return { ok: true };
      }
      const r = await s.merge(a.name);
      return r.result === "conflict" ? { result: "conflict", conflicts: r.conflicts, note: "Conflict markers (<<<<<<<) were written into these files. Edit them, then git_commit." } : { result: r.result };
    }, { needsApproval: (a) => (a.action === "delete" ? `Delete the branch “${a.name}”?` : false) }),

    tool("git_checkout", "Switches to a branch, tag or commit and updates the project files. Refuses when uncommitted changes would be overwritten.", { target: S.str("Branch, tag or commit id"), force: S.bool("Discard conflicting uncommitted changes") }, ["target"], async (a) => {
      const s = await svc();
      const r = await s.checkout(a.target, { force: !!a.force });
      return { ok: true, branch: r.branch, commit: r.oid.slice(0, 7) };
    }, { needsApproval: (a) => (a.force ? `Switch to “${a.target}” and discard uncommitted changes that conflict?` : false) }),

    tool("git_restore", "Restores one file to the version from a commit (default: the last commit), overwriting the working copy.", { path: S.str("File path"), rev: S.str("Commit id, branch or tag (default HEAD)") }, ["path"], async (a) => {
      const s = await svc();
      await s.restoreFile(a.path, a.rev || "HEAD");
      return { ok: true };
    }, { needsApproval: (a) => `Replace “${a.path}” with the version from ${a.rev || "the last commit"}? Unsaved differences are lost.` }),

    tool("git_push", "Pushes the current branch to the project's remote (GitHub via API token, or another HTTPS server through the configured CORS proxy). The person must have configured the remote and token in Source Control.", {}, [], async () => {
      const s = await svc();
      const remote = s.repo.remotes()[0];
      if (!remote) throw new Error("No remote is configured. Ask the person to connect one in Source Control > Remote.");
      await confirmOutward(`Push the branch “${s.repo.head().branch}” to ${remote.url}?`, "git_push");
      const token = await getSecret(`git:${new URL(remote.url).hostname}`);
      if (!token) throw new Error("No access token is saved for this remote. Ask the person to add one in Source Control > Remote.");
      const r = await s.push({ token });
      return { ok: true, message: r.message };
    }, { needsApproval: () => "Push the current branch to the remote repository (network)?" }),

    tool("git_pull", "Fetches the remote branch of the same name and merges it into the current branch.", {}, [], async () => {
      const s = await svc();
      const remote = s.repo.remotes()[0];
      if (!remote) throw new Error("No remote is configured.");
      await confirmOutward(`Pull from ${remote.url}?`, "git_pull");
      const token = await getSecret(`git:${new URL(remote.url).hostname}`);
      const r = await s.pull({ token });
      return r.result === "conflict" ? { result: "conflict", conflicts: r.conflicts } : { result: r.result };
    }, { needsApproval: () => "Pull from the remote repository (network)?" }),
  ];
}
