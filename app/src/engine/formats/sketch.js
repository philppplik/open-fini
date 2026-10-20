// Best-effort reader for Sketch (.sketch) files. A Sketch file is a ZIP archive of JSON documents
// (document.json, meta.json, pages/<id>.json) and bitmaps (images/...), a structure that is documented in Sketch's
// public file format reference. Only the common layer types are read; everything else is reported in `warnings`.
// Verified with synthetic fixtures built from that documentation; not with files saved by every Sketch version.
import { unzipSync } from '../../../vendor/fflate/fflate.js';

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const col = (c) => (c && typeof c.red === 'number' ? { color: `#${hex2(c.red)}${hex2(c.green)}${hex2(c.blue)}`, alpha: typeof c.alpha === 'number' ? c.alpha : 1 } : null);
const pt = (s) => {
  const m = /\{\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\}/.exec(String(s || ''));
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
};
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

function paints(style, warnings) {
  const fills = [];
  for (const f of style?.fills || []) {
    if (f.isEnabled === false) continue;
    if (f.fillType === 1 && f.gradient) {
      const g = f.gradient;
      const stops = (g.stops || []).map((s) => ({ o: num(s.position), ...(col(s.color) || { color: '#000000', alpha: 1 }) }));
      if (stops.length >= 2 && (g.gradientType === 0 || g.gradientType === 1)) fills.push({ type: g.gradientType === 1 ? 'radial' : 'linear', stops, from: pt(g.from), to: pt(g.to) });
      else if (stops.length) {
        fills.push({ type: 'solid', ...stops[0] });
        warnings.add('Angular gradients were replaced by their first color.');
      }
    } else if (f.fillType === 4) warnings.add('Pattern (image) fills were not imported.');
    else {
      const c = col(f.color);
      if (c) fills.push({ type: 'solid', ...c, alpha: c.alpha * num(f.contextSettings?.opacity, 1) });
    }
  }
  const borders = [];
  for (const b of style?.borders || []) {
    if (b.isEnabled === false) continue;
    const c = col(b.color);
    if (!c || !(b.thickness > 0)) continue;
    borders.push({ ...c, width: b.thickness, position: b.position === 1 ? 'inside' : b.position === 2 ? 'outside' : 'center', dash: style?.borderOptions?.dashPattern?.length ? style.borderOptions.dashPattern : null, cap: ['butt', 'round', 'square'][style?.borderOptions?.lineCapStyle] || 'butt', join: ['miter', 'round', 'bevel'][style?.borderOptions?.lineJoinStyle] || 'miter' });
  }
  if (style?.shadows?.some((s) => s.isEnabled) || style?.innerShadows?.some((s) => s.isEnabled)) warnings.add('Shadows were not imported.');
  if (style?.blur?.isEnabled) warnings.add('Blur effects were not imported.');
  return { fills, borders };
}

