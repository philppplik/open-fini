// Syntax color themes of the Code studio editor. Pure (no DOM): the editor turns a theme into CSS custom properties
// (--of-editor-* and --of-syn-*, see app/styles/code.css) on its own element, so a code theme never changes the rest of
// the interface. "app" follows the interface theme (ui/themes.js); custom colors apply on top of any theme.
//
// Public API
//   SYNTAX_SLOTS                 the 19 color slots, in the order of the palette strings below
//   SYNTAX_THEMES                [{ id, name, dark, colors: { slot: "#rrggbb" | "#rrggbbaa" } }]
//   syntaxTheme(id)              a theme or null ("app" and unknown ids)
//   syntaxVars(id, custom)       { "--of-editor-bg": "#1e1e1e", ... } for the theme plus valid custom colors
//   sanitizeSyntaxCustom(value)  only known slots with #rgb / #rrggbb / #rrggbbaa values
// The palettes are original approximations of well-known editor themes, written for this file.

export const SYNTAX_SLOTS = Object.freeze(["bg", "fg", "gutter", "line", "select", "cursor", "keyword", "string", "number", "comment", "function", "tag", "attr", "prop", "type", "op", "punct", "heading", "link"]);

const VAR = { bg: "--of-editor-bg", fg: "--of-editor-fg", gutter: "--of-editor-gutter", line: "--of-editor-line", select: "--of-editor-select", cursor: "--of-editor-cursor", attr: "--of-syn-attr", prop: "--of-syn-prop", op: "--of-syn-op", punct: "--of-syn-punct" };
/** CSS custom property of a slot. */
export const slotVar = (slot) => VAR[slot] || `--of-syn-${slot}`;

