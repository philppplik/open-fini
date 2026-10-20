// OpenRaster (.ora) reader and writer: a ZIP with `mimetype`, `stack.xml`, layer PNGs in `data/`, a merged image and a
// thumbnail. Public, open specification (openraster.org, baseline layer stack).
//
// Public API (pure, no DOM, no PNG codec: layer images stay PNG bytes and the host decodes/encodes them):
//   readOra(bytes) -> { width, height, layers: [{ name, x, y, opacity, visible, blend, png, parentIndex, kind }], mergedPng, warnings }
//     layers are bottom-to-top; stacks (groups) appear as kind 'group' BEFORE their children (like readPsd)
//   writeOra({ width, height, layers: [{ name, x, y, opacity, visible, blend, png }], mergedPng?, thumbnailPng? }) -> Uint8Array
// Invariants: archive entry count and decompressed sizes are capped; layer paths are normalized and never escape the
// archive; unknown composite operations fall back to normal with a warning.
import { unzipSync, zipSync, strFromU8, strToU8 } from '../../../vendor/fflate/fflate.js';
import { parseXml } from './idml.js';

const MAX_ENTRIES = 2000;
const MAX_TOTAL = 600 * 1024 * 1024;

const OPS = {
  'svg:src-over': 'normal', 'svg:multiply': 'multiply', 'svg:screen': 'screen', 'svg:overlay': 'overlay', 'svg:darken': 'darken', 'svg:lighten': 'lighten',
  'svg:color-dodge': 'color-dodge', 'svg:color-burn': 'color-burn', 'svg:hard-light': 'hard-light', 'svg:soft-light': 'soft-light', 'svg:difference': 'difference',
  'svg:exclusion': 'exclusion', 'svg:hue': 'hue', 'svg:saturation': 'saturation', 'svg:color': 'color', 'svg:luminosity': 'luminosity',
};
const OPS_BACK = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));

const normPath = (p) => {
  const parts = String(p || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  return parts.some((s) => s === '..') ? null : parts.join('/');
};

export function isOra(bytes) {
  if (!bytes || bytes.length < 60 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  let head = '';
  for (let i = 30; i < 100 && i < bytes.length; i++) head += String.fromCharCode(bytes[i]);
  return head.includes('mimetypeimage/openraster');
}

const attr = (el, name, d = '') => (el.attrs && el.attrs[name] !== undefined ? el.attrs[name] : d);

export function readOra(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize < 256 * 1024 * 1024 });
  } catch {
    throw new Error('This is not a valid OpenRaster file (the ZIP archive is damaged).');
  }
  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES) throw new Error('This OpenRaster archive has too many entries.');
  if (names.reduce((s, n) => s + files[n].length, 0) > MAX_TOTAL) throw new Error('This OpenRaster file is too large.');
  const byPath = new Map(names.map((n) => [normPath(n), files[n]]));
  const stackBytes = byPath.get('stack.xml');
  if (!stackBytes) throw new Error('This OpenRaster file has no stack.xml.');
  const xml = parseXml(strFromU8(stackBytes));
  const root = xml && (xml.name === 'image' ? xml : (xml.children || []).find((c) => c.name === 'image'));
  if (!root) throw new Error('The stack.xml of this OpenRaster file is not valid.');
  const width = Math.round(Number(attr(root, 'w', 0)));
  const height = Math.round(Number(attr(root, 'h', 0)));
  if (!(width > 0 && height > 0 && width * height <= 150e6)) throw new Error('This OpenRaster image has an invalid size.');
  const warnings = [];
  const layers = [];
  const walk = (stack, parentIndex, depth) => {
    // children are listed top-most first; OpenFini wants bottom-to-top
    const kids = (stack.children || []).filter((c) => c.name === 'layer' || c.name === 'stack').reverse();
    for (const k of kids) {
      const common = {
        name: attr(k, 'name') || (k.name === 'stack' ? 'Group' : 'Layer'),
        opacity: Math.max(0, Math.min(1, Number(attr(k, 'opacity', 1)) || 0)),
        visible: attr(k, 'visibility', 'visible') !== 'hidden',
        parentIndex,
        groupDepth: depth,
      };
      const op = attr(k, 'composite-op', 'svg:src-over');
      common.blend = OPS[op] || 'normal';
      if (!OPS[op]) warnings.push(`Blend mode “${op}” is not supported and was replaced by normal.`);
      if (k.name === 'stack') {
        const idx = layers.push({ ...common, kind: 'group', x: 0, y: 0, png: null }) - 1;
        walk(k, idx, depth + 1);
        continue;
      }
      const src = normPath(attr(k, 'src'));
      const png = src ? byPath.get(src) : null;
      if (!png) {
        warnings.push(`Layer “${common.name}” has no image data in the file and was skipped.`);
        continue;
      }
      layers.push({ ...common, kind: 'pixel', x: Math.round(Number(attr(k, 'x', 0)) || 0), y: Math.round(Number(attr(k, 'y', 0)) || 0), png });
    }
  };
  walk((root.children || []).find((c) => c.name === 'stack') || root, -1, 0);
  if (!layers.some((l) => l.kind === 'pixel')) warnings.push('The file has no readable layers.');
  return { width, height, layers, mergedPng: byPath.get('mergedimage.png') || null, warnings: [...new Set(warnings)] };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function writeOra({ width, height, layers, mergedPng, thumbnailPng }) {
  const files = { mimetype: [strToU8('image/openraster'), { level: 0 }] };
  const rows = [];
  layers.forEach((l, i) => {
    const src = `data/layer${i}.png`;
    files[src] = l.png;
    rows.push(
      `    <layer name="${esc(l.name || `Layer ${i + 1}`)}" src="${src}" x="${Math.round(l.x || 0)}" y="${Math.round(l.y || 0)}" opacity="${(l.opacity ?? 1).toFixed(3)}" visibility="${l.visible === false ? 'hidden' : 'visible'}" composite-op="${OPS_BACK[l.blend] || 'svg:src-over'}"/>`,
    );
  });
  // stack.xml lists the top-most layer first
  const stack = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${width}" h="${height}">\n  <stack opacity="1.0" name="root">\n${rows.reverse().join('\n')}\n  </stack>\n</image>\n`;
  files['stack.xml'] = strToU8(stack);
  if (mergedPng) files['mergedimage.png'] = mergedPng;
  if (thumbnailPng) files['Thumbnails/thumbnail.png'] = thumbnailPng;
  return zipSync(files, { level: 6 });
}
