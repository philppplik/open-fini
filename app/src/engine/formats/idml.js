// Adobe InDesign IDML (InDesign Markup Language) reader.
//
// Clean-room implementation from Adobe's published IDML specification / cookbook. Pure module (no DOM, no
// DOMParser): ships its own tolerant XML parser. Coordinates are points, 1 pt = 1 px.

import { unzipSync } from '../../../vendor/fflate/fflate.js';
import { cmykToRgb, labToRgb, toHex } from './color.js';

// ---------------------------------------------------------------------------------------------------------------
// XML parser
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} XmlNode
 * @property {string} name qualified name as written, e.g. 'idPkg:Spread'
 * @property {string} local name without namespace prefix
 * @property {Record<string,string>} attrs attributes with decoded entities
 * @property {XmlNode[]} children child elements in document order
 * @property {string} text concatenated direct text (and CDATA) of this element, entities decoded
 */

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY_RE, (m, e) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!(cp >= 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  });
}

const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13;

/**
 * Parses XML into a light element tree. Tolerant: unclosed tags are closed at the end, stray close tags are
 * ignored, entities that are not understood are kept literally. Comments, processing instructions, DOCTYPE
 * (including an internal subset) are skipped; CDATA becomes text. Never uses the DOM.
 * @param {string} text
 * @returns {XmlNode} the root element
 * @throws {Error} when the text contains no element or nests deeper than 1000 levels
 */
