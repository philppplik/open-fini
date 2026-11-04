// Update prompt decisions (pure; used by ui/update-check.js). The default is: no automatic check at all.
const DAY = 24 * 60 * 60 * 1000;

/** Should the start-up hook contact GitHub? Only when the user switched automatic checks on, once a day, never offline. */
export function shouldAutoCheck({ auto, lastCheck = 0, now = Date.now(), offline = false, safeMode = false, dev = false } = {}) {
  if (!auto || offline || safeMode || dev) return false;
  return now - (lastCheck || 0) >= DAY;
}

/** Should the "Version X is available" dialog open for this release? `skipped` is the version the user chose to skip. */
export function shouldPrompt({ release, current, skipped = "", compare }) {
  if (!release || !current) return false;
  if (release.prerelease) return false;
  if (compare(release.version, current) <= 0) return false;
  return release.version !== skipped;
}

/** Plain-text summary of release notes (Markdown stripped, at most `maxLines` lines, `maxChars` characters). */
export function summarizeNotes(md, { maxLines = 8, maxChars = 600 } = {}) {
  const lines = String(md || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s*/, "").replace(/^\s*[-*+]\s+/, "• ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/<[^>]+>/g, "").trim())
    .filter((l) => l && !/^full changelog/i.test(l));
  let out = lines.slice(0, maxLines).join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars).trimEnd()}…`;
  else if (lines.length > maxLines) out += "\n…";
  return out;
}
