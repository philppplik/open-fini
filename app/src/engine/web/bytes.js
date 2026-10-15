// Small byte/text helpers shared by preview.js and site.js (pure, no Node-only APIs).

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 of a byte array (no btoa/Buffer dependency, safe for large inputs).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  const n = bytes.length;
  const parts = [];
  let chunk = "";
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (i < n) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const v = (a << 16) | (b << 8);
    chunk += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < n ? B64[(v >> 6) & 63] : "=") + "=";
  }
  parts.push(chunk);
  return parts.join("");
}

/**
 * UTF-8 bytes of a string.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

/**
 * Decodes UTF-8 bytes (a leading byte order mark is removed).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf8Text(bytes) {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/**
 * `data:` URL for bytes.
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @returns {string}
 */
export function dataUrl(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/**
 * 1-based line number of an offset.
 * @param {string} source
 * @param {number} offset
 * @returns {number}
 */
export function lineOf(source, offset) {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let i = source.indexOf("\n"); i >= 0 && i < end; i = source.indexOf("\n", i + 1)) line++;
  return line;
}
