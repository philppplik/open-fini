/**
 * Minimal JPEG header reader used by the PDF writer to pass JPEG data through unchanged (`/DCTDecode`).
 *
 * @module jpeg-info
 */

/**
 * @typedef {Object} JpegInfo
 * @property {number} width
 * @property {number} height
 * @property {number} components   1 (gray), 3 (YCbCr / RGB) or 4 (CMYK / YCCK)
 * @property {number} bits         sample precision (8 for everything PDF can pass through)
 * @property {boolean} progressive
 * @property {boolean} adobe       an Adobe APP14 marker is present
 * @property {number} adobeTransform  Adobe transform flag (0 = none, 1 = YCbCr, 2 = YCCK), -1 when absent
 * @property {boolean} invertedCMYK  4 component data written by Adobe tools: values are inverted, a PDF `/Decode`
 *   array `[1 0 1 0 1 0 1 0]` is required to display it correctly
 */

/**
 * Parses the header of a JPEG file. Returns `null` for anything that is not a baseline / extended sequential /
 * progressive Huffman JPEG with 8 bit samples and 1, 3 or 4 components (the cases a PDF viewer can decode),
 * or when the data is truncated before the frame header.
 * @param {Uint8Array} bytes
 * @returns {JpegInfo|null}
 */
export function jpegInfo(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let adobe = false;
    let adobeTransform = -1;
    let i = 2;
    const n = bytes.length;
    while (i + 3 < n) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      let marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      i += 2;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) continue;
      if (marker === 0xd9) break;
      if (i + 2 > n) return null;
      const len = (bytes[i] << 8) | bytes[i + 1];
      if (len < 2) return null;
      if (marker === 0xee && len >= 14 && bytes[i + 2] === 0x41 && bytes[i + 3] === 0x64 && bytes[i + 4] === 0x6f && bytes[i + 5] === 0x62 && bytes[i + 6] === 0x65) {
        adobe = true;
        adobeTransform = bytes[i + 13];
      }
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return null; // lossless / differential / arithmetic
        if (i + 8 > n) return null;
        const bits = bytes[i + 2];
        const height = (bytes[i + 3] << 8) | bytes[i + 4];
        const width = (bytes[i + 5] << 8) | bytes[i + 6];
        const components = bytes[i + 7];
        if (bits !== 8 || !width || !height || (components !== 1 && components !== 3 && components !== 4)) return null;
        return {
          width,
          height,
          components,
          bits,
          progressive: marker === 0xc2,
          adobe,
          adobeTransform,
          invertedCMYK: components === 4 && adobe,
        };
      }
      i += len;
    }
    return null;
  } catch (_) {
    return null;
  }
}
