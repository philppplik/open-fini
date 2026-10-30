// Spreadsheet formula engine: parser, functions, errors, cross-sheet references, the dependency graph and reference
// rewriting; number format codes (docs/office-sheet.md ▸ Formulas).
import test from "node:test";
import assert from "node:assert/strict";
import { createCalc, parseFormula, shiftFormula, adjustFormula, renameSheetInFormula, isErr } from "../../app/src/office/sheet/formula.js";
import { formatCode, fmtToCode, isDateCode } from "../../app/src/office/sheet/numfmt-code.js";
import { FUNCTION_NAMES } from "../../app/src/office/sheet/functions.js";

const wb = (cells, more = []) => ({ sheets: [{ id: "s1", name: "Sheet1", cells }, ...more] });
const v = (x) => (typeof x === "number" || typeof x === "boolean" ? { v: x } : typeof x === "string" && x.startsWith("=") ? { f: x.slice(1) } : { v: x });
function evalAll(map, more) {
  const cells = Object.fromEntries(Object.entries(map).map(([k, x]) => [k, v(x)]));
  const calc = createCalc(wb(cells, more));
  return (k) => {
    const r = calc.value("s1", k);
    return isErr(r) ? r.code : r;
  };
}

test("arithmetic, precedence, comparison and text", () => {
  const g = evalAll({ A1: "=1+2*3", A2: "=(1+2)*3", A3: "=-2^2", A4: "=2^3^2", A5: "=10%", A6: '="a"&1&TRUE', A7: '="abc"="ABC"', A8: "=1<\"a\"", A9: "=7/2", B1: "=1/0", B2: "=B3", B3: "=B2" });
  assert.equal(g("A1"), 7);
  assert.equal(g("A2"), 9);
  assert.equal(g("A3"), 4);
  assert.equal(g("A4"), 64);
  assert.equal(g("A5"), 0.1);
  assert.equal(g("A6"), "a1TRUE");
  assert.equal(g("A7"), true);
  assert.equal(g("A8"), true);
  assert.equal(g("A9"), 3.5);
  assert.equal(g("B1"), "#DIV/0!");
  assert.equal(g("B2"), "#CYCLE!");
  assert.equal(g("B3"), "#CYCLE!");
});

test("common functions", () => {
  const data = { A1: 10, A2: 20, A3: 30, A4: "x", B1: "apple", B2: "banana", B3: "cherry", C1: 1, C2: 2, C3: 3 };
  const cases = {
    "=SUM(A1:A4)": 60,
    "=AVERAGE(A1:A3)": 20,
    "=MIN(A1:A3)+MAX(A1:A3)": 40,
    "=COUNT(A1:A4)": 3,
    "=COUNTA(A1:B4)": 7,
    '=COUNTIF(A1:A3,">15")': 2,
    '=SUMIF(B1:B3,"b*",A1:A3)': 20,
    '=SUMIFS(A1:A3,C1:C3,">=2",B1:B3,"<>cherry")': 20,
    "=VLOOKUP(2,C1:C3,1,FALSE)": 2,
    '=VLOOKUP("banana",B1:C3,2,FALSE)': 2,
    '=XLOOKUP("cherry",B1:B3,A1:A3)': 30,
    '=XLOOKUP("kiwi",B1:B3,A1:A3,"none")': "none",
    '=INDEX(A1:A3,MATCH("banana",B1:B3,0))': 20,
    "=MATCH(25,A1:A3)": 2,
    '=IF(A1>5,"big","small")': "big",
    "=IFERROR(1/0,-1)": -1,
    "=ROUND(2.345,2)": 2.35,
    "=ROUNDUP(2.341,2)": 2.35,
    "=ROUNDDOWN(-2.349,2)": -2.34,
    '=TEXT(1234.567,"#,##0.00")': "1,234.57",
    '=TEXT(DATE(2026,10,28),"yyyy-mm-dd")': "2026-10-28",
    '=TEXT(0.256,"0.0%")': "25.6%",
    "=YEAR(DATE(2026,2,30))": 2026,
    "=MONTH(DATE(2026,2,30))": 3,
    "=EOMONTH(DATE(2026,1,15),1)-DATE(2026,2,28)": 0,
    '=LEFT("Hello",2)&MID("Hello",3,2)&RIGHT("Hello")': "Hello",
    '=LEN(TRIM("  a  b "))': 3,
    '=UPPER("ab")&LOWER("CD")&PROPER("eF gh")': "ABcdEf Gh",
    '=SUBSTITUTE("a-b-c","-","+")': "a+b+c",
    '=FIND("l","hello")': 3,
    '=SEARCH("L*O","hello")': 3,
    '=TEXTJOIN(", ",TRUE,B1:B3)': "apple, banana, cherry",
    '=CONCAT("a",B1)': "aapple",
    "=AND(A1>0,A2>0)": true,
    "=OR(A1>100,FALSE)": false,
    "=NOT(ISBLANK(A1))": true,
    "=ISERROR(1/0)": true,
    "=SUMPRODUCT(A1:A3,C1:C3)": 140,
    "=MEDIAN(A1:A3,100)": 25,
    "=MOD(-3,5)": 2,
    "=ABS(-2)+SQRT(16)+POWER(2,3)": 14,
    "=CHOOSE(2,\"a\",\"b\")": "b",
    "=PMT(0,10,1000)": -100,
    "=NA()": "#N/A",
    "=FOO(1)": "#NAME?",
    "=SUM(Sheet2!A1:A2)": 7,
    "='Other sheet'!B1*2": 10,
    "=Missing!A1": "#REF!",
    "=SUM(A:A)": 60,
    "=ROWS(A1:B3)*COLUMNS(A1:B3)": 6,
  };
  const cells = { ...data };
  const keys = Object.keys(cases).map((f, i) => {
    const k = `Z${i + 1}`;
    cells[k] = f;
    return [k, f];
  });
  const g = evalAll(cells, [
    { id: "s2", name: "Sheet2", cells: { A1: { v: 3 }, A2: { v: 4 } } },
    { id: "s3", name: "Other sheet", cells: { B1: { v: 5 } } },
  ]);
  for (const [k, f] of keys) assert.deepEqual(g(k), cases[f], f);
  assert.ok(FUNCTION_NAMES.length > 100);
});

