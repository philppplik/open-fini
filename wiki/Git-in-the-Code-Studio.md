# Git in the Code Studio

The Source Control pane gives a website project real Git: commits, branches, merging, tags, a history graph, diffs and restore from any commit. The repository is a genuine Git object database stored inside the `.ofini` file, so history travels with the document. It is lazy: nothing loads until you open the pane, and no network request happens without an explicit confirmation.

## Using the pane

Open *Source Control* (branch icon in the activity bar) and choose **Initialize repository**. The pane then shows changes, staging, a commit box, history with a graph and search, branches, tags and the remote. The Explorer shows `A`, `M`, `D` and `U` badges; the editor gutter marks added lines (green bar), modified lines (blue bar) and removed lines (red notch).

| Task | How |
| --- | --- |
| Stage, unstage, discard | Row and section buttons, right-click. Discard asks for confirmation; untracked files are deleted |
| Commit | Message box, `Ctrl+Enter`; with nothing staged you can stage all and commit. Author name and email are in *Settings ▸ Code studio ▸ Source control* |
| History | Graph and list; search by message, author or id; per-file diffs (unified or side by side); restore a file, compare with the working copy, check out (detached), new branch here, tag |
| Branches | Create (and switch), switch (double-click), delete (refuses unmerged unless confirmed), merge |
| Merge | Fast-forward or three-way. Overlapping edits become conflict markers in the file; resolve, stage, commit. *Abort merge* restores the last commit. Binary conflicts keep your version |
| Tags | Lightweight or annotated |
| `.gitignore` | Honored (patterns, negation, `**`, nested files) |
| Export | *Export ZIP with .git*: project files plus a real `.git` folder; `git log`, `git fsck` and `git status` work on the extracted folder |
| Import | *Open a repository ZIP…* turns a ZIP with a `.git` folder (loose objects or packfiles) into a project with its history |

Not included: stash, rebase, cherry-pick, submodules, line-ending conversion, signed commits, rename detection (a rename shows as delete plus add).

## Remotes

A browser or web view cannot talk to most Git hosts directly (no CORS headers), and the app has no native network plugin. So:

1. **GitHub through its REST API** works from the browser. Use a fine-grained personal access token with *Contents: read and write*. Push uploads blobs, trees and commits and moves the branch (fast-forward only); Pull reads new commits and merges locally; Clone from GitHub creates a project from the tree and the last 100 commits. The remote repository must already have a commit. GitHub re-serializes commits, so ids may differ from local ones.
2. **Any other HTTPS Git server** (GitLab, Gitea, your own) uses the standard smart-HTTP protocol, but from a web page only through a **CORS proxy you configure** (*Remote settings ▸ CORS proxy*). The proxy can read your token and code; use one you run or trust.
3. A native Git command in the desktop shell is **not** available.

The token is stored privately and sent only to `api.github.com` or your configured proxy or server. Push and Pull always show a confirmation naming the destination.

## How it is stored

Entries `web/git/<path under .git>` in the ZIP: `HEAD`, `config`, `refs/…`, a version-2 `index`, and one loose zlib-compressed object per blob, tree and commit. Object ids are real Git ids. Older OpenFini versions ignore these entries. The engine (`app/src/engine/git/`) is pure, about 1,500 lines, and tested against real Git.

## Vibe

`git_init`, `git_status`, `git_diff`, `git_log` (read-only), `git_commit`, `git_branch`, `git_checkout`, `git_restore`, `git_push`, `git_pull`. Pushes and pulls always ask. "Commit this with a good message" runs status, diff and commit ([[Vibe Tools Reference]]).

## See also

- [[Code Studio]]
- [[Export and Publish]]
- [[Security and Privacy]]
- [[Git Workflow and Releases]]
