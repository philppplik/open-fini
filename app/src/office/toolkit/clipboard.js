// Office Toolkit: clipboard and delimited-text service. Spreadsheet ranges travel as TSV (what Excel, LibreOffice
// and Google Sheets put on the clipboard) plus an HTML table; slide and board objects as JSON in a private MIME type
// next to plain text and an image. The parsing half is pure and tested (tests/office/toolkit.test.js); the
// read/write half uses the async Clipboard API and degrades to text where the browser refuses.
//
// Public API
//   parseDelimited(text, sep = "\t" | ",", { maxRows, maxCols }) → string[][]   RFC 4180 quotes, CRLF/LF/CR
//   toDelimited(rows, sep = "\t") → string                                      quotes cells that need it
//   sniffSeparator(text) → "\t" | "," | ";"
//   rowsToHtml(rows) → "<table>…</table>"                                        escaped, for rich paste targets
//   writeClipboard({ text, html, json, png }) → Promise<boolean>                 json = { mime, data } (private)
//   readClipboard() → Promise<{ text, html, json, image }>                       whatever the browser allows
// Invariants: parse never throws; limits cut oversized input (default 100000 rows x 1000 columns); output of
// toDelimited parses back to the same cells.
export const OFFICE_CLIP_MIME = "web application/x-openfini-office+json";

export function parseDelimited(text, sep = "\t", { maxRows = 100000, maxCols = 1000 } = {}) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const s = String(text ?? "");
  const pushCell = () => {
    if (row.length < maxCols) row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (rows.length < maxRows) rows.push(row);
    row = [];
  };
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (ch === sep) {
      pushCell();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      pushRow();
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      if (rows.length >= maxRows) return rows;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== "" || row.length) pushRow();
  return rows;
}

export function toDelimited(rows, sep = "\t") {
  const q = (v) => {
    const t = v == null ? "" : String(v);
    return t.includes(sep) || /["\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(q).join(sep)).join("\r\n");
}

export function sniffSeparator(text) {
  const line = String(text).split(/\r?\n/, 1)[0] || "";
  const count = (c) => line.split(c).length - 1;
  const best = [["\t", count("\t")], [",", count(",")], [";", count(";")]].sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "\t";
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function rowsToHtml(rows) {
  return `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

/** Writes several representations at once; falls back to plain text. */
export async function writeClipboard({ text = "", html = null, json = null, png = null } = {}) {
  const cb = globalThis.navigator?.clipboard;
  if (!cb) return false;
  try {
    if (globalThis.ClipboardItem && (html || json || png)) {
      const parts = { "text/plain": new Blob([text], { type: "text/plain" }) };
      if (html) parts["text/html"] = new Blob([html], { type: "text/html" });
      if (png) parts["image/png"] = png instanceof Blob ? png : new Blob([png], { type: "image/png" });
      if (json && ClipboardItem.supports?.(OFFICE_CLIP_MIME)) parts[OFFICE_CLIP_MIME] = new Blob([JSON.stringify(json)], { type: OFFICE_CLIP_MIME });
      await cb.write([new ClipboardItem(parts)]);
      return true;
    }
    await cb.writeText(text);
    return true;
  } catch {
    try {
      await cb.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

export async function readClipboard() {
  const cb = globalThis.navigator?.clipboard;
  const out = { text: "", html: null, json: null, image: null };
  if (!cb) return out;
  try {
    if (cb.read) {
      for (const item of await cb.read()) {
        if (item.types.includes(OFFICE_CLIP_MIME)) out.json = JSON.parse(await (await item.getType(OFFICE_CLIP_MIME)).text());
        if (item.types.includes("text/html")) out.html = await (await item.getType("text/html")).text();
        if (item.types.includes("text/plain")) out.text = await (await item.getType("text/plain")).text();
        const img = item.types.find((x) => x.startsWith("image/"));
        if (img) out.image = new Uint8Array(await (await item.getType(img)).arrayBuffer());
      }
      return out;
    }
  } catch {
    /* permission denied or unsupported: fall back to text */
  }
  try {
    out.text = await cb.readText();
  } catch {
    /* nothing readable */
  }
  return out;
}
