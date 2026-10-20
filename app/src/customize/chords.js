// Keyboard chords: parsing, normalizing and recording. Pure (no DOM); unit tested in tests/customize.
// A chord is a string such as "Mod+Shift+Z", "Alt+Backspace", "F2" or "B". `Mod` is Ctrl on Windows/Linux and Cmd on macOS.

const MOD_ALIASES = { ctrl: "Mod", control: "Mod", cmd: "Mod", command: "Mod", meta: "Mod", mod: "Mod", alt: "Alt", option: "Alt", opt: "Alt", shift: "Shift" };
const KEY_ALIASES = {
  esc: "Escape", escape: "Escape", del: "Delete", delete: "Delete", return: "Enter", enter: "Enter", space: "Space", spacebar: "Space", tab: "Tab", backspace: "Backspace", bksp: "Backspace",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", insert: "Insert", ins: "Insert", plus: "+",
};
const NAMED = new Set(["Escape", "Delete", "Enter", "Space", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert"]);
const MOD_ORDER = ["Mod", "Alt", "Shift"];

// Punctuation is matched by physical key (so Shift+] still means "]"); digits and letters by their code when a modifier changes the character.
const PUNCT = { BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Comma: ",", Semicolon: ";", Quote: "'", Backslash: "\\", Period: ".", Slash: "/", Backquote: "`" };

function normalizeKey(raw) {
  if (raw === "+") return "+";
  const k = String(raw);
  if (k.length === 1) return k === " " ? "Space" : k.toUpperCase();
  const lower = k.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const f = /^f([1-9]|1\d|2[0-4])$/.exec(lower);
  if (f) return `F${f[1]}`;
  return null;
}

/** "ctrl+shift+z" → "Mod+Shift+Z" (modifiers in the order Mod, Alt, Shift); null when it is not a valid chord. */
export function normalizeChord(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s || s.length > 40) return null;
  let key;
  if (s.endsWith("++") || s === "+") {
    key = "+";
    s = s.slice(0, s.length - 1); // drop the key's '+', leaving "Mod+" or ""
  }
  const parts = s.split("+").map((p) => p.trim());
  if (key === undefined) key = parts.pop();
  else if (parts[parts.length - 1] === "") parts.pop();
  if (key === undefined || key === "") return null;
  const mods = new Set();
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const k = normalizeKey(key);
  if (!k) return null;
  if (MOD_ALIASES[k.toLowerCase()]) return null; // a modifier on its own
  if (!(k.length === 1 || NAMED.has(k) || /^F\d{1,2}$/.test(k))) return null;
  return [...MOD_ORDER.filter((m) => mods.has(m)), k].join("+");
}

export const isValidChord = (c) => normalizeChord(c) === c;

/** Splits a normalized chord into its parts. */
export function parseChord(chord) {
  const n = normalizeChord(chord);
  if (!n) return null;
  const parts = n.split("+");
  let key = parts.pop();
  if (key === "" && parts.length) key = "+";
  return { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}

/** A tool shortcut is one key without modifiers (letters, digits, punctuation or an F key). */
export function isSingleKeyChord(chord) {
  const p = parseChord(chord);
  return !!p && !p.mod && !p.alt && !p.shift && (p.key.length === 1 || /^F\d{1,2}$/.test(p.key));
}

/** The key name of a keyboard event the way the shortcut table matches it. `ev` needs key, code, altKey. */
export function eventKey(ev) {
  const code = ev.code || "";
  if (PUNCT[code]) return PUNCT[code];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (ev.altKey && /^Key[A-Z]$/.test(code)) return code[3]; // Option+letter produces other characters on macOS
  let k = ev.key;
  if (k === " ") k = "Space";
  if (typeof k === "string" && k.length === 1) k = k.toUpperCase();
  return k;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified", "Process"]);

/**
 * The chord a key event represents, for the "press the keys" recorder.
 * @returns {string|null} null while only modifiers are held, or when the combination cannot be represented
 */
export function chordFromEvent(ev, isMac = false) {
  if (!ev || MODIFIER_KEYS.has(ev.key)) return null;
  if (isMac ? ev.ctrlKey : ev.metaKey) return null; // the "other" modifier has no meaning in the shortcut table
  const key = eventKey(ev);
  const mod = isMac ? ev.metaKey : ev.ctrlKey;
  const parts = [];
  if (mod) parts.push("Mod");
  if (ev.altKey) parts.push("Alt");
  if (ev.shiftKey) parts.push("Shift");
  parts.push(key);
  return normalizeChord(parts.join("+").replace(/\+\+$/, "++"));
}

/** Human readable chord ("Ctrl+Shift+Z" / "⌘⇧Z"), the same style as the menus. */
export function formatChord(chord, isMac = false) {
  if (!chord) return "";
  return chord
    .replace(/\+\+$/, "+PLUS")
    .split("+")
    .map((p) => {
      if (p === "PLUS") return "+";
      if (isMac) return { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵", Backspace: "⌫", Delete: "⌦" }[p] || p;
      return p === "Mod" ? "Ctrl" : p;
    })
    .join(isMac ? "" : "+");
}
