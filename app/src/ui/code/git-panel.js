// Source Control pane of the Code studio: changes, staging, commit, history graph, branches, tags and remotes.
// Loaded the first time the pane is opened. All Git work goes through GitService (git-service.js).
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { openDialog, promptDialog, confirmDialog } from "../dialogs.js";
import { showContextMenu } from "../menus.js";
import { basename, dirname } from "../../engine/web/index.js";
import { renderDiff } from "./git-diff.js";
import { openCloneDialog, importRepoZipDialog } from "./git-remote.js";

const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }) : null;
export function ago(ts) {
  const s = Math.round(Date.now() / 1000 - ts);
  if (!rtf || s < 0) return new Date(ts * 1000).toLocaleDateString("en-US");
  let v = s;
  for (const [n, u] of [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"]]) {
    if (v < n) return rtf.format(-Math.round(v), u);
    v /= n;
  }
  return rtf.format(-Math.round(v), "year");
}

const LANE_COLORS = ["#8b7cf6", "#3dd68c", "#f5a524", "#4aa8ff", "#ef5b64", "#d56bd9"];

/** Assigns graph lanes: returns [{ node, lanesIn, lanesOut }] for commits newest first. */
export function graphLanes(commits) {
  let lanes = [];
  return commits.map((c) => {
    const lanesIn = lanes.slice();
    let node = lanes.indexOf(c.oid);
    if (node < 0) {
      node = lanes.indexOf(null);
      if (node < 0) node = lanes.length;
      lanes[node] = c.oid;
    }
    const out = lanes.slice();
    for (let i = 0; i < out.length; i++) if (out[i] === c.oid && i !== node) out[i] = null;
    out[node] = c.parents[0] || null;
    for (const p of c.parents.slice(1)) {
      if (!out.includes(p)) {
        const free = out.indexOf(null);
        if (free < 0) out.push(p);
        else out[free] = p;
      }
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    lanes = out;
    return { node, lanesIn: lanesIn.concat(lanesIn.includes(c.oid) ? [] : [c.oid]).slice(0, Math.max(lanesIn.length, node + 1)), lanesOut: out };
  });
}

function graphSvg(row, commit) {
  const W = 12;
  const H = 24;
  const n = Math.min(8, Math.max(row.lanesIn.length, row.lanesOut.length, row.node + 1));
  const x = (i) => Math.min(i, 7) * W + 8;
  const col = (i) => LANE_COLORS[i % LANE_COLORS.length];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(n * W + 6));
  svg.setAttribute("height", String(H));
  svg.setAttribute("aria-hidden", "true");
  const line = (x1, y1, x2, y2, c) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
    p.setAttribute("stroke", c);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-width", "1.6");
    svg.append(p);
  };
  row.lanesIn.forEach((oid, i) => {
    if (!oid) return;
    if (oid === commit.oid) line(x(i), 0, x(row.node), H / 2, col(i));
    else {
      const j = row.lanesOut.indexOf(oid);
      if (j >= 0) line(x(i), 0, x(j), H, col(i));
    }
  });
  commit.parents.forEach((p, k) => {
    const j = row.lanesOut.indexOf(p);
    if (j >= 0) line(x(row.node), H / 2, x(j), H, col(k === 0 ? row.node : j));
  });
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", String(x(row.node)));
  dot.setAttribute("cy", String(H / 2));
  dot.setAttribute("r", commit.parents.length > 1 ? "3" : "4");
  dot.setAttribute("fill", commit.parents.length > 1 ? "var(--of-bg-panel)" : col(row.node));
  dot.setAttribute("stroke", col(row.node));
  dot.setAttribute("stroke-width", "1.6");
  svg.append(dot);
  return svg;
}

