// Character encoding and decoding for code and text: HTML entities (named, decimal, hexadecimal), JavaScript and JSON
// \u escapes, CSS escapes, URL percent-encoding and code point lists. Pure module (no DOM), used by the code editor's
// Transform menu, the command palette and the Vibe `encode_text` / `decode_text` tools.
//
// Decoding is always a single pass over the input, so "&amp;#233;" becomes "&#233;" and never "é".

/** Encoding formats. */
export const FORMATS = ["html-named", "html-decimal", "html-hex", "js", "css", "url", "codepoints"];
/** Which characters are encoded: every non-ASCII one, only special and markup characters, or every character. */
export const MODES = ["non-ascii", "special", "everything"];

export const FORMAT_LABELS = {
  "html-named": "HTML named entities (&eacute;)",
  "html-decimal": "HTML decimal (&#233;)",
  "html-hex": "HTML hexadecimal (&#xE9;)",
  js: "JavaScript / JSON (\\u00e9)",
  css: "CSS escapes (\\E9 )",
  url: "URL percent-encoding (%C3%A9)",
  codepoints: "Unicode code points (<U+00E9>)",
};
export const MODE_LABELS = {
  "non-ascii": "All non-ASCII characters",
  special: "Only special and markup characters (& < > \" ')",
  everything: "Every character",
};

// ---------------------------------------------------------------------------------------------- entity tables

const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const GREEK_UP1 = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho"; // 913..929
const GREEK_UP2 = "Sigma Tau Upsilon Phi Chi Psi Omega"; // 931..937
const GREEK_LO1 = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho"; // 945..961
const HTML4_REST =
  "quot:34 amp:38 lt:60 gt:62 OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 " +
  "sigmaf:962 sigma:963 tau:964 upsilon:965 phi:966 chi:967 psi:968 omega:969 thetasym:977 upsih:978 piv:982 " +
  "ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211 mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 " +
  "dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 " +
  "larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 " +
  "forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 " +
  "there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 " +
  "lang:10216 rang:10217 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830";

// Common HTML5 additions (decoded always; used for encoding only when the character has no HTML 4 name).
const HTML5_EXTRA =
  "apos:39 Tab:9 NewLine:10 excl:33 num:35 dollar:36 percnt:37 lpar:40 rpar:41 ast:42 midast:42 plus:43 comma:44 period:46 sol:47 colon:58 semi:59 equals:61 quest:63 commat:64 " +
  "lbrack:91 lsqb:91 bsol:92 rbrack:93 rsqb:93 lowbar:95 grave:96 lbrace:123 lcub:123 verbar:124 vert:124 rbrace:125 rcub:125 " +
  "AMP:38 LT:60 GT:62 QUOT:34 COPY:169 REG:174 TRADE:8482 hyphen:8208 dash:8208 horbar:8213 Vert:8214 nldr:8229 mldr:8230 hairsp:8202 numsp:8199 puncsp:8200 emsp13:8196 emsp14:8197 ZeroWidthSpace:8203 NoBreak:8288 " +
  "half:189 frac13:8531 frac23:8532 frac15:8533 frac25:8534 frac35:8535 frac45:8536 frac16:8537 frac56:8538 frac18:8539 frac38:8540 frac58:8541 frac78:8542 " +
  "check:10003 checkmark:10003 cross:10007 star:9734 starf:9733 bigstar:9733 phone:9742 female:9792 male:9794 copysr:8471 incare:8453 numero:8470 hbar:8463 ell:8467 " +
  "bigcirc:9711 square:9633 squ:9633 squf:9642 blacksquare:9642 utri:9653 utrif:9652 dtri:9663 dtrif:9662 ltri:9667 rtri:9657 cir:9675 sung:9834 flat:9837 natural:9838 sharp:9839 " +
  "rarrw:8605 map:8614 hookrightarrow:8618 nearr:8599 searr:8600 swarr:8601 nwarr:8598 varr:8597 lrarr:8646 rlarr:8644 Rightarrow:8658 Leftarrow:8656 rightarrow:8594 leftarrow:8592 uparrow:8593 downarrow:8595 " +
  "Amacr:256 amacr:257 Abreve:258 abreve:259 Aogon:260 aogon:261 Cacute:262 cacute:263 Ccaron:268 ccaron:269 Dcaron:270 dcaron:271 Dstrok:272 dstrok:273 Emacr:274 emacr:275 Edot:278 edot:279 Eogon:280 eogon:281 Ecaron:282 ecaron:283 " +
  "Gbreve:286 gbreve:287 Idot:304 imath:305 inodot:305 Lstrok:321 lstrok:322 Nacute:323 nacute:324 Ncaron:327 ncaron:328 Omacr:332 omacr:333 Odblac:336 odblac:337 Racute:340 racute:341 Rcaron:344 rcaron:345 " +
  "Sacute:346 sacute:347 Scedil:350 scedil:351 Tcaron:356 tcaron:357 Umacr:362 umacr:363 Uring:366 uring:367 Udblac:368 udblac:369 Zacute:377 zacute:378 Zdot:379 zdot:380 Zcaron:381 zcaron:382 " +
  "ohm:937 epsi:949 epsiv:1013 thetav:977 phiv:981 varpi:982 kappav:1008 rhov:1009 sigmav:962 " +
  "ne:8800 neq:8800 leq:8804 geq:8805 approx:8776 plusmn:177 pm:177 mnplus:8723 setminus:8726 compfn:8728 Sqrt:8730 infintie:10717 angle:8736 therefore:8756 because:8757 becaus:8757 " +
  "nbsp:160 NonBreakingSpace:160 shy:173 lsquor:8218 rsquor:8217 ldquor:8222 rdquor:8221 laquo:171 raquo:187 " +
  "bullet:8226 centerdot:183 middot:183 dollar:36 pound:163 yen:165 cent:162 euro:8364 inr:8377 " +
  "iff:8660 implies:8658 DoubleRightArrow:8658 emptyset:8709 varnothing:8709 in:8712 isinv:8712 notni:8716 ";