function pathData(layer) {
  const pts = layer.points || [];
  if (pts.length < 2) return null;
  const w = num(layer.frame?.width);
  const h = num(layer.frame?.height);
  const P = (p) => {
    const [x, y] = pt(p);
    return [x * w, y * h];
  };
  const f = (n) => Math.round(n * 1000) / 1000;
  const first = P(pts[0].point);
  let d = `M${f(first[0])} ${f(first[1])}`;
  const seg = (a, b) => {
    const pb = P(b.point);
    const c1 = a.hasCurveFrom ? P(a.curveFrom) : P(a.point);
    const c2 = b.hasCurveTo ? P(b.curveTo) : pb;
    if (!a.hasCurveFrom && !b.hasCurveTo) return ` L${f(pb[0])} ${f(pb[1])}`;
    return ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(pb[0])} ${f(pb[1])}`;
  };
  for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
  if (layer.isClosed) d += `${seg(pts[pts.length - 1], pts[0])} Z`;
  return d;
}

const ALIGN = ['left', 'right', 'center', 'justify'];

function readLayer(l, ctx) {
  if (!l || typeof l !== 'object') return null;
  const frame = l.frame || {};
  const base = { name: String(l.name || l._class || 'Layer'), x: num(frame.x), y: num(frame.y), width: Math.max(0, num(frame.width)), height: Math.max(0, num(frame.height)), rotation: -num(l.rotation), visible: l.isVisible !== false, locked: !!l.isLocked, opacity: num(l.style?.contextSettings?.opacity, 1) };
  if (l.isFlippedHorizontal || l.isFlippedVertical) ctx.warnings.add('Flipped layers were imported without the flip.');
  const { fills, borders } = paints(l.style, ctx.warnings);
  const kids = () => (l.layers || []).map((c) => readLayer(c, ctx)).filter(Boolean);
  switch (l._class) {
    case 'group':
      return { ...base, kind: 'group', children: kids() };
    case 'shapeGroup': {
      if ((l.layers || []).length > 1 && (l.layers || []).some((c) => c.booleanOperation > 0)) ctx.warnings.add('Boolean shape operations were imported as separate shapes.');
      const children = kids().map((c) => (c.kind === 'group' ? c : { ...c, fills: c.fills?.length ? c.fills : fills, borders: c.borders?.length ? c.borders : borders }));
      return { ...base, kind: 'group', children };
    }
    case 'rectangle':
      return { ...base, kind: 'rect', radius: num(l.fixedRadius) || Math.max(0, ...(l.points || []).map((p) => num(p.cornerRadius))), fills, borders };
    case 'oval':
      return { ...base, kind: 'ellipse', fills, borders };
    case 'shapePath':
    case 'polygon':
    case 'star':
    case 'triangle':
    case 'line': {
      const d = pathData(l);
      if (!d) return null;
      return { ...base, kind: 'path', d, fills: l.isClosed ? fills : [], borders: borders.length ? borders : l.isClosed ? [] : fills.map((f) => ({ ...f, width: 1, position: 'center' })), closed: !!l.isClosed };
    }
    case 'text': {
      const as = l.attributedString || {};
      const a0 = as.attributes?.[0]?.attributes || {};
      const font = a0.MSAttributedStringFontAttribute?.attributes || {};
      const c = col(a0.MSAttributedStringColorAttribute) || { color: '#000000', alpha: 1 };
      const name = String(font.name || 'Helvetica');
      return {
        ...base, kind: 'text',
        text: { string: String(as.string || '').replace(/\r\n?/g, '\n'), fontFamily: name.replace(/[-_ ](Bold|Italic|Regular|Medium|Light|Semibold|Black|Oblique).*$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2'), fontPostScript: name, fontSize: num(font.size, 14), color: c.color, align: ALIGN[l.style?.textStyle?.encodedAttributes?.paragraphStyle?.alignment ?? a0.paragraphStyle?.alignment] || 'left', fixedWidth: l.textBehaviour !== 0 },
        fills: [],
        borders: [],
      };
    }
    case 'bitmap': {
      const ref = l.image?._ref;
      if (!ref) return null;
      return { ...base, kind: 'image', imageRef: ref };
    }
    case 'symbolInstance':
      ctx.warnings.add('Symbol instances were not expanded; they are left out.');
      return null;
    case 'slice':
    case 'hotspot':
      return null;
    default:
      ctx.warnings.add(`Layers of type “${l._class || 'unknown'}” were not imported.`);
      return null;
  }
}

/** True when the bytes look like a Sketch archive (ZIP with document.json and a pages folder). */
export function isSketch(entries) {
  return !!(entries && entries['document.json'] && Object.keys(entries).some((k) => k.startsWith('pages/')));
}

/**
 * @param {Uint8Array|Record<string, Uint8Array>} input zip bytes or unzipped entries
 * @returns {{name: string, version: number|null, pages: {name: string, artboards: object[]}[], images: Record<string, Uint8Array>, warnings: string[]}}
 */
export function readSketch(input) {
  let entries = input;
  if (input instanceof Uint8Array) {
    try {
      entries = unzipSync(input, { filter: (f) => f.originalSize < 256 * 1024 * 1024 });
    } catch {
      throw new Error('This file is not a valid Sketch document (it is not a ZIP archive).');
    }
  }
  if (!isSketch(entries)) throw new Error('This ZIP archive is not a Sketch document (document.json or the pages folder is missing).');
  const dec = new TextDecoder();
  const json = (p) => {
    try {
      return JSON.parse(dec.decode(entries[p]));
    } catch {
      return null;
    }
  };
  const doc = json('document.json');
  const meta = json('meta.json') || {};
  if (!doc) throw new Error('The Sketch document.json could not be read.');
  const warnings = new Set();
  const ctx = { warnings };
  const refs = (doc.pages || []).map((p) => p._ref).filter(Boolean);
  const pageFiles = refs.length ? refs.map((r) => `${r}.json`) : Object.keys(entries).filter((k) => /^pages\/[^/]+\.json$/.test(k));
  const pages = [];
  for (const file of pageFiles) {
    const pj = json(file);
    if (!pj) {
      warnings.add(`A page could not be read (${file}).`);
      continue;
    }
    const artboards = [];
    const loose = [];
    for (const l of pj.layers || []) {
      if (l._class === 'artboard' || l._class === 'symbolMaster') {
        const bg = l.hasBackgroundColor ? col(l.backgroundColor) : null;
        artboards.push({ name: String(l.name || 'Artboard'), x: num(l.frame?.x), y: num(l.frame?.y), width: Math.max(1, num(l.frame?.width, 100)), height: Math.max(1, num(l.frame?.height, 100)), background: bg ? bg.color : null, items: (l.layers || []).map((c) => readLayer(c, ctx)).filter(Boolean) });
        if (l._class === 'symbolMaster') warnings.add('Symbol masters were imported as artboards.');
      } else {
        const it = readLayer(l, ctx);
        if (it) loose.push(it);
      }
    }
    if (loose.length) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const it of loose) {
        x0 = Math.min(x0, it.x);
        y0 = Math.min(y0, it.y);
        x1 = Math.max(x1, it.x + it.width);
        y1 = Math.max(y1, it.y + it.height);
      }
      artboards.push({ name: `${pj.name || 'Page'} (loose layers)`, x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), background: null, items: loose.map((it) => ({ ...it, x: it.x - x0, y: it.y - y0 })) });
    }
    pages.push({ name: String(pj.name || 'Page'), artboards });
  }
  const images = {};
  for (const [k, v] of Object.entries(entries)) if (k.startsWith('images/') && v.length) images[k] = v;
  if (!pages.some((p) => p.artboards.length)) throw new Error('This Sketch document has no artboards or layers that could be read.');
  return { name: '', version: typeof meta.version === 'number' ? meta.version : null, pages, images, warnings: [...warnings] };
}
