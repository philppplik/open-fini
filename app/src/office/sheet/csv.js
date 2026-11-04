// CSV / TSV for the Spreadsheet app: one sheet of values. Reading sniffs the separator (comma, semicolon, tab) and
// turns numbers, booleans, dates and "=formulas" into cells like typed input; writing exports the active sheet's
// computed values (dates in their display format, everything else raw). Pure; tests in tests/office/sheet-codecs.test.js.
//
// Public API: readDelimitedSheet(bytes, name) → workbook, writeDelimitedSheet(model, { calc, sep }) → Uint8Array
import { parseDelimited, toDelimited, sniffSeparator } from "../toolkit/clipboard.js";
import { newWorkbook, parseInput, activeSheet, usedRange } from "./model.js";
import { rcKey, isErr, toText } from "./formula.js";
import { formatCode, isDateCode } from "./numfmt-code.js";

export function readDelimitedSheet(bytes, name = "") {
  let text = new TextDecoder().decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = /\.tsv$/i.test(name) ? "\t" : sniffSeparator(text);
  const rows = parseDelimited(text, sep);
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = (String(name).replace(/\.[^.]+$/, "").replace(/[[\]:*?/\\']/g, "").slice(0, 31) || "Sheet1").trim() || "Sheet1";
  rows.forEach((row, r) =>
    row.forEach((text, c) => {
      const p = parseInput(text);
      if (!p) return;
      const cell = p.f !== undefined ? { f: p.f } : { v: p.v };
      if (p.nf) cell.s = { nf: p.nf };
      s.cells[rcKey(r, c)] = cell;
    }));
  return wb;
}

export function writeDelimitedSheet(model, { calc = null, sep = ",", sheetId = null } = {}) {
  const s = (sheetId && model.sheets.find((x) => x.id === sheetId)) || activeSheet(model);
  const used = usedRange(s);
  const rows = [];
  if (used) {
    for (let r = 0; r <= used.r1; r++) {
      const row = [];
      for (let c = 0; c <= used.c1; c++) {
        const k = rcKey(r, c);
        const cell = s.cells[k];
        let v = cell?.f !== undefined && calc ? calc.value(s.id, k) : cell?.v;
        if (isErr(v)) v = v.code;
        if (typeof v === "number" && cell?.s?.nf && isDateCode(cell.s.nf)) row.push(formatCode(v, cell.s.nf).text);
        else row.push(toText(v ?? null));
      }
      rows.push(row);
    }
  }
  const text = rows.length ? `${toDelimited(rows, sep).replace(/\r?\n/g, "\r\n")}\r\n` : "";
  return new TextEncoder().encode(text);
}
