// Extension manifest localization (pure; tests in tests/i18n/extensions-i18n.test.js).
//
// A manifest may use "%key%" placeholders in any string value below `name`, `description` and `contributes`.
// They are resolved from the package's optional `locales/<code>.json` ({ "key": "Text" }). Lookup order: exact tag
// ("de-DE"), base language ("de"), then `locales/en.json`, then the key itself ("%key%" stays readable as "key").
// Only a string that is exactly "%key%" is replaced. Strings without placeholders are untouched,
// so existing manifests behave exactly as before.
// Public API: localeCandidates(tag), loadMessages(files, tag), resolveManifestStrings(raw, messages), localizeManifest(raw, files, tag).

const dec = new TextDecoder();
const PLACEHOLDER = /^%([A-Za-z0-9_.\-]+)%$/;

/** ["de-DE", "de", "en"] for "de-DE". */
export function localeCandidates(tag) {
  const norm = String(tag || "en").replace(/_/g, "-");
  const base = norm.split("-")[0];
  return [...new Set([norm, base, "en"])];
}

/** Merges locales/<candidate>.json files (most specific wins). Invalid JSON files are ignored. */
export function loadMessages(files, tag) {
  const out = {};
  for (const code of localeCandidates(tag).reverse()) {
    const bytes = files?.[`locales/${code}.json`];
    if (!bytes) continue;
    try {
      const obj = JSON.parse(typeof bytes === "string" ? bytes : dec.decode(bytes));
      if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) if (typeof v === "string") out[k] = v;
    } catch {
      /* ignore a broken catalog; the keys stay visible */
    }
  }
  return out;
}

const LOCALIZED_TOP = ["name", "description"];

function walk(value, messages) {
  if (typeof value === "string") {
    const m = PLACEHOLDER.exec(value);
    if (m) return messages[m[1]] ?? m[1];
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, messages));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, messages);
    return out;
  }
  return value;
}

/** Returns a copy of `raw` with %key% placeholders resolved in name, description and contributes. */
export function resolveManifestStrings(raw, messages) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  for (const k of LOCALIZED_TOP) if (k in out) out[k] = walk(out[k], messages);
  if ("contributes" in out) out.contributes = walk(out.contributes, messages);
  return out;
}

/** Convenience: load messages for `tag` from the package files and resolve. Returns `raw` itself when nothing to do. */
export function localizeManifest(raw, files, tag) {
  const text = JSON.stringify(raw?.contributes ?? "") + (raw?.name ?? "") + (raw?.description ?? "");
  if (!text.includes("%")) return raw;
  return resolveManifestStrings(raw, loadMessages(files, tag));
}
