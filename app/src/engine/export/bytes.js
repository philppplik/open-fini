// Small byte helpers shared by the export encoders (engine/export/*). Pure.

let CRC = null;
/** CRC-32 (PNG / zlib polynomial) of bytes[start, end). */
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Concatenates byte arrays. */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(String(s));

/** Latin-1 bytes; characters outside Latin-1 become "?". */
export const latin1 = (s) => Uint8Array.from([...String(s)], (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));

const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/**
 * XMP packet with Dublin Core metadata for image files (JPEG APP1, SVG <metadata>).
 * @param {{title?:string, author?:string, rights?:string, description?:string, keywords?:string|string[], creatorTool?:string, date?:Date}} m
 * @param {{wrapper?:boolean}} [o] wrapper: false returns the bare <x:xmpmeta> element (for SVG)
 */
export function xmpPacket(m, { wrapper = true } = {}) {
  const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(v)}</rdf:li></rdf:Alt>`;
  const kw = keywordList(m.keywords);
  let d = "";
  if (m.title) d += `<dc:title>${alt(m.title)}</dc:title>`;
  if (m.author) d += `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(m.author)}</rdf:li></rdf:Seq></dc:creator>`;
  if (m.description) d += `<dc:description>${alt(m.description)}</dc:description>`;
  if (m.rights) d += `<dc:rights>${alt(m.rights)}</dc:rights><xmpRights:Marked>True</xmpRights:Marked>`;
  if (kw.length) d += `<dc:subject><rdf:Bag>${kw.map((k) => `<rdf:li>${xmlEscape(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>`;
  if (m.creatorTool) d += `<xmp:CreatorTool>${xmlEscape(m.creatorTool)}</xmp:CreatorTool>`;
  if (m.date instanceof Date && !isNaN(+m.date)) d += `<xmp:CreateDate>${m.date.toISOString().replace(/\.\d{3}Z$/, "Z")}</xmp:CreateDate>`;
  const body =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">' +
    d +
    "</rdf:Description></rdf:RDF></x:xmpmeta>";
  return wrapper ? `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${body}\n<?xpacket end="w"?>` : body;
}

/** "a, b; c" or ["a", "b"] -> trimmed, non-empty keywords. */
export function keywordList(k) {
  const list = Array.isArray(k) ? k : String(k || "").split(/[,;]/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}
