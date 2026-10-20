// Small tolerant XML parser that keeps mixed content in order (OOXML and ODF interleave text and elements), plus
// escaping helpers for the writers. Pure, never uses the DOM, never resolves external entities or DTDs.
//
//   XmlEl   = { name: "w:p", local: "p", attrs: { "w:val": "..." }, children: (XmlEl | string)[] }

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (ENT[e]) return ENT[e];
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    return String.fromCodePoint(cp);
  });
}

/** Escapes text content. Characters that XML 1.0 forbids are dropped. */
export function esc(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
/** Escapes an attribute value (double quoted). */
export const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13;

/**
 * Parses XML. Tolerant (unclosed tags close at the end, stray end tags are ignored). Limits: `maxDepth` nesting,
 * `maxNodes` elements; beyond them content is skipped. Never throws for malformed input.
 * @param {string} text
 * @returns {XmlEl} a synthetic "#document" element
 */
export function parseXml(text, { maxDepth = 256, maxNodes = 2_000_000 } = {}) {
  text = String(text ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  const doc = { name: "#document", local: "#document", attrs: {}, children: [] };
  const stack = [doc];
  let count = 0;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const addText = (s) => {
    if (!s) return;
    const kids = top().children;
    if (typeof kids[kids.length - 1] === "string") kids[kids.length - 1] += s;
    else kids.push(s);
  };
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      addText(decodeXmlEntities(text.slice(i)));
      break;
    }
    if (lt > i) addText(decodeXmlEntities(text.slice(i, lt)));
    if (text.startsWith("<!--", lt)) {
      const e = text.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const e = text.indexOf("]]>", lt + 9);
      addText(text.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    const c1 = text.charCodeAt(lt + 1);
    if (c1 === 63 /* ? */) {
      const e = text.indexOf("?>", lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c1 === 33 /* ! DOCTYPE: skipped with its internal subset, entities are never expanded */) {
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 91) depth++;
        else if (c === 93) depth--;
        else if (c === 62 && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c1 === 47 /* / */) {
      const gt = text.indexOf(">", lt + 2);
      const name = text.slice(lt + 2, gt < 0 ? n : gt).trim();
      i = gt < 0 ? n : gt + 1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    let j = lt + 1;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isWs(c) || c === 47 || c === 62 || c === 60) break;
      j++;
    }
    if (j === lt + 1) {
      addText("<");
      i = lt + 1;
      continue;
    }
    const name = text.slice(lt + 1, j);
    const attrs = {};
    let selfClose = false;
    for (;;) {
      while (j < n && isWs(text.charCodeAt(j))) j++;
      if (j >= n) break;
      const c = text.charCodeAt(j);
      if (c === 62) {
        j++;
        break;
      }
      if (c === 60) break;
      if (c === 47) {
        selfClose = true;
        j++;
        continue;
      }
      let k = j;
      while (k < n) {
        const d = text.charCodeAt(k);
        if (isWs(d) || d === 61 || d === 62 || d === 47 || d === 60) break;
        k++;
      }
      if (k === j) {
        j++;
        continue;
      }
      const an = text.slice(j, k);
      j = k;
      while (j < n && isWs(text.charCodeAt(j))) j++;
      let val = "";
      if (text.charCodeAt(j) === 61) {
        j++;
        while (j < n && isWs(text.charCodeAt(j))) j++;
        const q = text.charCodeAt(j);
        if (q === 34 || q === 39) {
          const e = text.indexOf(String.fromCharCode(q), j + 1);
          val = text.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          let e = j;
          while (e < n && !isWs(text.charCodeAt(e)) && text.charCodeAt(e) !== 62) e++;
          val = text.slice(j, e);
          j = e;
        }
      }
      if (!(an in attrs)) attrs[an] = decodeXmlEntities(val);
    }
    i = j;
    if (count >= maxNodes || stack.length > maxDepth) continue; // too large or too deep: skip the element (its text still flows into the parent)
    count++;
    const colon = name.indexOf(":");
    const el = { name, local: colon >= 0 ? name.slice(colon + 1) : name, attrs, children: [] };
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  return doc;
}

/** First child element with this qualified name (or local name when `name` has no prefix). */
export function child(el, name) {
  if (!el) return null;
  const byLocal = !name.includes(":");
  for (const c of el.children) if (typeof c !== "string" && (byLocal ? c.local === name : c.name === name)) return c;
  return null;
}
export function children(el, name) {
  if (!el) return [];
  const byLocal = name && !name.includes(":");
  return el.children.filter((c) => typeof c !== "string" && (!name || (byLocal ? c.local === name : c.name === name)));
}
/** Depth-first search for the first descendant element. */
export function find(el, name) {
  if (!el) return null;
  const byLocal = !name.includes(":");
  const stack = [el];
  while (stack.length) {
    const e = stack.pop();
    for (let k = e.children.length - 1; k >= 0; k--) {
      const c = e.children[k];
      if (typeof c === "string") continue;
      if (byLocal ? c.local === name : c.name === name) return c;
      stack.push(c);
    }
  }
  return null;
}
export function findAll(el, name, out = []) {
  if (!el) return out;
  const byLocal = !name.includes(":");
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (byLocal ? c.local === name : c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
/** Concatenated text of an element and its descendants. */
export function textOf(el) {
  if (!el) return "";
  if (typeof el === "string") return el;
  let s = "";
  for (const c of el.children) s += typeof c === "string" ? c : textOf(c);
  return s;
}
/** Attribute by qualified name, or by local name across prefixes. */
export function attr(el, name) {
  if (!el) return undefined;
  if (name in el.attrs) return el.attrs[name];
  if (!name.includes(":")) for (const [k, v] of Object.entries(el.attrs)) if (k.slice(k.indexOf(":") + 1) === name) return v;
  return undefined;
}