export function parseXml(text) {
  if (typeof text !== 'string') throw new Error('parseXml: input must be a string');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  /** @type {XmlNode} */
  const doc = { name: '#document', local: '#document', attrs: {}, children: [], text: '' };
  /** @type {XmlNode[]} */
  const stack = [doc];
  let i = 0;
  const addText = (s) => {
    if (s) stack[stack.length - 1].text += s;
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      addText(decodeEntities(text.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(text.slice(i, lt)));
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      addText(text.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.charCodeAt(lt + 1) === 63 /* ? */) {
      const e = text.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (text.charCodeAt(lt + 1) === 33 /* ! */) {
      let j = lt + 2;
      let brackets = 0;
      let quote = 0;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === 34 || c === 39) quote = c;
        else if (c === 91) brackets++;
        else if (c === 93) brackets--;
        else if (c === 62 && brackets <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (text.charCodeAt(lt + 1) === 47 /* / */) {
      const gt = text.indexOf('>', lt + 2);
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
    // start tag
    let j = lt + 1;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isWs(c) || c === 47 || c === 62 || c === 60) break;
      j++;
    }
    if (j === lt + 1) {
      addText('<');
      i = lt + 1;
      continue;
    }
    const name = text.slice(lt + 1, j);
    /** @type {Record<string,string>} */
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
      if (c === 60) break; // malformed: next tag starts
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
      let val = '';
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
      if (!(an in attrs)) attrs[an] = decodeEntities(val);
      selfClose = false;
    }
    i = j;
    const colon = name.indexOf(':');
    /** @type {XmlNode} */
    const node = { name, local: colon >= 0 ? name.slice(colon + 1) : name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) {
      if (stack.length > 1000) throw new Error('XML nesting is too deep');
      stack.push(node);
    }
  }
  if (doc.children.length === 0) throw new Error('XML contains no root element');
  return doc.children[0];
}

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {XmlNode} node @param {string} local @returns {XmlNode|undefined} */
function child(node, local) {
  for (const c of node.children) if (c.local === local) return c;
  return undefined;
}

/** Depth-first search over all descendants. */
function descendants(node, local, out = []) {
  for (const c of node.children) {
    if (c.local === local) out.push(c);
    descendants(c, local, out);
  }
  return out;
}

function nums(s) {
  if (!s) return null;
  const a = s.trim().split(/\s+/).map(Number);
  return a.every(Number.isFinite) ? a : null;
}

function bytesToText(u8) {
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}

const r4 = (v) => Math.round(v * 10000) / 10000;
const IDENT = [1, 0, 0, 1, 0, 0];

/** Matrix product: result applies `c` first and then `p`. */
function mul(p, c) {
  return [
    p[0] * c[0] + p[2] * c[1],
    p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3],
    p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4],
    p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matrixOf(s) {
  const a = nums(s);
  return a && a.length === 6 ? a : IDENT;
}

function weightOf(style) {
  const s = style.toLowerCase();
  if (/extra\s*-?\s*light|ultra\s*-?\s*light/.test(s)) return 200;
  if (/thin|hairline/.test(s)) return 100;
  if (/light/.test(s)) return 300;
  if (/semi\s*-?\s*bold|demi/.test(s)) return 600;
  if (/extra\s*-?\s*bold|ultra\s*-?\s*bold|heavy/.test(s)) return 800;
  if (/black/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  if (/medium/.test(s)) return 500;
  return 400;
}

const JUSTIFY = {
  LeftAlign: 'left', ToBindingSide: 'left', AwayFromBindingSide: 'left', CenterAlign: 'center', RightAlign: 'right',
  LeftJustified: 'justify', CenterJustified: 'justify', RightJustified: 'justify', FullyJustified: 'justify',
};

const IMAGE_NAMES = new Set(['Image', 'PDF', 'EPS', 'ImportedPage', 'WMF', 'PICT']);
const UNSUPPORTED_ITEMS = new Set(['Button', 'CheckBox', 'ComboBox', 'ListBox', 'RadioButton', 'SignatureField', 'TextBox', 'MultiStateObject', 'EPSText', 'Movie', 'Sound']);

// ---------------------------------------------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} IdmlItem
 * @property {'rect'|'ellipse'|'polygon'|'line'|'text'|'image'|'group'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} [rotation]
 * @property {string|null} [fill]
 * @property {string|null} [stroke]
 * @property {number} [strokeWidth]
 * @property {number} [opacity]
 * @property {Array<{points: Array<number[]|{x:number,y:number,hx1:number,hy1:number,hx2:number,hy2:number}>, closed: boolean}>} [path]
 * @property {{paragraphs: Array<{runs: Array<{text:string,fontFamily?:string,fontSize?:number,fontWeight?:number,fontStyle?:string,color?:string}>, align?: string}>}} [text]
 * @property {string} [link]
 * @property {IdmlItem[]} [children]
 */

/**
 * Reads an unzipped IDML package.
 * @param {Record<string, Uint8Array>|Uint8Array} entries unzipped package (path -> bytes); a zip as Uint8Array is accepted too
 * @param {{name?: string}} [opts]
 * @returns {{name: string, pages: Array<{name:string,width:number,height:number,x:number,y:number,spread:number,items:IdmlItem[]}>, colors: Record<string,string>, warnings: string[]}}
 */
export function readIdml(entries, opts = {}) {
  if (entries instanceof Uint8Array) entries = unzipSync(entries);
  if (!entries || typeof entries !== 'object') throw new Error('readIdml: entries must be an object mapping paths to bytes');
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const k of Object.keys(entries)) files.set(k.replace(/\\/g, '/').replace(/^\.?\//, ''), entries[k]);
  /** @type {string[]} */
  const warnings = [];

  const parseFile = (path, required) => {
    const f = files.get(path);
    if (!f) {
      if (required) throw new Error(`IDML: ${path} not found in package`);
      return null;
    }
    try {
      return parseXml(bytesToText(f));
    } catch (e) {
      if (required) throw new Error(`IDML: ${path} is not valid XML (${e.message})`);
      warnings.push(`${path} could not be parsed: ${e.message}`);
      return null;
    }
  };

  const designmap = parseFile('designmap.xml', true);
  const srcOf = (local) => designmap.children.filter((c) => c.local === local && c.attrs.src).map((c) => c.attrs.src);
  const graphicSrc = srcOf('Graphic')[0] || 'Resources/Graphic.xml';
  const stylesSrc = srcOf('Styles')[0] || 'Resources/Styles.xml';
  const spreadSrcs = srcOf('Spread');
  const storySrcs = srcOf('Story');
  if (srcOf('MasterSpread').length) warnings.push('Master spreads are ignored; master page items are not imported.');

  // ---- colors ----
  /** @type {Map<string,string|null>} */
  const colorBySelf = new Map([
    ['Color/Black', '#000000'], ['Color/Paper', '#ffffff'], ['Color/Registration', '#000000'],
  ]);
  /** @type {Record<string,string>} */
  const colors = {};
  const graphic = parseFile(graphicSrc, false);
  if (graphic) {
    for (const c of descendants(graphic, 'Color')) {
      const hex = colorHex(c);
      if (!hex) {
        warnings.push(`Color '${c.attrs.Name || c.attrs.Self}' has no usable value; ignored.`);
        continue;
      }
      if (c.attrs.Self) colorBySelf.set(c.attrs.Self, hex);
      let nm = c.attrs.Name;
      if (!nm && c.attrs.Self) {
        nm = c.attrs.Self.replace(/^Color\//, '');
        try { nm = decodeURIComponent(nm); } catch { /* keep raw */ }
      }
      if (nm) colors[nm] = hex;
    }
    for (const g of descendants(graphic, 'Gradient')) {
      const stop = descendants(g, 'GradientStop')[0];
      const ref = stop && stop.attrs.StopColor;
      if (g.attrs.Self && ref && colorBySelf.has(ref)) colorBySelf.set(g.attrs.Self, colorBySelf.get(ref));
    }
  }
  const warnedColors = new Set();
  const resolveColor = (ref) => {
    if (!ref || ref === 'n' || /\/None$/.test(ref) || ref === 'Swatch/None') return null;
    const v = colorBySelf.get(ref);
    if (v) return v;
    if (!warnedColors.has(ref)) {
      warnedColors.add(ref);
      warnings.push(`Swatch '${ref}' is not defined; ignored.`);
    }
    return null;
  };

  // ---- styles ----
  /** @type {Map<string, XmlNode>} */
  const pStyles = new Map();
  /** @type {Map<string, XmlNode>} */
  const cStyles = new Map();
  const styles = parseFile(stylesSrc, false);
  if (styles) {
    for (const s of descendants(styles, 'ParagraphStyle')) if (s.attrs.Self) pStyles.set(s.attrs.Self, s);
    for (const s of descendants(styles, 'CharacterStyle')) if (s.attrs.Self) cStyles.set(s.attrs.Self, s);
  }
  const attrsOfNode = (node) => {
    const props = child(node, 'Properties');
    const fontNode = props && child(props, 'AppliedFont');
    const font = (fontNode && fontNode.text.trim()) || node.attrs.AppliedFont;
    /** @type {{font?:string,size?:number,fontStyle?:string,fill?:string,justification?:string}} */
    const a = {};
    if (font && font !== 'n') a.font = font;
    const sz = parseFloat(node.attrs.PointSize ?? node.attrs.FontSize);
    if (Number.isFinite(sz)) a.size = sz;
    if (node.attrs.FontStyle) a.fontStyle = node.attrs.FontStyle;
    if (node.attrs.FillColor) a.fill = node.attrs.FillColor;
    if (node.attrs.Justification) a.justification = node.attrs.Justification;
    return a;
  };
  const resolveStyle = (map, id) => {
    const chain = [];
    let cur = id;
    for (let d = 0; cur && d < 30; d++) {
      const s = map.get(cur);
      if (!s) break;
      chain.push(s);
      const props = child(s, 'Properties');
      const b = props && child(props, 'BasedOn');
      cur = (b && b.text.trim()) || s.attrs.BasedOn;
      if (chain.includes(map.get(cur))) break;
    }
    const out = {};
    for (let k = chain.length - 1; k >= 0; k--) Object.assign(out, attrsOfNode(chain[k]));
    return out;
  };

  // ---- stories ----
  /** @type {Map<string, XmlNode>} */
  const storyNodes = new Map();
  for (const src of storySrcs) {
    const root = parseFile(src, false);
    if (!root) {
      if (!files.has(src)) warnings.push(`Story file ${src} listed in designmap.xml is missing.`);
      continue;
    }
    const st = child(root, 'Story') || (root.local === 'Story' ? root : null);
    if (st && st.attrs.Self) storyNodes.set(st.attrs.Self, st);
  }
  const storyCache = new Map();
  const buildStory = (id) => {
    if (storyCache.has(id)) return storyCache.get(id);
    const node = storyNodes.get(id);
    const paragraphs = [];
    if (!node) {
      warnings.push(`Story '${id}' not found.`);
      storyCache.set(id, paragraphs);
      return paragraphs;
    }
    let cur = null;
    let tableWarned = false;
    const effective = (ctx) => {
      const p = Object.assign({}, resolveStyle(pStyles, ctx.pId), ctx.pLocal);
      const c = Object.assign({}, p, resolveStyle(cStyles, ctx.cId), ctx.cLocal);
      return { p, c };
    };
    const ensurePara = (ctx) => {
      if (!cur) {
        cur = { runs: [] };
        const { p } = effective(ctx);
        const al = p.justification && JUSTIFY[p.justification];
        if (al) cur.align = al;
        paragraphs.push(cur);
      }
    };
    const walk = (nd, ctx) => {
      for (const c of nd.children) {
        switch (c.local) {
          case 'ParagraphStyleRange':
            walk(c, { ...ctx, pId: c.attrs.AppliedParagraphStyle || ctx.pId, pLocal: attrsOfNode(c) });
            break;
          case 'CharacterStyleRange':
            walk(c, { ...ctx, cId: c.attrs.AppliedCharacterStyle || ctx.cId, cLocal: attrsOfNode(c) });
            break;
          case 'Content': {
            if (!c.text) break;
            ensurePara(ctx);
            const { c: e } = effective(ctx);
            const run = { text: c.text };
            if (e.font) run.fontFamily = e.font;
            run.fontSize = e.size === undefined ? 12 : e.size;
            if (e.fontStyle) {
              run.fontWeight = weightOf(e.fontStyle);
              run.fontStyle = /italic|oblique/i.test(e.fontStyle) ? 'italic' : 'normal';
            }
            const col = resolveColor(e.fill);
            if (col) run.color = col;
            cur.runs.push(run);
            break;
          }
          case 'Br':
            ensurePara(ctx);
            cur = null;
            break;
          case 'Properties':
            break;
          case 'Table':
            if (!tableWarned) {
              tableWarned = true;
              warnings.push(`Story '${id}' contains a table; tables are not imported.`);
            }
            break;
          case 'Rectangle': case 'Oval': case 'Polygon': case 'GraphicLine': case 'Group': case 'TextFrame':
            break; // anchored objects
          default:
            walk(c, ctx);
        }
      }
    };
    walk(node, { pId: undefined, pLocal: {}, cId: undefined, cLocal: {} });
    storyCache.set(id, paragraphs);
    return paragraphs;
  };

  // ---- spreads ----
  /** @type {Array<{name:string,width:number,height:number,ox:number,oy:number,x:number,y:number,spread:number,items:IdmlItem[]}>} */
  const pages = [];
  /** @type {WeakMap<object, {aabb:number[]}>} */
  const meta = new WeakMap();
  /** @type {Array<{item: IdmlItem, story: string, head: boolean}>} */
  const textFrames = [];
  let dropped = 0;

  const aabbOfPoints = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  };

  const readSubpaths = (node) => {
    const props = child(node, 'Properties');
    const geo = (props && child(props, 'PathGeometry')) || child(node, 'PathGeometry');
    const out = [];
    if (!geo) return out;
    for (const gp of geo.children) {
      if (gp.local !== 'GeometryPathType') continue;
      const arr = child(gp, 'PathPointArray');
      if (!arr) continue;
      const pts = [];
      for (const pp of arr.children) {
        if (pp.local !== 'PathPointType') continue;
        const a = nums(pp.attrs.Anchor);
        if (!a || a.length < 2) continue;
        const l = nums(pp.attrs.LeftDirection) || a;
        const r = nums(pp.attrs.RightDirection) || a;
        pts.push({ a: [a[0], a[1]], l: [l[0], l[1]], r: [r[0], r[1]] });
      }
      if (pts.length) out.push({ closed: gp.attrs.PathOpen !== 'true', pts });
    }
    return out;
  };

  const isRectPath = (sp) => {
    if (!sp.closed) return false;
    let pts = sp.pts;
    if (pts.length === 5 && pts[0].a[0] === pts[4].a[0] && pts[0].a[1] === pts[4].a[1]) pts = pts.slice(0, 4);
    if (pts.length !== 4) return false;
    for (const p of pts) if (p.l[0] !== p.a[0] || p.l[1] !== p.a[1] || p.r[0] !== p.a[0] || p.r[1] !== p.a[1]) return false;
    for (let i = 0; i < 4; i++) {
      const p = pts[i].a, q = pts[(i + 1) % 4].a;
      if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) return false;
    }
    return true;
  };

  const styleOf = (node, item) => {
    const fill = resolveColor(node.attrs.FillColor);
    const stroke = resolveColor(node.attrs.StrokeColor);
    item.fill = fill;
    item.stroke = stroke;
    if (stroke) {
      const w = parseFloat(node.attrs.StrokeWeight);
      item.strokeWidth = Number.isFinite(w) ? w : 1;
    }
    const ts = child(node, 'TransparencySetting');
    const bs = ts && child(ts, 'BlendingSetting');
    const op = bs ? parseFloat(bs.attrs.Opacity) : NaN;
    if (Number.isFinite(op) && op !== 100) item.opacity = r4(Math.max(0, Math.min(100, op)) / 100);
  };

  /** @returns {IdmlItem|null} item in spread coordinates */
  const processItem = (node, parentM) => {
    const loc = node.local;
    if (loc === 'Group') {
      const M = mul(parentM, matrixOf(node.attrs.ItemTransform));
      const kids = [];
      for (const c of node.children) {
        const it = processItem(c, M);
        if (it) kids.push(it);
      }
      if (!kids.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const k of kids) {
        const b = meta.get(k).aabb;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
      }
      /** @type {IdmlItem} */
      const g = { kind: 'group', x: x0, y: y0, width: x1 - x0, height: y1 - y0, children: kids };
      styleOf({ attrs: {}, children: node.children }, g);
      delete g.fill; delete g.stroke;
      meta.set(g, { aabb: [x0, y0, x1, y1] });
      return g;
    }
    if (loc !== 'Rectangle' && loc !== 'Oval' && loc !== 'Polygon' && loc !== 'GraphicLine' && loc !== 'TextFrame') {
      if (UNSUPPORTED_ITEMS.has(loc)) warnings.push(`Unsupported page item '${loc}' skipped.`);
      return null;
    }
    const M = mul(parentM, matrixOf(node.attrs.ItemTransform));
    const subs = readSubpaths(node);
    if (!subs.length) return null;
    const anchors = [];
    for (const sp of subs) for (const p of sp.pts) anchors.push(p.a);
    const lb = aabbOfPoints(anchors);
    const imgNode = loc === 'Rectangle' ? node.children.find((c) => IMAGE_NAMES.has(c.local)) : undefined;
    let kind;
    if (loc === 'Rectangle') kind = imgNode ? 'image' : subs.length === 1 && isRectPath(subs[0]) ? 'rect' : 'polygon';
    else if (loc === 'Oval') kind = subs.length === 1 && subs[0].closed && subs[0].pts.length === 4 ? 'ellipse' : 'polygon';
    else if (loc === 'Polygon') kind = 'polygon';
    else if (loc === 'GraphicLine') kind = 'line';
    else kind = 'text';

    /** @type {IdmlItem} */
    let item;
    let aabb;
    if (kind === 'polygon' || kind === 'line') {
      const path = subs.map((sp) => ({
        closed: sp.closed && kind !== 'line',
        points: sp.pts.map((p) => {
          const [x, y] = apply(M, p.a[0], p.a[1]);
          if (p.l[0] === p.a[0] && p.l[1] === p.a[1] && p.r[0] === p.a[0] && p.r[1] === p.a[1]) return [x, y];
          const [lx, ly] = apply(M, p.l[0], p.l[1]);
          const [rx, ry] = apply(M, p.r[0], p.r[1]);
          return { x, y, hx1: lx, hy1: ly, hx2: rx, hy2: ry };
        }),
      }));
      const all = [];
      for (const sp of path) for (const p of sp.points) all.push(Array.isArray(p) ? p : [p.x, p.y]);
      aabb = aabbOfPoints(all);
      item = { kind, x: aabb[0], y: aabb[1], width: aabb[2] - aabb[0], height: aabb[3] - aabb[1], path };
    } else {
      const sx = Math.hypot(M[0], M[1]);
      const sy = Math.hypot(M[2], M[3]);
      const w = (lb[2] - lb[0]) * sx;
      const h = (lb[3] - lb[1]) * sy;
      const [cx, cy] = apply(M, (lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2);
      item = { kind, x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      const rot = (Math.atan2(M[1], M[0]) * 180) / Math.PI;
      if (Math.abs(rot) > 1e-6) item.rotation = rot;
      const corners = [[lb[0], lb[1]], [lb[2], lb[1]], [lb[2], lb[3]], [lb[0], lb[3]]].map(([x, y]) => apply(M, x, y));
      aabb = aabbOfPoints(corners);
    }
    styleOf(node, item);
    if (kind === 'line') item.fill = null;
    if (kind === 'image') {
      const link = descendants(imgNode, 'Link')[0];
      item.link = (link && link.attrs.LinkResourceURI) || (imgNode.attrs.LinkResourceURI) ||
        'embedded:' + ((link && (link.attrs.Name || link.attrs.Self)) || imgNode.attrs.Self || 'image');
    }
    if (kind === 'text') {
      const story = node.attrs.ParentStory;
      if (story) {
        const prev = node.attrs.PreviousTextFrame;
        textFrames.push({ item, story, head: !prev || prev === 'n' });
      } else {
        item.text = { paragraphs: [] };
      }
    }
    meta.set(item, { aabb });
    return item;
  };

  const translate = (item, dx, dy) => {
    item.x += dx;
    item.y += dy;
    if (item.path) {
      for (const sp of item.path) {
        sp.points = sp.points.map((p) => (Array.isArray(p)
          ? [p[0] + dx, p[1] + dy]
          : { x: p.x + dx, y: p.y + dy, hx1: p.hx1 + dx, hy1: p.hy1 + dy, hx2: p.hx2 + dx, hy2: p.hy2 + dy }));
      }
    }
    if (item.children) for (const c of item.children) translate(c, dx, dy);
  };

  spreadSrcs.forEach((src, si) => {
    const root = parseFile(src, false);
    if (!root) {
      if (!files.has(src)) warnings.push(`Spread file ${src} listed in designmap.xml is missing.`);
      return;
    }
    const sp = child(root, 'Spread') || (root.local === 'Spread' ? root : null);
    if (!sp) {
      warnings.push(`${src} contains no Spread element.`);
      return;
    }
    const spreadPages = [];
    for (const pg of sp.children) {
      if (pg.local !== 'Page') continue;
      const gb = nums(pg.attrs.GeometricBounds);
      if (!gb || gb.length !== 4) {
        warnings.push(`Page '${pg.attrs.Name || pg.attrs.Self}' has no valid GeometricBounds; skipped.`);
        continue;
      }
      const m = matrixOf(pg.attrs.ItemTransform);
      const [ox, oy] = apply(m, gb[1], gb[0]);
      spreadPages.push({
        name: pg.attrs.Name || String(pages.length + spreadPages.length + 1),
        width: gb[3] - gb[1], height: gb[2] - gb[0], ox, oy, x: 0, y: 0, spread: si, items: [],
      });
    }
    if (!spreadPages.length) {
      warnings.push(`Spread '${sp.attrs.Self || src}' has no pages.`);
      return;
    }
    const minX = Math.min(...spreadPages.map((p) => p.ox));
    const minY = Math.min(...spreadPages.map((p) => p.oy));
    for (const p of spreadPages) {
      p.x = p.ox - minX;
      p.y = p.oy - minY;
    }
    for (const c of sp.children) {
      if (c.local === 'Page') continue;
      const it = processItem(c, IDENT);
      if (!it) continue;
      const b = meta.get(it).aabb;
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      let best = null;
      let bestArea = 0;
      for (const p of spreadPages) {
        if (cx >= p.ox && cx <= p.ox + p.width && cy >= p.oy && cy <= p.oy + p.height) {
          best = p;
          bestArea = Infinity;
          break;
        }
        const iw = Math.min(b[2], p.ox + p.width) - Math.max(b[0], p.ox);
        const ih = Math.min(b[3], p.oy + p.height) - Math.max(b[1], p.oy);
        if (iw > 0 && ih > 0 && iw * ih > bestArea) {
          best = p;
          bestArea = iw * ih;
        }
      }
      if (!best) {
        dropped++;
        continue;
      }
      translate(it, -best.ox, -best.oy);
      best.items.push(it);
    }
    for (const p of spreadPages) pages.push(p);
  });
  if (dropped) warnings.push(`${dropped} item(s) lie outside every page (pasteboard) and were dropped.`);

  // ---- assign story text to frames ----
  /** @type {Map<string, Array<{item: IdmlItem, head: boolean}>>} */
  const byStory = new Map();
  for (const f of textFrames) {
    if (!byStory.has(f.story)) byStory.set(f.story, []);
    byStory.get(f.story).push(f);
  }
  for (const [story, frames] of byStory) {
    const first = frames.find((f) => f.head) || frames[0];
    for (const f of frames) f.item.text = { paragraphs: f === first ? buildStory(story) : [] };
    if (frames.length > 1) {
      warnings.push(`Story '${story}' flows through ${frames.length} linked frames; the whole story was placed in the first frame.`);
    }
  }

  // ---- finalize numbers ----
  const finish = (it) => {
    it.x = r4(it.x); it.y = r4(it.y); it.width = r4(it.width); it.height = r4(it.height);
    if (it.rotation !== undefined) it.rotation = r4(it.rotation);
    if (it.path) {
      for (const sp of it.path) {
        sp.points = sp.points.map((p) => (Array.isArray(p)
          ? [r4(p[0]), r4(p[1])]
          : { x: r4(p.x), y: r4(p.y), hx1: r4(p.hx1), hy1: r4(p.hy1), hx2: r4(p.hx2), hy2: r4(p.hy2) }));
      }
    }
    if (it.children) it.children.forEach(finish);
  };
  for (const p of pages) p.items.forEach(finish);

  return {
    name: opts.name || 'Untitled',
    pages: pages.map((p) => ({ name: p.name, width: r4(p.width), height: r4(p.height), x: r4(p.x), y: r4(p.y), spread: p.spread, items: p.items })),
    colors,
    warnings,
  };
}

/** Converts a <Color> swatch element to '#rrggbb' or null. */
function colorHex(c) {
  const v = nums(c.attrs.ColorValue);
  if (!v) return null;
  const space = (c.attrs.Space || '').toUpperCase();
  if (space === 'RGB' && v.length >= 3) return toHex(v[0], v[1], v[2]);
  if (space === 'CMYK' && v.length >= 4) {
    const [r, g, b] = cmykToRgb(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100);
    return toHex(r, g, b);
  }
  if (space === 'LAB' && v.length >= 3) {
    const [r, g, b] = labToRgb(v[0], v[1], v[2]);
    return toHex(r, g, b);
  }
  return null;
}