test("dependency graph: only dependents recompute, chains do not overflow, volatile functions tick", () => {
  const cells = { A1: { v: 1 } };
  for (let i = 2; i <= 30000; i++) cells[`A${i}`] = { f: `A${i - 1}+1` };
  cells.B1 = { f: "SUM(A1:A30000)" };
  cells.C1 = { v: 5 };
  cells.C2 = { f: "C1*2" };
  const m = wb(cells);
  const calc = createCalc(m);
  assert.equal(calc.value("s1", "A30000"), 30000);
  assert.equal(calc.value("s1", "B1"), (30000 * 30001) / 2);
  assert.equal(calc.value("s1", "C2"), 10);
  const m2 = wb({ ...cells, C1: { v: 6 } });
  const changed = calc.update(m2);
  assert.ok(changed.has("s1!C2"));
  assert.ok(!changed.has("s1!B1"));
  assert.equal(calc.value("s1", "C2"), 12);
  const m3 = wb({ ...m2.sheets[0].cells, A1: { v: 2 } });
  calc.update(m3);
  assert.equal(calc.value("s1", "A30000"), 30001);
  // a formula that is added later and reads a range
  const m4 = wb({ ...m3.sheets[0].cells, D1: { f: "COUNT(A1:A10)" } });
  calc.update(m4);
  assert.equal(calc.value("s1", "D1"), 10);
});

test("reference rewriting: fill, insert, delete, rename", () => {
  assert.equal(shiftFormula("A1+$B$2+C$3+$D4", 1, 1), "B2+$B$2+D$3+$D5");
  assert.equal(shiftFormula("A1", -1, 0), "#REF!");
  assert.equal(shiftFormula('"A1"&A1', 1, 0), '"A1"&A2');
  const opts = { ownSheet: "Sheet1", sheet: "Sheet1", axis: "row", at: 2 };
  assert.equal(adjustFormula("SUM(A1:A10)+A5+Other!A5", { ...opts, n: 2 }), "SUM(A1:A12)+A7+Other!A5");
  assert.equal(adjustFormula("SUM(A1:A10)+A3", { ...opts, n: -2 }), "SUM(A1:A8)+#REF!");
  assert.equal(adjustFormula("Sheet1!B1+B1", { ownSheet: "Other", sheet: "Sheet1", axis: "col", at: 0, n: 1 }), "Sheet1!C1+B1");
  assert.equal(renameSheetInFormula("SUM(Sheet1!A1:A2)+'Sheet1'!B1", "Sheet1", "My data"), "SUM('My data'!A1:A2)+'My data'!B1");
  assert.throws(() => parseFormula("SUM(1,"));
  assert.throws(() => parseFormula('"open'));
});

test("number format codes", () => {
  assert.equal(formatCode(1234.5, "#,##0.00").text, "1,234.50");
  assert.equal(formatCode(-1234.5, '"$"#,##0.00_);("$"#,##0.00)').text, "($1,234.50)");
  assert.equal(formatCode(0.256, "0%").text, "26%");
  assert.equal(formatCode(12345, "0.00E+00").text, "1.23E+04");
  assert.equal(formatCode(46323.5, "yyyy-mm-dd hh:mm").text, "2026-10-28 12:00");
  assert.equal(formatCode(46323, "dddd, mmmm d").text, "Wednesday, October 28");
  assert.equal(formatCode(0.75, "h:mm AM/PM").text, "6:00 PM");
  assert.equal(formatCode(-5, "0;[Red]-0").color, "#ff0000");
  assert.equal(formatCode("abc", '@" kg"').text, "abc kg");
  assert.equal(formatCode(1.5, "General").text, "1.5");
  assert.equal(formatCode(1500000, "#,##0,\"k\"").text, "1,500k");
  assert.equal(fmtToCode({ type: "currency", currency: "EUR", decimals: 2 }), '#,##0.00 "€"');
  assert.equal(formatCode(3.5, fmtToCode({ type: "currency", currency: "EUR", decimals: 2 })).text, "3.50 €");
  assert.ok(isDateCode("dd.mm.yyyy"));
  assert.ok(!isDateCode("#,##0.00"));
});