/** @type {Map<string, number>} name -> code point (decode table) */
const ENTITIES = new Map();
/** @type {Map<number, string>} code point -> preferred HTML 4 name (encode table) */
const NAMES = new Map();

(function build() {
  const add = (name, cp, primary) => {
    if (!ENTITIES.has(name)) ENTITIES.set(name, cp);
    if (primary && !NAMES.has(cp)) NAMES.set(cp, name);
  };
  LATIN1.split(" ").forEach((n, i) => add(n, 160 + i, true));
  GREEK_UP1.split(" ").forEach((n, i) => add(n, 913 + i, true));
  GREEK_UP2.split(" ").forEach((n, i) => add(n, 931 + i, true));
  GREEK_LO1.split(" ").forEach((n, i) => add(n, 945 + i, true));
  for (const pair of HTML4_REST.split(" ")) {
    const [n, v] = pair.split(":");
    add(n, Number(v), true);
  }
  for (const pair of HTML5_EXTRA.trim().split(/\s+/)) {
    const [n, v] = pair.split(":");
    add(n, Number(v), false);
  }
})();

/** Number of known entity names (HTML 4 plus common HTML 5). */
export const ENTITY_COUNT = ENTITIES.size;
/** The HTML 4 entity name of a code point, or undefined. */
export function entityName(cp) {
  return NAMES.get(cp);
}
/** The code point of an entity name (without & and ;), or undefined. */
export function entityCodePoint(name) {
  return ENTITIES.get(name);
}

// Windows-1252 interpretations of numeric references 128..159 (HTML spec).
const CP1252 = {
  128: 0x20ac, 130: 0x201a, 131: 0x192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x2c6, 137: 0x2030, 138: 0x160, 139: 0x2039, 140: 0x152, 142: 0x17d,
  145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x2dc, 153: 0x2122, 154: 0x161, 155: 0x203a, 156: 0x153, 158: 0x17e, 159: 0x178,
};

// ---------------------------------------------------------------------------------------------- helpers

const SPECIAL_MARKUP = new Set(["&", "<", ">", '"', "'"]);
const KEEP = new Set(["\n", "\r", "\t"]);
const hexOf = (cp, upper, pad = 0) => {
  const s = cp.toString(16);
  return (upper ? s.toUpperCase() : s).padStart(pad, "0");
};
const isLoneSurrogate = (ch) => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff;
const LETTERISH = /[\p{L}\p{N}\p{M}]/u;

/** Should this character be encoded in the given mode? */
export function shouldEncode(ch, mode) {
  const cp = ch.codePointAt(0);
  if (mode === "everything") return !KEEP.has(ch); // line breaks and tabs keep the layout of the code
  if (mode === "special") return SPECIAL_MARKUP.has(ch) || (cp >= 0x80 && !LETTERISH.test(ch));
  return cp >= 0x80; // non-ascii
}

function utf8Bytes(ch) {
  return [...new TextEncoder().encode(isLoneSurrogate(ch) ? "�" : ch)];
}

