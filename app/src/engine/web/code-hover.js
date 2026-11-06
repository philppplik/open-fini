// What the Code studio editor shows on hover: color values (swatch and picker) and local file paths (preview and open).
// Pure (no DOM); the popovers live in ui/code/assist.js.
//
// Public API
//   colorsInLine(text, { named })          [{ from, to, value, kind }] every color literal in one line of code
//   colorAt(text, col, { named })          the color literal at a column, or null
//   parseColor(value)                      { r, g, b, a } (0-255, alpha 0-1) or null; hex, rgb(a), hsl(a), named
//   formatColorLike(original, rgba)        the new color written in the format of `original` (hex stays hex ...)
//   toHex(rgba)                            "#rrggbb" or "#rrggbbaa"
//   pathAt(text, col)                      { from, to, ref } for a quoted string or url() that looks like a local path
// Columns are offsets within `text` (one line). Named colors are only reported with { named: true } (CSS and style
// attributes), so a JavaScript variable called `red` is not mistaken for a color.

const NAMED = "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32";
let namedMap = null;
const named = () => (namedMap ||= new Map(NAMED.split(" ").map((p) => p.split(":"))));

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[-+.\d][^()]*\)|(?<![\w#.$-])[a-zA-Z]{3,20}(?![\w-(])/g;

/**
 * Color literals in one line.
 * @param {string} text
 * @param {{ named?: boolean }} [o]
 * @returns {{ from: number, to: number, value: string, kind: "hex"|"rgb"|"hsl"|"named" }[]}
 */
export function colorsInLine(text, { named: withNames = false } = {}) {
  const out = [];
  const s = String(text ?? "");
  if (s.length > 4000) return out; // minified lines: no decorations
  COLOR_RE.lastIndex = 0;
  for (let m; (m = COLOR_RE.exec(s)); ) {
    const value = m[0];
    let kind;
    if (value[0] === "#") {
      // "#fff" in a URL fragment or an id selector ("#cafe") is ambiguous: require a value context
      const before = s.slice(0, m.index);
      if (/[\w/]$/.test(before) || /(^|[\s,{};])$/.test(before) && /^\s*[{,]/.test(s.slice(m.index + value.length)) || /href\s*=\s*["']?$/i.test(before)) continue;
      kind = "hex";
    } else if (/^rgb/i.test(value)) kind = "rgb";
    else if (/^hsl/i.test(value)) kind = "hsl";
    else {
      if (!withNames || !named().has(value.toLowerCase())) continue;
      // property names and selectors are not colors: a named color follows ":" or a space inside a value
      const before = s.slice(0, m.index);
      if (!/[:\s,(]\s*$/.test(before) || /^\s*[:{]/.test(s.slice(m.index + value.length))) continue;
      kind = "named";
    }
    if (!parseColor(value)) continue;
    out.push({ from: m.index, to: m.index + value.length, value, kind });
  }
  return out;
}

/** The color literal covering column `col` (inclusive of its end), or null. */
export function colorAt(text, col, o) {
  return colorsInLine(text, o).find((c) => col >= c.from && col <= c.to) || null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function channel(tok, max) {
  const t = String(tok).trim();
  if (t.endsWith("%")) return (parseFloat(t) / 100) * max;
  return parseFloat(t);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * @param {string} value
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function parseColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let hx = m[1];
    if (hx.length === 3 || hx.length === 4) hx = [...hx].map((c) => c + c).join("");
    if (hx.length !== 6 && hx.length !== 8) return null;
    const n = (i) => parseInt(hx.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hx.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
  }
  m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v);
  if (m) {
    const parts = m[2].trim().split(/\s*,\s*|\s*\/\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    if (parts.some((p) => !/^[-+]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(p))) return null;
    const a = parts[3] === undefined ? 1 : clamp(channel(parts[3], 1), 0, 1);
    if (m[1].startsWith("rgb")) {
      const [r, g, b] = parts.slice(0, 3).map((p) => clamp(Math.round(channel(p, 255)), 0, 255));
      return { r, g, b, a: Math.round(a * 1000) / 1000 };
    }
    const h = parseFloat(parts[0]);
    const s = clamp(parseFloat(parts[1]) / 100, 0, 1);
    const l = clamp(parseFloat(parts[2]) / 100, 0, 1);
    const [r, g, b] = hslToRgb(h, s, l).map((x) => clamp(Math.round(x), 0, 255));
    return { r, g, b, a: Math.round(a * 1000) / 1000 };
  }
  const hex = named().get(v);
  return hex ? parseColor(`#${hex}`) : null;
}

const h2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** "#rrggbb", or "#rrggbbaa" when not opaque. */
export function toHex({ r, g, b, a = 1 }) {
  return `#${h2(r)}${h2(g)}${h2(b)}${a < 1 ? h2(a * 255) : ""}`;
}

function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

const num = (n) => String(Math.round(n * 1000) / 1000);

/**
 * Writes `rgba` in the notation of `original`: hex (short form kept when possible, upper case kept), rgb()/rgba() and
 * hsl()/hsla() with comma or space syntax as written. A named color becomes hex.
 */
export function formatColorLike(original, rgba) {
  const o = String(original ?? "").trim();
  const c = { r: clamp(Math.round(rgba.r), 0, 255), g: clamp(Math.round(rgba.g), 0, 255), b: clamp(Math.round(rgba.b), 0, 255), a: clamp(rgba.a ?? 1, 0, 1) };
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec(o);
  if (fn) {
    const name = fn[1].toLowerCase();
    const modern = !fn[2].includes(",");
    const upper = fn[1] !== name;
    const isHsl = name.startsWith("hsl");
    const [x, y, z] = isHsl ? rgbToHsl(c) : [c.r, c.g, c.b];
    const vals = isHsl ? [String(x), `${y}%`, `${z}%`] : [String(x), String(y), String(z)];
    const alpha = c.a < 1;
    let head = isHsl ? "hsl" : "rgb";
    if (!modern && (alpha || name.endsWith("a"))) head += "a";
    if (upper) head = head.toUpperCase();
    if (modern) return `${head}(${vals.join(" ")}${alpha ? ` / ${num(c.a)}` : ""})`;
    return `${head}(${vals.join(", ")}${head.toLowerCase().endsWith("a") ? `, ${num(c.a)}` : ""})`;
  }
  let hex = toHex(c);
  if (/^#[0-9a-f]{3,4}$/i.test(o) && /^#(.)\1(.)\2(.)\3((.)\5)?$/i.test(hex)) hex = `#${hex[1]}${hex[3]}${hex[5]}${hex.length === 9 ? hex[7] : ""}`;
  if (/^#/.test(o) && o === o.toUpperCase() && /[A-F]/.test(o)) hex = hex.toUpperCase();
  return hex;
}

const LOCAL = /^(?!(?:[a-z][a-z\d+.-]*:|\/\/|#|\$\{|\{\{))[^\s<>"'`]*[\w)]$/i;

/**
 * A local file reference at column `col`: the content of a quoted string or of url(...) that looks like a path
 * (has a "/" or a file extension). External URLs, data: URIs, fragments and template placeholders are ignored.
 * @returns {{ from: number, to: number, ref: string } | null}
 */
export function pathAt(text, col) {
  const s = String(text ?? "");
  const re = /url\(\s*(["']?)([^"')\s]+)\1\s*\)|(["'`])((?:(?!\3)[^\\\n]|\\.)*)\3/g;
  for (let m; (m = re.exec(s)); ) {
    const ref = m[2] ?? m[4];
    const from = m.index + m[0].indexOf(ref, m[2] !== undefined ? 4 : 1);
    const to = from + ref.length;
    if (col < from || col > to) continue;
    if (!ref || ref.length > 300 || !LOCAL.test(ref)) return null;
    if (!/\//.test(ref) && !/\.[a-z0-9]{1,8}([?#].*)?$/i.test(ref)) return null;
    return { from, to, ref };
  }
  return null;
}
