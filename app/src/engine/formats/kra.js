// Krita (.kra) best-effort reader: a ZIP with `maindoc.xml`, per-layer data in a Krita-specific tiled format and, since
// Krita 4, a flattened `mergedimage.png` plus `preview.png`. Only the PNG images are read (documented, standard
// streams); the tiled layer data is not interpreted. The result is therefore a flattened image, never layers.
//
// Public API: readKraMerged(bytes) -> { png: Uint8Array, kind: 'merged' | 'preview', name: string, warnings }
// Invariants: pure, no DOM; archive entry sizes are capped; throws an Error with a readable message otherwise.
import { unzipSync } from '../../../vendor/fflate/fflate.js';

export function isKra(bytes) {
  if (!bytes || bytes.length < 60 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  let head = '';
  for (let i = 30; i < 100 && i < bytes.length; i++) head += String.fromCharCode(bytes[i]);
  return head.includes('mimetypeapplication/x-krita');
}

export function readKraMerged(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize < 256 * 1024 * 1024 });
  } catch {
    throw new Error('This is not a valid Krita file (the archive is damaged).');
  }
  const png = files['mergedimage.png'];
  const preview = files['preview.png'];
  const pick = png && png.length > 8 ? { png, kind: 'merged' } : preview && preview.length > 8 ? { png: preview, kind: 'preview' } : null;
  if (!pick) throw new Error('This Krita file contains no flattened image (it was saved by an old Krita version). Export it from Krita as PNG, PSD or OpenRaster.');
  const warnings = ['The layers of Krita files cannot be read; the flattened image was opened. For layers, export from Krita as OpenRaster (.ora) or PSD.'];
  if (pick.kind === 'preview') warnings.push('Only the small preview image of the file was found, so the resolution is low.');
  return { ...pick, name: 'Krita image', warnings };
}
