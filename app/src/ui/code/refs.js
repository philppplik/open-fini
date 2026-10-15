// Keeps links working when files are renamed or moved: references in HTML and CSS that point at a moved file are
// rewritten, and so are the relative references inside a moved file.
import { parseHtml, resolveRef, relativeRef } from "../../engine/web/index.js";

const URL_ATTRS = new Set(["href", "src", "poster", "data", "action", "srcset"]);

/** Returns the number of references that were updated. `pairs` = [[oldPath, newPath], …] (already applied to the project). */
export function updateReferences(ws, pairs) {
  const web = ws.web;
  const forward = new Map(pairs);
  const backward = new Map(pairs.map(([a, b]) => [b, a]));
  const mapTarget = (p) => forward.get(p) ?? p;
  let count = 0;

  const fix = (file, value) => {
    const oldFile = backward.get(file) ?? file;
    const ref = resolveRef(oldFile, value);
    if (!ref) return null;
    const suffix = /[?#].*$/.exec(value)?.[0] || "";
    const base = value.replace(/[?#].*$/, "");
    if (!base) return null;
    const oldTarget = ref.path;
    const newTarget = mapTarget(oldTarget);
    if (oldTarget === newTarget && oldFile === file) return null;
    // only rewrite references that still resolve to something that exists
    if (!web.has(newTarget)) return null;
    const next = relativeRef(file, newTarget) + suffix;
    return next === value ? null : next;
  };

  for (const file of web.paths) {
    const text = web.text(file);
    if (text == null) continue;
    const changes = [];
    if (/\.html?$/i.test(file)) {
      const parsed = parseHtml(text);
      for (const el of parsed.elements) {
        for (const a of el.attrs) {
          if (!URL_ATTRS.has(a.name) || a.value == null) continue;
          if (a.name === "srcset") {
            let rebuilt = a.value;
            let any = false;
            for (const part of a.value.split(",")) {
              const url = part.trim().split(/\s+/)[0];
              const nu = url && fix(file, url);
              if (nu) {
                rebuilt = rebuilt.replace(url, nu);
                any = true;
              }
            }
            if (any) changes.push({ from: a.valueStart, to: a.valueEnd, insert: rebuilt });
          } else {
            const nv = fix(file, a.value);
            if (nv) changes.push({ from: a.valueStart, to: a.valueEnd, insert: nv });
          }
        }
      }
    } else if (/\.css$/i.test(file)) {
      const re = /url\(\s*(["']?)([^"')]+)\1\s*\)|@import\s+(["'])([^"']+)\3/gi;
      let m;
      while ((m = re.exec(text))) {
        const value = m[2] ?? m[4];
        const nv = fix(file, value);
        if (!nv) continue;
        const idx = m[0].indexOf(value);
        changes.push({ from: m.index + idx, to: m.index + idx + value.length, insert: nv });
      }
    }
    if (changes.length) {
      ws.editors.applyChanges(file, changes, { userEvent: "input.refs" });
      count += changes.length;
    }
  }
  return count;
}