function encodeOne(ch, format, o) {
  const cp = ch.codePointAt(0);
  const upper = o.upper ?? format !== "js";
  switch (format) {
    case "html-named": {
      if (cp === 38) return "&amp;";
      if (cp === 60) return "&lt;";
      if (cp === 62) return "&gt;";
      if (cp === 34) return "&quot;";
      if (cp === 39) return o.apos ? "&apos;" : "&#39;";
      if (isLoneSurrogate(ch)) return ch;
      const name = NAMES.get(cp);
      return name ? `&${name};` : `&#${cp};`;
    }
    case "html-decimal":
      return isLoneSurrogate(ch) ? ch : `&#${cp};`;
    case "html-hex":
      return isLoneSurrogate(ch) ? ch : `&#x${hexOf(cp, upper)};`;
    case "js": {
      if (cp > 0xffff) {
        if (o.braces) return `\\u{${hexOf(cp, upper)}}`;
        const hi = ch.charCodeAt(0);
        const lo = ch.charCodeAt(1);
        return `\\u${hexOf(hi, upper, 4)}\\u${hexOf(lo, upper, 4)}`;
      }
      return `\\u${hexOf(cp, upper, 4)}`;
    }
    case "css":
      return isLoneSurrogate(ch) ? ch : `\\${hexOf(cp, upper)} `;
    case "url":
      return utf8Bytes(ch).map((b) => `%${hexOf(b, true, 2)}`).join("");
    case "codepoints":
      return isLoneSurrogate(ch) ? ch : `<U+${hexOf(cp, true, 4)}>`;
    default:
      throw new Error(`Unknown format "${format}".`);
  }
}

/**
 * Encodes text.
 * @param {string} text
 * @param {{format?: string, mode?: string, upper?: boolean, braces?: boolean, apos?: boolean}} [o]
 *   format: one of FORMATS; mode: one of MODES; upper: uppercase hex digits (default: true except for js);
 *   braces: JS `\u{1F600}` instead of surrogate pairs; apos: `&apos;` instead of `&#39;`.
 */
export function encode(text, o = {}) {
  const format = o.format || "html-named";
  const mode = o.mode || "non-ascii";
  if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}".`);
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}".`);
  let out = "";
  for (const ch of String(text ?? "")) {
    let pick = shouldEncode(ch, mode);
    // JS strings and URLs must stay unambiguous: their escape introducers are encoded when markup characters are
    if (!pick && mode === "special" && ((format === "js" || format === "css") && ch === "\\")) pick = true;
    if (!pick && (mode === "special" || mode === "everything") && format === "url" && ch === "%") pick = true;
    out += pick ? encodeOne(ch, format, o) : ch;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- decoding

const fromCp = (cp) => String.fromCodePoint(cp);

/** Decodes HTML character references: named (&eacute;), decimal (&#233;) and hexadecimal (&#xE9;). */
export function decodeEntities(text) {
  return String(text ?? "").replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec, hex, name) => {
    if (name) {
      const cp = ENTITIES.get(name);
      return cp == null ? m : fromCp(cp);
    }
    let cp = dec != null ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    if (CP1252[cp]) cp = CP1252[cp];
    return fromCp(cp);
  });
}

/** Decodes JavaScript / JSON escapes: \uXXXX (surrogate pairs combine), \u{...} and \xHH. `\\` is kept as it is. */
export function decodeJs(text) {
  return String(text ?? "").replace(/\\\\|\\u\{([0-9a-fA-F]{1,8})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (m, brace, four, two) => {
    if (m === "\\\\") return m;
    if (brace != null) {
      const cp = parseInt(brace, 16);
      return cp > 0x10ffff ? m : fromCp(cp);
    }
    return String.fromCharCode(parseInt(four ?? two, 16));
  });
}

/** Decodes CSS escapes: \E9 (1 to 6 hex digits and one optional terminating white space). `\\` is kept. */
export function decodeCss(text) {
  return String(text ?? "").replace(/\\\\|\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?/g, (m, hex) => {
    if (m === "\\\\") return m;
    const cp = parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    return fromCp(cp);
  });
}

/** Decodes URL percent-encoding. Runs that are not valid UTF-8 are left untouched. */
export function decodePercent(text) {
  const dec = new TextDecoder("utf-8", { fatal: true });
  return String(text ?? "").replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      const bytes = new Uint8Array(run.length / 3);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
      return dec.decode(bytes);
    } catch {
      return run;
    }
  });
}

/** Decodes `<U+00E9>` and bare `U+00E9` code point notation. */
export function decodeCodePoints(text) {
  return String(text ?? "").replace(/<U\+([0-9a-fA-F]{4,6})>|\bU\+([0-9a-fA-F]{4,6})\b/g, (m, a, b) => {
    const cp = parseInt(a ?? b, 16);
    return cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? m : fromCp(cp);
  });
}

/**
 * Decodes text. `format` is one of "html" (all entity forms), "js", "css", "url", "codepoints" or "auto"
 * (HTML entities, then JS escapes; CSS and percent decoding are never applied automatically because plain text can
 * legitimately contain sequences such as "\a" or "50%DA").
 */
