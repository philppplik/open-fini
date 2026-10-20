// Profiles: export, strict import validation, preview (diff) and merge/replace. Pure (no DOM).
// A profile (.ofprofile) is JSON: { format: "openfini-profile", version: 1, name, created, app, settings: { key: value } }
// where every key is a portable setting of schema.js. Secrets, API keys, tokens, documents and security switches never appear.
import { SETTINGS, SETTING_KEYS, getSettingDef, validateSetting, FORBIDDEN_KEY } from "./schema.js";

export const PROFILE_FORMAT = "openfini-profile";
export const PROFILE_VERSION = 1;
export const MAX_PROFILE_BYTES = 512 * 1024;
export const PROFILE_EXT = ".ofprofile";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Builds the profile object of the given preferences (only portable keys). */
export function buildProfile(prefs, { name = "My profile", created = new Date().toISOString(), appVersion = "" } = {}) {
  const settings = {};
  for (const k of SETTING_KEYS) if (prefs[k] !== undefined) settings[k] = clone(prefs[k]);
  const p = { format: PROFILE_FORMAT, version: PROFILE_VERSION, name: String(name).slice(0, 60), created, settings };
  if (appVersion) p.app = appVersion;
  return p;
}

export const stringifyProfile = (profile) => JSON.stringify(profile, null, 2);

/**
 * Validates profile text or an already parsed object. Never throws.
 * @returns {{ok:boolean, errors:string[], warnings:string[], profile:null|{name:string, settings:object}}}
 */
export function validateProfile(input) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => ({ ok: false, errors: [msg, ...errors], warnings, profile: null });
  let json = input;
  if (typeof input === "string") {
    if (input.length > MAX_PROFILE_BYTES) return fail("The file is too large to be a profile (limit 512 KB).");
    try {
      json = JSON.parse(input);
    } catch {
      return fail("The file is not valid JSON.");
    }
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return fail("The file does not contain a profile.");
  if (json.format !== PROFILE_FORMAT) return fail(`This is not an OpenFini profile (expected format “${PROFILE_FORMAT}”).`);
  if (!Number.isInteger(json.version) || json.version < 1) return fail("The profile has no valid version.");
  if (json.version > PROFILE_VERSION) return fail(`This profile was made by a newer OpenFini (profile version ${json.version}). Update OpenFini to import it.`);
  const name = typeof json.name === "string" ? json.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) : "";
  if (json.name !== undefined && typeof json.name !== "string") errors.push("name must be text.");
  const s = json.settings;
  if (s === null || typeof s !== "object" || Array.isArray(s)) return fail("The profile has no settings object.");
  for (const k of Object.keys(json)) if (!["format", "version", "name", "created", "app", "settings"].includes(k)) warnings.push(`Unknown field “${k.slice(0, 30)}” ignored.`);
  const settings = {};
  for (const k of Object.keys(s)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      errors.push(`Forbidden key “${k}”.`);
      continue;
    }
    if (!getSettingDef(k)) {
      if (FORBIDDEN_KEY.test(k)) errors.push(`“${k.slice(0, 40)}” looks like a secret or a protected setting. Profiles never carry those.`);
      else warnings.push(`Unknown setting “${k.slice(0, 40)}” ignored.`);
      continue;
    }
    const r = validateSetting(k, s[k]);
    if (!r.ok) errors.push(r.error);
    else settings[k] = clone(s[k]);
  }
  if (errors.length) return { ok: false, errors, warnings, profile: null };
  return { ok: true, errors, warnings, profile: { name: name || "Imported profile", settings } };
}

/**
 * The preference changes a profile would make.
 * mode "merge": only the settings in the profile. mode "replace": every portable setting; those the profile omits go back to their default.
 * @returns {{key:string, label:string, section:string, from:any, to:any}[]} only entries that actually change
 */
export function diffProfile(prefs, defaults, profile, mode = "merge") {
  const out = [];
  for (const def of SETTINGS) {
    const k = def.key;
    let to;
    if (Object.prototype.hasOwnProperty.call(profile.settings, k)) to = profile.settings[k];
    else if (mode === "replace") to = defaults[k];
    else continue;
    const from = prefs[k] === undefined ? defaults[k] : prefs[k];
    if (to !== undefined && !same(from, to)) out.push({ key: k, label: def.label, section: def.section, from: clone(from), to: clone(to) });
  }
  return out;
}

/** The pref patch ({key: value}) of a diff. */
export function patchFromDiff(diff) {
  const patch = {};
  for (const d of diff) patch[d.key] = clone(d.to);
  return patch;
}

/** One-line description of a value for the preview table. */
export function summarizeValue(key, v) {
  if (v === undefined || v === null) return "default";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (v === "") return "default";
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") {
    const n = Object.keys(v).length;
    return n ? `${n} entr${n === 1 ? "y" : "ies"}` : "none";
  }
  return String(v);
}

/** Starting points for named profiles; every unspecified setting keeps its default. */
export const PROFILE_TEMPLATES = [
  { id: "work", name: "Work", description: "Everyday defaults.", settings: {} },
  {
    id: "presentation",
    name: "Presentation (big UI)",
    description: "Larger interface, text and pointer, roomy density and clear focus outlines for screen sharing and projectors.",
    settings: { uiScale: 140, uiFontSize: 16, density: "spacious", cursorSize: "large", focusRings: true, showHints: true, animSpeed: "normal", rulers: false },
  },
  {
    id: "lowpower",
    name: "Low power",
    description: "Low-power rendering, no animations, small undo history and compact density for older devices and battery life.",
    settings: { lowPower: "on", reduceMotion: "on", animSpeed: "off", historyMB: 32, density: "compact", autosaveSeconds: 15 },
  },
];

export function templateProfile(id, defaults) {
  const t = PROFILE_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const settings = {};
  for (const k of SETTING_KEYS) if (defaults[k] !== undefined) settings[k] = clone(defaults[k]);
  Object.assign(settings, t.settings);
  return { format: PROFILE_FORMAT, version: PROFILE_VERSION, name: t.name, created: new Date().toISOString(), settings };
}

// ------------------------------------------------------------------ named profiles (stored list)

/** Validates the stored list of named profiles ({profiles: {name: profile}}); invalid entries are dropped. */
export function sanitizeStoredProfiles(raw) {
  const out = {};
  const profiles = raw && typeof raw === "object" && raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {};
  for (const [name, p] of Object.entries(profiles)) {
    if (name === "__proto__" || !name || name.length > 60) continue;
    const r = validateProfile(p);
    if (r.ok) out[name] = { format: PROFILE_FORMAT, version: PROFILE_VERSION, name, created: typeof p.created === "string" ? p.created.slice(0, 40) : "", settings: r.profile.settings };
  }
  return out;
}
