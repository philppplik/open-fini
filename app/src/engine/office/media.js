// Image helpers for office documents: type sniffing, intrinsic size without decoding, base64 / data URIs. Pure.

export const IMAGE_EXT = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

export function sniffImage(b, name = "") {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  const head = new TextDecoder().decode(b.subarray(0, Math.min(1024, b.length))).trimStart();
  // plain string steps instead of one nested-quantifier regex (CodeQL js/redos)
  let s = head.replace(/^<\?xml[^>]*>/, "").trimStart();
  for (let k = 0; k < 20 && s.startsWith("<!--"); k++) {
    const e = s.indexOf("-->");
    if (e < 0) break;
    s = s.slice(e + 3).trimStart();
  }
  s = s.replace(/^<!DOCTYPE[^>]*>/i, "").trimStart();
  if (/^<svg[\s>]/i.test(s) || (/\.svg$/i.test(name) && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** Intrinsic size in px ({w, h}) of PNG, JPEG, GIF, WebP (VP8X/VP8/VP8L) and SVG, or null. */
export function imageSize(b, mime = sniffImage(b)) {
  try {
    if (mime === "image/png" && b.length > 24) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
    if (mime === "image/gif" && b.length > 10) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
          i += 2;
          continue;
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
      return null;
    }
    if (mime === "image/webp" && b.length > 30) {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
      if (chunk === "VP8L") return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    }
    if (mime === "image/svg+xml") {
      const t = new TextDecoder().decode(b.subarray(0, Math.min(4096, b.length)));
      const tag = /<svg[^>]*>/i.exec(t)?.[0] || "";
      const num = (re) => {
        const m = re.exec(tag);
        return m && /^[\d.]+(px|pt)?$/.test(m[1]) ? parseFloat(m[1]) * (m[1].endsWith("pt") ? 4 / 3 : 1) : 0;
      };
      let w = num(/\bwidth\s*=\s*["']([^"']+)["']/i);
      let h = num(/\bheight\s*=\s*["']([^"']+)["']/i);
      const vb = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
      if ((!w || !h) && vb?.length === 4 && vb[2] > 0 && vb[3] > 0) {
        if (w) h = (w * vb[3]) / vb[2];
        else if (h) w = (h * vb[2]) / vb[3];
        else [w, h] = [vb[2], vb[3]];
      }
      return w && h ? { w, h } : null;
    }
  } catch {
    /* malformed header */
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}

export function fromBase64(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] || "A") & 63) << 6) | (B64.indexOf(clean[i + 3] || "A") & 63);
    out[o++] = n >> 16;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** Decodes a data: URI into { mime, bytes } (images only), or null. */
export function parseDataUri(uri, maxBytes = 30 * 1024 * 1024) {
  const m = /^data:([\w.+/-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,(.*)$/is.exec(String(uri || "").trim());
  if (!m || m[4].length > maxBytes * 1.4) return null;
  const bytes = m[3] ? fromBase64(m[4]) : new TextEncoder().encode(decodeURIComponent(m[4]));
  const mime = sniffImage(bytes) || (m[1] === "image/svg+xml" ? "image/svg+xml" : null);
  return mime ? { mime, bytes } : null;
}

export const dataUri = (mime, bytes) => `data:${mime};base64,${toBase64(bytes)}`;

/** Adds media to a model's media map and returns its id. */
export function addMedia(doc, { bytes, mime, name = "" }, prefix = "img") {
  let n = Object.keys(doc.media).length + 1;
  let id = `${prefix}${n}`;
  while (doc.media[id]) id = `${prefix}${++n}`;
  const size = imageSize(bytes, mime);
  doc.media[id] = { id, mime, name: String(name).slice(0, 200), bytes, ...(size ? { w: size.w, h: size.h } : {}) };
  return id;
}

/** A display size in points for an image of `px` pixels that fits `maxWidth` points. */
export function fitSize(size, maxWidth = 450) {
  const w = size?.w ? size.w * 0.75 : 200;
  const h = size?.h ? size.h * 0.75 : 150;
  const s = w > maxWidth ? maxWidth / w : 1;
  return { width: Math.round(w * s * 100) / 100, height: Math.round(h * s * 100) / 100 };
}