export function decode(text, format = "auto") {
  switch (format) {
    case "html":
    case "html-named":
    case "html-decimal":
    case "html-hex":
      return decodeEntities(text);
    case "js":
      return decodeJs(text);
    case "css":
      return decodeCss(text);
    case "url":
      return decodePercent(text);
    case "codepoints":
      return decodeCodePoints(text);
    case "auto": {
      // one pass per syntax over the ORIGINAL text pieces would be ideal; decoding entities first and JS second can
      // only double-decode text such as "&#92;u0041", so protect entity results from the JS pass
      const parts = [];
      let last = 0;
      const re = /&(?:#\d{1,8}|#[xX][0-9a-fA-F]{1,8}|[A-Za-z][A-Za-z0-9]{1,31});/g;
      const s = String(text ?? "");
      let m;
      while ((m = re.exec(s))) {
        parts.push(decodeJs(s.slice(last, m.index)), decodeEntities(m[0]));
        last = m.index + m[0].length;
      }
      parts.push(decodeJs(s.slice(last)));
      return parts.join("");
    }
    default:
      throw new Error(`Unknown format "${format}".`);
  }
}

// ---------------------------------------------------------------------------------------------- inspection

const CATEGORIES = [
  ["Lu", "Uppercase letter"], ["Ll", "Lowercase letter"], ["Lt", "Titlecase letter"], ["Lm", "Modifier letter"], ["Lo", "Other letter"],
  ["Mn", "Nonspacing mark"], ["Mc", "Spacing mark"], ["Me", "Enclosing mark"], ["Nd", "Decimal digit"], ["Nl", "Letter number"], ["No", "Other number"],
  ["Pc", "Connector punctuation"], ["Pd", "Dash punctuation"], ["Ps", "Opening punctuation"], ["Pe", "Closing punctuation"], ["Pi", "Initial quote"], ["Pf", "Final quote"], ["Po", "Other punctuation"],
  ["Sm", "Math symbol"], ["Sc", "Currency symbol"], ["Sk", "Modifier symbol"], ["So", "Other symbol"],
  ["Zs", "Space separator"], ["Zl", "Line separator"], ["Zp", "Paragraph separator"], ["Cc", "Control"], ["Cf", "Format"], ["Co", "Private use"], ["Cn", "Unassigned"],
];
const CATEGORY_RES = CATEGORIES.map(([k, label]) => [k, label, new RegExp(`^\\p{${k}}$`, "u")]);

/** Facts about the character at a string index: code point, UTF-8 and UTF-16 bytes, entity name, category. */
export function charInfo(text, index = 0) {
  const s = String(text ?? "");
  const cp = s.codePointAt(index);
  if (cp == null) return null;
  const ch = fromCp(cp);
  const u16 = [];
  for (let i = 0; i < ch.length; i++) u16.push(ch.charCodeAt(i));
  const cat = CATEGORY_RES.find(([, , re]) => re.test(ch));
  return {
    char: ch,
    length: ch.length,
    codePoint: `U+${hexOf(cp, true, 4)}`,
    decimal: cp,
    utf8: utf8Bytes(ch).map((b) => hexOf(b, true, 2)),
    utf16: u16.map((u) => hexOf(u, true, 4)),
    entity: NAMES.has(cp) ? `&${NAMES.get(cp)};` : null,
    category: cat ? cat[1] : "Unknown",
  };
}

/** One-line summary of charInfo for status messages. */
export function describeChar(text, index = 0) {
  const i = charInfo(text, index);
  if (!i) return "";
  const shown = i.codePoint === "U+000A" ? "line feed" : i.codePoint === "U+0020" ? "space" : i.codePoint === "U+0009" ? "tab" : `“${i.char}”`;
  return `${shown}  ${i.codePoint} (${i.decimal})  ${i.category}${i.entity ? `  ${i.entity}` : ""}  UTF-8: ${i.utf8.join(" ")}  UTF-16: ${i.utf16.join(" ")}`;
}

// ---------------------------------------------------------------------------------------------- range helpers

/**
 * Applies a text transform to several ranges of a document at once and keeps selections consistent.
 * @param {Array<{from:number,to:number}>} ranges ascending, non-overlapping
 * @param {(s: string) => string} fn
 * @param {(from:number,to:number)=>string} slice returns the document text of a range
 * @returns {{changes: Array<{from:number,to:number,insert:string}>, selection: Array<{anchor:number,head:number}>}}
 *   `selection` selects every replaced text in the NEW document (offsets shift by the cumulative length change).
 */
export function transformRanges(ranges, fn, slice) {
  const changes = [];
  const selection = [];
  let shift = 0;
  for (const r of ranges) {
    const old = slice(r.from, r.to);
    const next = String(fn(old));
    if (next !== old) changes.push({ from: r.from, to: r.to, insert: next });
    selection.push({ anchor: r.from + shift, head: r.from + shift + next.length });
    shift += next.length - (r.to - r.from);
  }
  return { changes, selection };
}
