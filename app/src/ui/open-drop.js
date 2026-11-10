// Smarter opening of dropped files (loaded on the first drop, see installDropToOpen in open-folder.js):
//   * a .zip is unpacked safely (engine/web/open-plan.js projectFromZip) and opens like a folder: a website becomes a
//     Code studio project, design files open as documents;
//   * an HTML page dropped together with the files it loads (CSS, scripts, images) offers to open them together as one
//     website project, each file placed where the page expects it;
//   * an HTML page dropped alone that loads local files offers to open its folder instead.
// Everything else opens as before (app.openFile per file).
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { openDialog } from "./dialogs.js";
import { planHtmlDrop, projectFromZip } from "../engine/web/open-plan.js";
import { openFolderEntries, openFolderDialog } from "./open-folder.js";

const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const short = (list, n = 4) => list.slice(0, n).join(", ") + (list.length > n ? t(" and {n} more", { n: list.length - n }) : "");

/** Opens a .zip as a project (or its documents). Never throws: problems become toasts. */
export async function openZip(app, file) {
  const name = (file.name || "archive.zip").replace(/\.zip$/i, "");
  if ((file.size ?? file.bytes?.length ?? 0) > MAX_ZIP_BYTES) return app.toast(t("“{name}” is larger than {mb} MB.", { name: file.name, mb: MAX_ZIP_BYTES / 1048576 }), "danger", 6000);
  app.status(t("Unpacking {name}…", { name: file.name }));
  try {
    const bytes = file.bytes || new Uint8Array(await file.arrayBuffer());
    const { files, problems, name: root } = projectFromZip(bytes);
    if (problems.length) app.toast(t("“{name}”: {problems}", { name: file.name, problems: problems.slice(0, 3).join(" ") }), "warning", 8000);
    if (!files.length) return app.toast(t("“{name}” has no files OpenFini can use.", { name: file.name }), "warning", 6000);
    const entries = files.map((f) => ({ path: f.path, file: new File([f.bytes], f.path.split("/").pop()) }));
    await openFolderEntries(app, entries, root || name);
  } catch (err) {
    app.toast(err?.message || t("Could not open “{name}”.", { name: file.name }), "danger", 6000);
  } finally {
    app.status("");
  }
}

function ask({ title, message, details, ok, cancel }) {
  return new Promise((resolve) => {
    let answer = false;
    const body = h("div.of-dialog__text", h("p", message), details ? h("p.of-hint", details) : null);
    openDialog({
      title,
      body,
      width: 520,
      onClose: () => resolve(answer),
      buttons: [
        { label: cancel, onClick: (c) => c() },
        { label: ok, variant: "primary", onClick: (c) => ((answer = true), c()) },
      ],
    });
  });
}

/**
 * Handles a drop of files (not folders). Returns true when it opened them, false to let the caller open each file.
 * @param {import("../core/app.js").App} app
 * @param {{ path: string, file: File }[]} list
 */
export async function openDroppedFiles(app, list) {
  const zips = list.filter((e) => /\.zip$/i.test(e.path));
  const rest = list.filter((e) => !zips.includes(e));
  for (const z of zips) await openZip(app, z.file);
  if (!rest.length) return true;
  const pages = rest.filter((e) => /\.html?$/i.test(e.path));
  if (pages.length) {
    const texts = {};
    for (const p of pages) if (p.file.size < 5 * 1048576) texts[p.path] = await p.file.text();
    const plan = planHtmlDrop(rest.map((e) => ({ path: e.path, size: e.file.size })), texts);
    if (plan && plan.matched.length) {
      const together = await ask({
        title: t("Open as a website?"),
        message: t("{page} uses {n, plural, one {# of the files} other {# of the files}} you dropped ({files}). Open them together as one website project, so the page shows with its styles, scripts and images?", { page: plan.page, n: plan.matched.length, files: short(plan.matched.map((m) => m.path.split("/").pop())) }),
        details: plan.missing.length ? t("Not dropped: {files}. Drop the whole folder (or a .zip) to include them.", { files: short(plan.missing) }) : "",
        ok: t("Open together"),
        cancel: t("Open separately"),
      });
      if (together) {
        const byPath = new Map(rest.map((e) => [e.path, e]));
        const entries = [{ path: plan.page.split("/").pop(), file: byPath.get(plan.page).file }];
        const placed = new Set([plan.page]);
        for (const m of plan.matched) {
          entries.push({ path: m.target, file: byPath.get(m.path).file });
          placed.add(m.path);
        }
        // the other dropped files keep their names at the project root
        for (const e of rest) if (!placed.has(e.path) && !entries.some((x) => x.path === e.path)) entries.push({ path: e.path.split("/").pop(), file: e.file });
        await openFolderEntries(app, entries, plan.page.split("/").pop().replace(/\.html?$/i, ""));
        return true;
      }
    } else if (plan && plan.missing.length && rest.length === 1) {
      const folder = await ask({
        title: t("Open the page's folder?"),
        message: t("{page} loads local files that were not dropped ({files}). Opened alone it shows without them. Open its folder to get the whole website?", { page: plan.page, files: short(plan.missing) }),
        ok: t("Choose folder…"),
        cancel: t("Open page only"),
      });
      if (folder) {
        await openFolderDialog(app);
        return true;
      }
    }
  }
  for (const { file } of rest) {
    try {
      await app.openFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type });
    } catch (err) {
      app.toast(err.message, "danger", 6000);
    }
  }
  return true;
}