export function mountGit(ws, el) {
  const { app, web } = ws;
  const svc = ws.git;
  let history = [];
  let historySearch = "";
  let sig = "";
  const open = new Set(["changes", "history"]);
  const msg = h("textarea.of-git__msg", { rows: "2", placeholder: "Commit message (Ctrl+Enter to commit)", "aria-label": "Commit message", spellcheck: "true" });
  const body = h("div.of-git__body");
  const head = h("div.of-side__head", h("span.of-side__title", "Source Control"));
  el.classList.add("of-gitpane");
  el.append(head, body);

  const run = async (fn, okText) => {
    try {
      const r = await fn();
      if (okText) app.toast(typeof okText === "function" ? okText(r) : okText, "success", 2200);
      return r;
    } catch (err) {
      if (err?.name !== "AbortError") app.toast(err.message || "Git failed.", "warning", 5200);
      return undefined;
    }
  };

  // ------------------------------------------------------------------ diffs and commit details

  function diffDialog({ title, files, load, extra, header }) {
    let mode = "unified";
    let current = files[0];
    const view = h("div.of-gitview__diff");
    const list = h("div.of-gitview__files", { role: "listbox", "aria-label": "Changed files" });
    const bar = h("div.of-gitview__bar");
    const wrap = h("div.of-gitview", header || null, h("div.of-gitview__split", files.length > 1 ? list : null, h("div.of-gitview__main", bar, view)));
    const show = async (f) => {
      current = f;
      for (const r of list.children) r.classList.toggle("selected", r.dataset.path === f.path);
      empty(view);
      empty(bar);
      bar.append(h("span.of-gitview__path", f.path));
      const seg = h("div.of-git__seg", { role: "group", "aria-label": "Diff layout" });
      for (const [m, label] of [["unified", "Unified"], ["split", "Side by side"]]) {
        const b = h("button", { type: "button", class: m === mode ? "active" : "", "aria-pressed": String(m === mode) }, label);
        b.addEventListener("click", () => {
          mode = m;
          show(f);
        });
        seg.append(b);
      }
      bar.append(seg);
      for (const x of extra?.(f) || []) bar.append(x);
      try {
        view.append(renderDiff(await load(f), mode));
      } catch (err) {
        view.append(h("div.of-empty", err.message));
      }
    };
    for (const f of files) {
      const r = h("button.of-gitview__file", { type: "button", role: "option", "data-path": f.path, title: f.path }, h("span.of-git__badge", { "data-k": f.status || "M" }, f.status || "M"), h("span", basename(f.path)));
      r.addEventListener("click", () => show(f));
      list.append(r);
    }
    openDialog({ title, body: wrap, width: 980, cls: "of-gitdialog", buttons: [{ label: "Close", onClick: (c) => c() }] });
    if (files.length) show(current);
    else view.append(h("div.of-empty", "No changed files."));
  }

  function workingDiff(path, kind) {
    diffDialog({ title: `${basename(path)} — ${kind === "staged" ? "staged changes" : "changes"}`, files: [{ path, status: "M" }], load: () => svc.diffFor(path, kind) });
  }

  async function commitDetails(c) {
    const info = await run(() => svc.commitInfo(c.oid));
    if (!info) return;
    const files = info.changes;
    const header = h("div.of-gitcommit", h("div.of-gitcommit__msg", info.message), h("div.of-gitcommit__meta", `${c.short} · ${info.author.name} <${info.author.email}> · ${new Date(info.author.ts * 1000).toLocaleString("en-US")}${info.parents.length > 1 ? " · merge" : ""}`));
    const actions = h("div.of-gitcommit__actions");
    const mk = (label, fn) => {
      const b = h("sl-button", { size: "small" }, label);
      b.addEventListener("click", fn);
      actions.append(b);
    };
    mk("Check out (detached)", () => run(() => svc.checkout(c.oid), `Checked out ${c.short}.`));
    mk("New branch here…", async () => {
      const name = await promptDialog({ title: "New branch", label: `Branch name (starting at ${c.short})`, ok: "Create" });
      if (name) run(async () => (await svc.createBranch(name.trim(), { checkout: false }), (await svc.checkout(name.trim()))), `Switched to ${name}.`);
    });
    mk("Tag…", async () => {
      const name = await promptDialog({ title: "New tag", label: `Tag name for ${c.short}`, ok: "Tag" });
      if (name) run(() => svc.createTag(name.trim(), "", c.oid), `Tagged ${name}.`);
    });
    diffDialog({
      title: `Commit ${c.short}`,
      files,
      header: h("div.of-gitcommit__host", header, actions),
      load: (f) => svc.diffFor(f.path, { commit: c.oid }),
      extra: (f) => {
        const restore = h("sl-button", { size: "small" }, "Restore this file");
        restore.addEventListener("click", () => run(() => svc.restoreFile(f.path, f.status === "D" ? `${c.oid}~1` : c.oid), `Restored ${f.path} from ${c.short}.`));
        const cmp = h("sl-button", { size: "small" }, "Compare with working copy");
        cmp.addEventListener("click", () => diffDialog({ title: `${f.path} — ${c.short} vs working copy`, files: [{ path: f.path, status: "M" }], load: () => svc.diffFor(f.path, { compare: c.oid }) }));
        return f.status === "D" ? [restore] : [restore, cmp];
      },
    });
  }

  // ------------------------------------------------------------------ sections

  const section = (id, title, content, { count, actions } = {}) => {
    const isOpen = open.has(id);
    const hd = h("div.of-git__sechead", h("button.of-git__toggle", { type: "button", "aria-expanded": String(isOpen) }, h("sl-icon", { name: isOpen ? "chevron-down" : "chevron-right" }), h("span", title), count != null ? h("span.of-git__count", String(count)) : null), actions ? h("div.of-side__actions", ...actions) : null);
    hd.querySelector("button").addEventListener("click", () => {
      isOpen ? open.delete(id) : open.add(id);
      render();
    });
    return h("section.of-git__sec", hd, isOpen ? content : null);
  };

  function changeRow(c, kind) {
    const code = kind === "staged" ? c.staged : c.conflict ? "!" : c.unstaged;
    const row = h("div.of-git__row", { tabindex: "0", title: c.path, "data-path": c.path });
    const acts = h("div.of-git__rowacts");
    const add = (icon, label, fn) => acts.append(iconButton({ icon, label, onClick: (e) => (e?.stopPropagation?.(), fn()) }));
    if (kind === "staged") add("dash-lg", "Unstage", () => run(() => svc.unstage([c.path])));
    else {
      if (c.unstaged !== "U") add("arrow-counterclockwise", c.unstaged === "D" ? "Restore deleted file" : "Discard changes", () => discard([c.path]));
      else add("trash3", "Delete untracked file", () => discard([c.path]));
      add("plus-lg", "Stage", () => run(() => svc.stage([c.path])));
    }
    row.append(h("span.of-git__badge", { "data-k": code, title: code === "!" ? "Merge conflict" : undefined }, code), h("span.of-git__name", basename(c.path), h("span.of-git__dir", dirname(c.path))), acts);
    row.addEventListener("click", () => (c.unstaged === "U" && kind !== "staged" ? ws.openFile(c.path) : c.unstaged === "D" && kind !== "staged" ? workingDiff(c.path, "unstaged") : workingDiff(c.path, kind)));
    row.addEventListener("keydown", (e) => e.key === "Enter" && row.click());
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(app, e.clientX, e.clientY, [
        { label: "Open file", icon: "file-earmark", run: () => ws.openFile(c.path), disabled: !web.has(c.path) },
        { label: "Show changes", icon: "file-earmark-text", run: () => workingDiff(c.path, kind) },
        "-",
        kind === "staged" ? { label: "Unstage", run: () => run(() => svc.unstage([c.path])) } : { label: "Stage", run: () => run(() => svc.stage([c.path])) },
        { label: "Add to .gitignore", icon: "eye-slash", run: () => run(() => svc.ignore(c.path), `Added ${c.path} to .gitignore.`) },
        { label: "Restore from a commit…", icon: "clock-history", run: () => pickCommitFor(c.path) },
      ]);
    });
    return row;
  }

  async function discard(paths) {
    const ok = await confirmDialog({ title: "Discard changes", message: paths.length === 1 ? `Discard the changes to “${paths[0]}”? Untracked files are deleted. This cannot be undone.` : `Discard changes to ${paths.length} files? Untracked files are deleted. This cannot be undone.`, ok: "Discard", danger: true });
    if (ok) run(() => svc.discard(paths));
  }

  async function pickCommitFor(path) {
    const list = await run(() => svc.log({ path, limit: 30 }));
    if (!list?.length) return app.toast("No commit has changed this file yet.", "primary", 2400);
    const rows = list.map((c) => {
      const b = h("button.of-git__pick", { type: "button" }, h("strong", c.short), h("span", c.subject), h("em", ago(c.ts)));
      b.addEventListener("click", async () => {
        close();
        if (await confirmDialog({ title: "Restore file", message: `Replace “${path}” in your working copy with the version from ${c.short}?`, ok: "Restore" })) run(() => svc.restoreFile(path, c.oid), `Restored ${path} from ${c.short}.`);
      });
      return b;
    });
    const { close } = openDialog({ title: `Restore ${basename(path)} from…`, body: h("div.of-git__picklist", ...rows), width: 480, buttons: [{ label: "Cancel", onClick: (c) => c() }] });
  }

  function changesSection(st) {
    const staged = st.changes.filter((c) => c.staged);
    const conflicts = st.changes.filter((c) => c.conflict);
    const unstaged = st.changes.filter((c) => c.unstaged && !c.conflict);
    const wrap = h("div");
    if (st.merging) {
      wrap.append(h("div.of-git__notice", h("strong", conflicts.length ? "Merge in progress — resolve the conflicts" : "Merge in progress"), h("div", conflicts.length ? "Edit the marked files, then stage them and commit." : "Commit to finish the merge."), (() => {
        const b = h("sl-button", { size: "small" }, "Abort merge");
        b.addEventListener("click", async () => (await confirmDialog({ title: "Abort merge", message: "Discard the merge and restore your files to the last commit?", ok: "Abort merge", danger: true })) && run(() => svc.abortMerge()));
        return b;
      })()));
    }
    const group = (title, rows, kind, acts) => (rows.length ? h("div.of-git__group", h("div.of-git__grouphead", h("span", `${title} (${rows.length})`), h("div.of-side__actions", ...acts)), ...rows.map((c) => changeRow(c, kind))) : null);
    wrap.append(
      group("Merge conflicts", conflicts, "unstaged", []) ?? "",
      group("Staged changes", staged, "staged", [iconButton({ icon: "dash-lg", label: "Unstage all", onClick: () => run(() => svc.unstage("all")) })]) ?? "",
      group("Unstaged", unstaged, "unstaged", [iconButton({ icon: "arrow-counterclockwise", label: "Discard all changes", onClick: () => discard(unstaged.map((c) => c.path)) }), iconButton({ icon: "plus-square", label: "Stage all", onClick: () => run(() => svc.stage(unstaged.map((c) => c.path))) })]) ?? "",
    );
    if (!st.changes.length) wrap.append(h("div.of-empty", "No changes. Edit a file and it appears here."));
    return wrap;
  }

  function commitBox(st) {
    const staged = st.changes.filter((c) => c.staged).length;
    const btn = h("sl-button", { variant: "primary", size: "small", class: "of-git__commit" }, st.merging ? "Commit merge" : staged ? `Commit (${staged})` : "Commit");
    const go = async () => {
      let all = false;
      if (!staged && !st.merging) {
        if (!st.changes.length) return app.toast("There is nothing to commit.", "primary", 2000);
        if (!(await confirmDialog({ title: "Nothing is staged", message: "Stage all changes and commit them?", ok: "Stage all and commit" }))) return;
        all = true;
      }
      const m = msg.value.trim() || (st.merging ? (st.merging.message || "").split("\n")[0] : "");
      if (!m) return app.toast("Enter a commit message.", "warning", 2200), msg.focus();
      const oid = await run(() => svc.commit(m, { all }));
      if (oid) {
        msg.value = "";
        app.toast(`Committed ${oid.slice(0, 7)}.`, "success", 2200);
      }
    };
    btn.addEventListener("click", go);
    msg.onkeydown = (e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), go());
    const sugg = iconButton({ icon: "stars", label: "Suggest a message from the changes", onClick: () => (msg.value = suggest(st)) });
    return h("div.of-git__commitbox", msg, h("div.of-git__commitrow", btn, app.prefs.aiEnabled ? sugg : null));
  }
  function suggest(st) {
    const rows = st.changes.slice(0, 4).map((c) => basename(c.path));
    const verb = st.changes.every((c) => (c.staged || c.unstaged) === "A" || c.unstaged === "U") ? "Add" : st.changes.every((c) => (c.staged || c.unstaged) === "D") ? "Remove" : "Update";
    return `${verb} ${rows.join(", ")}${st.changes.length > 4 ? ` and ${st.changes.length - 4} more` : ""}`;
  }

  // ------------------------------------------------------------------ history

  async function loadHistory() {
    try {
      history = await svc.log({ limit: 120, search: historySearch });
    } catch {
      history = [];
    }
    renderHistory();
  }
  const historyHost = h("div.of-git__history");
  function renderHistory() {
    empty(historyHost);
    if (!history.length) return void historyHost.append(h("div.of-empty", historySearch ? "No commits match." : "No commits yet."));
    const lanes = historySearch ? null : graphLanes(history);
    history.forEach((c, i) => {
      const row = h("div.of-git__commit", { tabindex: "0", role: "button", title: `${c.message}\n${c.author} · ${c.short}` }, lanes ? h("span.of-git__graph", graphSvg(lanes[i], c)) : null, h("span.of-git__csub", c.subject, ...c.refs.map((r) => h("span.of-git__ref", { "data-k": r.kind }, r.name))), h("span.of-git__cmeta", `${c.author} · ${ago(c.ts)}`));
      row.addEventListener("click", () => commitDetails(c));
      row.addEventListener("keydown", (e) => e.key === "Enter" && row.click());
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(app, e.clientX, e.clientY, [
          { label: "Show changes", icon: "file-earmark-text", run: () => commitDetails(c) },
          { label: "Check out (detached)", run: () => run(() => svc.checkout(c.oid), `Checked out ${c.short}.`) },
          { label: "Copy commit id", icon: "clipboard", run: () => navigator.clipboard?.writeText(c.oid) },
        ]);
      });
      historyHost.append(row);
    });
  }
  const search = h("input.of-git__search", { type: "search", placeholder: "Search commits", "aria-label": "Search commits" });
  let st$ = 0;
  search.addEventListener("input", () => {
    clearTimeout(st$);
    st$ = setTimeout(() => ((historySearch = search.value.trim()), loadHistory()), 250);
  });

  // ------------------------------------------------------------------ branches, tags, remote

  async function branchesSection(st) {
    const b = await svc.branches();
    const wrap = h("div");
    for (const br of b.local) {
      const r = h("div.of-git__row", { tabindex: "0" }, h("sl-icon", { name: br.current ? "check2" : "signpost-split" }), h("span.of-git__name", br.name), h("span.of-git__cmeta", br.oid.slice(0, 7)));
      r.addEventListener("dblclick", () => !br.current && run(() => svc.checkout(br.name), `Switched to ${br.name}.`));
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(app, e.clientX, e.clientY, [
          { label: "Switch to this branch", disabled: br.current, run: () => run(() => svc.checkout(br.name), `Switched to ${br.name}.`) },
          { label: `Merge into ${b.current || "current"}`, disabled: br.current, run: () => mergeBranch(br.name) },
          { label: "Delete branch", disabled: br.current, icon: "trash3", run: () => deleteBranch(br.name) },
        ]);
      });
      wrap.append(r);
    }
    for (const br of b.remote) wrap.append(h("div.of-git__row.dim", h("sl-icon", { name: "cloud" }), h("span.of-git__name", br.name), h("span.of-git__cmeta", br.oid.slice(0, 7))));
    if (!b.local.length) wrap.append(h("div.of-empty", "Branches appear after the first commit."));
    wrap.append(h("div.of-git__hint", "Double-click to switch. Right-click to merge or delete."));
    return wrap;
  }
  async function mergeBranch(name) {
    const res = await run(() => svc.merge(name));
    if (!res) return;
    if (res.result === "conflict") app.toast(`Merge stopped: ${res.conflicts.length} file${res.conflicts.length === 1 ? " has" : "s have"} conflicts. Edit them, stage and commit.`, "warning", 7000);
    else app.toast({ "up-to-date": "Already up to date.", "fast-forward": `Fast-forwarded to ${name}.`, merged: `Merged ${name}.` }[res.result], "success", 2600);
  }
  async function deleteBranch(name) {
    if (!(await confirmDialog({ title: "Delete branch", message: `Delete the branch “${name}”? Its commits stay reachable only if another branch contains them.`, ok: "Delete", danger: true }))) return;
    try {
      await svc.deleteBranch(name);
    } catch (err) {
      if (err.code === "UNMERGED" && (await confirmDialog({ title: "Unmerged commits", message: `“${name}” has commits that are not merged. Delete it anyway?`, ok: "Delete anyway", danger: true }))) run(() => svc.deleteBranch(name, { force: true }));
      else if (err.code !== "UNMERGED") app.toast(err.message, "warning", 4500);
    }
  }
  async function newBranch() {
    const name = await promptDialog({ title: "New branch", label: "Branch name", ok: "Create and switch" });
    if (name) run(() => svc.createBranch(name.trim()), `Switched to a new branch “${name.trim()}”.`);
  }
  async function tagsSection() {
    const tags = await svc.tags();
    const wrap = h("div");
    for (const t of tags) {
      const r = h("div.of-git__row", h("sl-icon", { name: "tag" }), h("span.of-git__name", t.name, t.annotated ? h("span.of-git__dir", t.message.split("\n")[0]) : null), h("span.of-git__cmeta", t.target.slice(0, 7)));
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(app, e.clientX, e.clientY, [{ label: "Check out", run: () => run(() => svc.checkout(t.name), `Checked out ${t.name}.`) }, { label: "Delete tag", icon: "trash3", run: () => run(() => svc.deleteTag(t.name)) }]);
      });
      wrap.append(r);
    }
    if (!tags.length) wrap.append(h("div.of-empty", "No tags. Tag a commit from the history."));
    return wrap;
  }

  async function remoteSection(st) {
    const remotes = await svc.remotes();
    const r = remotes[0];
    const wrap = h("div");
    if (!r) {
      wrap.append(h("div.of-git__hint", "Connect a GitHub repository (personal access token) or any HTTPS Git server through a CORS proxy."));
    } else {
      const up = st.upstream;
      wrap.append(h("div.of-git__remote", h("code", r.url), h("div.of-git__hint", up ? `${up.ahead} ahead · ${up.behind} behind origin/${st.branch}` : "Not pushed yet.")));
    }
    const bar = h("div.of-git__remotebar");
    const mk = (label, icon, fn, primary) => {
      const b = h("sl-button", { size: "small", variant: primary ? "primary" : "default" }, h("sl-icon", { slot: "prefix", name: icon }), label);
      b.addEventListener("click", fn);
      bar.append(b);
    };
    mk(r ? "Settings" : "Connect remote…", "gear", () => import("./git-remote.js").then((m) => m.openRemoteDialog(ws, svc)));
    if (r) {
      mk("Pull", "download", () => import("./git-remote.js").then((m) => m.syncAction(ws, svc, "pull")));
      mk("Push", "upload", () => import("./git-remote.js").then((m) => m.syncAction(ws, svc, "push")), true);
    }
    wrap.append(bar);
    return wrap;
  }

  // ------------------------------------------------------------------ main render

  function moreMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    showContextMenu(app, r.left, r.bottom + 4, [
      { label: "New branch…", icon: "signpost-split", run: newBranch },
      { label: "Switch branch…", icon: "signpost-split", run: switchMenu },
      { label: "Merge a branch…", icon: "signpost-split", run: mergeMenu },
      { label: "New tag…", icon: "tag", run: async () => { const n = await promptDialog({ title: "New tag", label: "Tag name (at the current commit)", ok: "Tag" }); if (n) run(() => svc.createTag(n.trim()), `Tagged ${n.trim()}.`); } },
      "-",
      { label: "Export project as ZIP with .git…", icon: "download", run: exportZip },
      { label: "Open a repository ZIP as a new project…", icon: "folder-symlink", run: () => importRepoZipDialog(ws) },
    ]);
  }
  async function branchPick(title, action) {
    const b = await svc.branches();
    const rows = b.local.filter((x) => !x.current).map((x) => {
      const btn = h("button.of-git__pick", { type: "button" }, h("strong", x.name), h("em", x.oid.slice(0, 7)));
      btn.addEventListener("click", () => (close(), action(x.name)));
      return btn;
    });
    if (!rows.length) return app.toast("There is no other branch yet.", "primary", 2200);
    const { close } = openDialog({ title, body: h("div.of-git__picklist", ...rows), width: 380, buttons: [{ label: "Cancel", onClick: (c) => c() }] });
  }
  const switchMenu = () => branchPick("Switch to branch", (n) => run(() => svc.checkout(n), `Switched to ${n}.`));
  const mergeMenu = () => branchPick("Merge into the current branch", mergeBranch);
  async function exportZip() {
    const bytes = await run(() => svc.exportZip());
    if (!bytes) return;
    const { platform } = await import("../../platform/index.js");
    const r = await platform.saveFile({ suggestedName: `${(app.doc.name || "website").replace(/[\\/:*?"<>|]+/g, "_")}-repo.zip`, bytes, mime: "application/zip", filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
    if (r) app.toast(`Exported ${r.name} with a real .git folder.`, "success", 3000);
  }

  let rendering = 0;
  async function render() {
    const ticket = ++rendering;
    empty(head);
    head.append(h("span.of-side__title", "Source Control"));
    if (!svc.exists) {
      empty(body);
      const init = h("sl-button", { variant: "primary", size: "small" }, "Initialize repository");
      init.addEventListener("click", () => run(() => svc.init(), "Repository created. Stage your files and make the first commit."));
      const clone = h("sl-button", { size: "small" }, "Clone from GitHub…");
      clone.addEventListener("click", () => openCloneDialog(ws));
      const imp = h("sl-button", { size: "small" }, "Open a repository ZIP…");
      imp.addEventListener("click", () => importRepoZipDialog(ws));
      body.append(h("div.of-git__start", h("sl-icon", { name: "signpost-split" }), h("p", "Track changes to your website with Git: commits, branches, merging and history — stored inside this document."), init, h("p.of-git__hint", "The history travels with the .ofini file and can be exported as a real repository (ZIP with a .git folder)."), clone, imp));
      return;
    }
    const st = svc.status || (await svc.refresh());
    if (ticket !== rendering || !st) return;
    const cur = st.branch || (st.head ? `${st.head.slice(0, 7)} (detached)` : "no commits yet");
    const brBtn = h("button.of-git__branch", { type: "button", title: "Branches and more" }, h("sl-icon", { name: "signpost-split" }), cur, st.upstream ? h("span.of-git__sync", `${st.upstream.ahead}↑ ${st.upstream.behind}↓`) : null);
    brBtn.addEventListener("click", () => moreMenu(brBtn));
    head.append(h("div.of-side__actions", iconButton({ icon: "arrow-clockwise", label: "Refresh", onClick: () => (svc.refresh(), loadHistory()) })));
    const [branches, tags, remote] = await Promise.all([branchesSection(st), tagsSection(), remoteSection(st)]);
    if (ticket !== rendering) return;
    const newSig = `${st.head}|${svc.repo.branches().map((b) => b.name + b.oid).join()}|${svc.repo.tags().length}`;
    if (newSig !== sig) {
      sig = newSig;
      loadHistory();
    }
    empty(body);
    body.append(
      brBtn,
      commitBox(st),
      section("changes", "Changes", changesSection(st), { count: st.changes.length }),
      section("history", "History", h("div", search, historyHost), { actions: [iconButton({ icon: "download", label: "Export ZIP with .git", onClick: exportZip })] }),
      section("branches", "Branches", branches, { actions: [iconButton({ icon: "plus-lg", label: "New branch", onClick: newBranch })] }),
      section("tags", "Tags", tags),
      section("remote", "Remote", remote),
    );
    if (!historyHost.children.length) renderHistory();
  }

  svc.on("change", () => el.isConnected && render());
  ws.git.panel = { render, loadHistory };
  render();
}