// id, name, dark, then one hex color per slot (SYNTAX_SLOTS order)
const RAW = [
  ["dark-plus", "Dark Plus", 1, "1e1e1e d4d4d4 858585 ffffff0f 264f78 aeafad c586c0 ce9178 b5cea8 6a9955 dcdcaa 569cd6 9cdcfe 9cdcfe 4ec9b0 d4d4d4 808080 569cd6 3794ff"],
  ["light-plus", "Light Plus", 0, "ffffff 1f1f1f 237893 0000000a add6ff 000000 af00db a31515 098658 008000 795e26 800000 e50000 0451a5 267f99 000000 6b6b6b 800000 0000ff"],
  ["monokai", "Monokai", 1, "272822 f8f8f2 90908a ffffff0d 49483e f8f8f0 f92672 e6db74 ae81ff 88846f a6e22e f92672 a6e22e 66d9ef 66d9ef f92672 f8f8f2 a6e22e 66d9ef"],
  ["one-dark", "One Dark", 1, "282c34 abb2bf 636d83 ffffff0a 3e4451 528bff c678dd 98c379 d19a66 7f848e 61afef e06c75 d19a66 e06c75 e5c07b 56b6c2 abb2bf e06c75 61afef"],
  ["dracula", "Dracula", 1, "282a36 f8f8f2 6272a4 ffffff0d 44475a f8f8f0 ff79c6 f1fa8c bd93f9 7c8bbd 50fa7b ff79c6 50fa7b 8be9fd 8be9fd ff79c6 f8f8f2 bd93f9 8be9fd"],
  ["github-dark", "GitHub Dark", 1, "0d1117 e6edf3 6e7681 ffffff0a 1f3a5f e6edf3 ff7b72 a5d6ff 79c0ff 8b949e d2a8ff 7ee787 79c0ff 79c0ff ffa657 ff7b72 c9d1d9 79c0ff a5d6ff"],
  ["github-light", "GitHub Light", 0, "ffffff 1f2328 8c959f 0000000a cce5ff 1f2328 cf222e 0a3069 0550ae 6e7781 8250df 116329 0550ae 0550ae 953800 cf222e 1f2328 0550ae 0a3069"],
  ["solarized-dark", "Solarized Dark", 1, "002b36 93a1a1 586e75 ffffff0a 274642 93a1a1 859900 2aa198 d33682 6f878e 268bd2 268bd2 b58900 268bd2 cb4b16 859900 839496 cb4b16 6c71c4"],
  ["solarized-light", "Solarized Light", 0, "fdf6e3 586e75 93a1a1 0000000a e3dcc6 586e75 859900 2aa198 d33682 8a9a9b 268bd2 268bd2 b58900 268bd2 cb4b16 859900 657b83 cb4b16 6c71c4"],
  ["nord", "Nord", 1, "2e3440 d8dee9 616e88 ffffff0a 434c5e d8dee9 81a1c1 a3be8c b48ead 7b88a1 88c0d0 81a1c1 8fbcbb 88c0d0 8fbcbb 81a1c1 eceff4 88c0d0 88c0d0"],
  ["night-owl", "Night Owl", 1, "011627 d6deeb 4b6479 ffffff0a 1d3b53 80a4c2 c792ea ecc48d f78c6c 709090 82aaff caece6 addb67 80cbc4 ffcb8b c792ea d6deeb 82aaff 7fdbca"],
  ["gruvbox-dark", "Gruvbox Dark", 1, "282828 ebdbb2 7c6f64 ffffff0a 504945 ebdbb2 fb4934 b8bb26 d3869b 928374 8ec07c fb4934 fabd2f 83a598 fabd2f fe8019 a89984 fe8019 83a598"],
  ["tomorrow-night", "Tomorrow Night", 1, "1d1f21 c5c8c6 707880 ffffff0a 373b41 aeafad b294bb b5bd68 de935f 969896 81a2be cc6666 de935f 81a2be f0c674 8abeb7 c5c8c6 81a2be 8abeb7"],
  ["catppuccin-mocha", "Catppuccin Mocha", 1, "1e1e2e cdd6f4 6c7086 ffffff0a 45475a f5e0dc cba6f7 a6e3a1 fab387 9399b2 89b4fa 89b4fa f9e2af 94e2d5 f9e2af 89dceb 9399b2 f38ba8 89dceb"],
  ["quiet-light", "Quiet Light", 0, "f5f5f5 333333 9a9a9a 0000000a c9d0d9 54494b 4b69c6 448c27 ab6526 8a8a8a aa3731 4b69c6 8190a0 7a3e9d 7a3e9d 777777 777777 4b69c6 4b69c6"],
  ["high-contrast-dark", "High Contrast Dark", 1, "000000 ffffff ffffff ffffff1a 264f78 ffffff 569cd6 ce9178 b5cea8 7ca668 dcdcaa 569cd6 9cdcfe 9cdcfe 4ec9b0 ffffff ffffff 6fc3df 3794ff"],
  ["high-contrast-light", "High Contrast Light", 0, "ffffff 000000 292929 00000012 a6d2ff 000000 0f4a85 a31515 096d48 515151 5e2cbc 0f4a85 264f78 264f78 185e73 000000 000000 0f4a85 0f4a85"],
];

/** @type {{ id: string, name: string, dark: boolean, colors: Record<string, string> }[]} */
export const SYNTAX_THEMES = RAW.map(([id, name, dark, palette]) => {
  const hex = palette.split(" ");
  return Object.freeze({ id, name, dark: !!dark, colors: Object.freeze(Object.fromEntries(SYNTAX_SLOTS.map((s, i) => [s, `#${hex[i]}`]))) });
});

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** @param {string} id */
export function syntaxTheme(id) {
  return SYNTAX_THEMES.find((t) => t.id === id) || null;
}

/** Keeps only known slots with hex colors (stored preferences and imported profiles are untrusted input). */
export function sanitizeSyntaxCustom(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const s of SYNTAX_SLOTS) if (typeof value[s] === "string" && HEX.test(value[s])) out[s] = value[s].toLowerCase();
  return out;
}

/**
 * CSS custom properties for a theme id ("app" or unknown: none) plus custom colors on top.
 * @param {string} id
 * @param {Record<string, string>} [custom]
 * @returns {Record<string, string>}
 */
export function syntaxVars(id, custom) {
  const out = {};
  const theme = syntaxTheme(id);
  const colors = { ...(theme ? theme.colors : {}), ...sanitizeSyntaxCustom(custom) };
  for (const [slot, color] of Object.entries(colors)) out[slotVar(slot)] = color;
  return out;
}
