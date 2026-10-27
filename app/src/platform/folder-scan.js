// Reads a project folder from disk (desktop shell) into memory, with limits. Pure: the file system is injected, so the
// walk, the ignore rules and the caps are unit tested without Tauri (tests/packaging/folder-scan.test.js).
//
// Public API
//   scanFolder(io, root, options?) -> Promise<{ name, files: {path, bytes}[], stats }>
//     io = { readDir(path) -> [{ name, isDirectory, isFile, isSymlink }], stat(path) -> { size }, readFile(path) -> Uint8Array }
//     options = { maxFiles, maxFileBytes, maxTotalBytes, maxDepth, onProgress({ files, bytes, path }), signal }
//     `files[].path` is relative to the folder's PARENT and starts with the folder name, joined with "/", which is the
//     shape File > Open Folder produces (ui/open-folder.js openFolderEntries).
//     stats = { ignored, tooLarge, unreadable, truncated, totalBytes }
//   IGNORED_DIRS / isIgnoredDir(name)
//
// Invariants: symbolic links are never followed; dot files and dot folders are skipped (openFolderEntries drops them
// anyway); the walk is sorted for a stable order; it stops (truncated = true) at the first cap instead of throwing.

export const IGNORED_DIRS = new Set(["node_modules", "bower_components", "dist", "build", "target", "coverage", "__pycache__", "venv", "$RECYCLE.BIN", "System Volume Information"]);

export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 3000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxDepth: 16,
});

export const isIgnoredDir = (name) => name.startsWith(".") || IGNORED_DIRS.has(name);

/** @returns {Promise<{ name: string, files: { path: string, bytes: Uint8Array }[], stats: { ignored: number, tooLarge: number, unreadable: number, truncated: boolean, totalBytes: number } }>} */
export async function scanFolder(io, root, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const join = (a, b) => (/[\\/]$/.test(a) ? a + b : a + sep + b);
  const name = root.split(/[\\/]+/).filter(Boolean).pop() || "Folder";
  const files = [];
  const stats = { ignored: 0, tooLarge: 0, unreadable: 0, truncated: false, totalBytes: 0 };

  async function walk(dir, rel, depth) {
    let entries;
    try {
      entries = await io.readDir(dir);
    } catch {
      stats.unreadable++;
      return;
    }
    entries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (stats.truncated || options.signal?.aborted) return;
      if (entry.isSymlink) continue;
      if (entry.isDirectory) {
        if (isIgnoredDir(entry.name) || depth >= limits.maxDepth) {
          stats.ignored++;
          continue;
        }
        await walk(join(dir, entry.name), `${rel}/${entry.name}`, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;
      if (entry.name.startsWith(".")) {
        stats.ignored++;
        continue;
      }
      if (files.length >= limits.maxFiles) {
        stats.truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      try {
        const { size } = await io.stat(full);
        if (size > limits.maxFileBytes) {
          stats.tooLarge++;
          continue;
        }
        if (stats.totalBytes + size > limits.maxTotalBytes) {
          stats.truncated = true;
          return;
        }
        const bytes = await io.readFile(full);
        stats.totalBytes += bytes.length;
        files.push({ path: `${rel}/${entry.name}`, bytes });
        options.onProgress?.({ files: files.length, bytes: stats.totalBytes, path: `${rel}/${entry.name}` });
      } catch {
        stats.unreadable++;
      }
    }
  }

  await walk(root, name, 0);
  return { name, files, stats };
}
