import test from "node:test";
import assert from "node:assert/strict";
import { niceTicks, logTicks, makeScale, stackSeries, pieAngles, arcPath, roundRectPath, smoothPathData } from "../../app/src/engine/layout/chart-geometry.js";
import { CHART_PRESETS, CHART_TYPE_IDS, chartFromPreset, normalizeChart, matrixToData, dataToMatrix, resolveData, sortData, describeChart } from "../../app/src/engine/layout/chart-data.js";
import { renderChart } from "../../app/src/engine/layout/chart-render.js";
import { approxMeasurer } from "../../app/src/engine/layout/measurers.js";
import { createTable } from "../../app/src/engine/layout/table-model.js";
import { layoutTable, tableItems, cellAt, cellRect } from "../../app/src/engine/layout/table-render.js";
import { displayListToSVG } from "../../app/src/engine/backends/svg.js";
import { createPDF } from "../../app/src/engine/backends/pdf.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("niceTicks produces 1-2-5 steps and respects pinned bounds", () => {
  const t = niceTicks(0, 87, 5);
  assert.equal(t.min, 0);
  assert.equal(t.max, 100);
  assert.deepEqual(t.ticks, [0, 20, 40, 60, 80, 100]);
  const n = niceTicks(-3, 12, 5);
  assert.ok(n.min <= -3 && n.max >= 12);
  assert.ok(n.ticks.includes(0));
  const f = niceTicks(2, 4.7, 5, { fixedMin: 2, fixedMax: 5 });
  assert.equal(f.min, 2);
  assert.equal(f.max, 5);
  const flat = niceTicks(7, 7);
  assert.ok(flat.max > flat.min && flat.step > 0);
  assert.deepEqual(logTicks(3, 4200).ticks, [1, 10, 100, 1000, 10000]);
});

test("scales map and invert", () => {
  const s = makeScale(0, 100, 200, 0);
  near(s(0), 200);
  near(s(100), 0);
  near(s(25), 150);
  near(s.invert(150), 25);
  const l = makeScale(1, 1000, 0, 300, true);
  near(l(10), 100);
  near(l.invert(200), 100);
});

test("stacking separates positive and negative values and percent sums to 100", () => {
  const st = stackSeries([[10, -5, 2], [20, -5, 0], [5, 5, 8]]);
  assert.deepEqual(st[0][0], { y0: 0, y1: 10, v: 10 });
  assert.deepEqual(st[1][0], { y0: 10, y1: 30, v: 20 });
  assert.deepEqual(st[2][0], { y0: 30, y1: 35, v: 5 });
  assert.deepEqual([st[0][1].y0, st[0][1].y1], [0, -5]);
  assert.deepEqual([st[1][1].y0, st[1][1].y1], [-5, -10]);
  assert.deepEqual([st[2][1].y0, st[2][1].y1], [0, 5]);
  const p = stackSeries([[1, 3], [3, 1]], { percent: true });
  near(p[0][0].y1, 25);
  near(p[1][0].y1, 100);
  near(p[1][1].y1, 100);
});

test("pie angles start at 12 o'clock, run clockwise and cover a full turn", () => {
  const a = pieAngles([1, 1, 2]);
  near(a[0].a0, -Math.PI / 2);
  near(a[0].a1, 0);
  near(a[1].a1, Math.PI / 2);
  near(a[2].a1, (3 * Math.PI) / 2);
  near(a[2].frac, 0.5);
  const z = pieAngles([0, 5, null, -2, 5]);
  assert.deepEqual(z.map((s) => s.index), [1, 4]);
  assert.deepEqual(pieAngles([0, 0]), []);
});

test("arc and rounded rect paths are closed and finite", () => {
  for (const d of [arcPath(50, 50, 0, 40, 0, 2), arcPath(50, 50, 20, 40, 0, 7), roundRectPath(0, 0, 20, 10, [4, 4, 0, 0]), smoothPathData([[0, 0], [10, 5], [20, 2], null, [30, 3], [40, 9]])]) {
    for (const c of d) for (const v of c.slice(1)) assert.ok(Number.isFinite(v));
  }
  assert.equal(arcPath(0, 0, 0, 10, 0, 1).at(-1)[0], "Z");
  // arc endpoints lie on the radius
  const c = arcPath(0, 0, 0, 10, 0, Math.PI / 2);
  const last = c.find((x) => x[0] === "L");
  near(last[1], 0);
});

test("data helpers: matrix round trip, linked tables, sorting, normalization", () => {
  const d = matrixToData([["", "A", "B"], ["x", "1", "2"], ["y", "$3", ""]]);
  assert.deepEqual(d.categories, ["x", "y"]);
  assert.deepEqual(d.series[0].values, [1, 3]);
  assert.deepEqual(d.series[1].values, [2, null]);
  assert.deepEqual(matrixToData([["", "x", "y"], ["A", "1", "2"]], { seriesIn: "rows" }).series[0].values, [1, 2]);
  assert.equal(dataToMatrix(d)[0][1], "A");
  const t = createTable({ data: [["", "Sales"], ["Q1", "10"], ["Q2", "=B2*3"]], headerRows: 1 });
  const chart = normalizeChart({ type: "column", source: { tableId: "t1" }, data: { categories: [], series: [] } });
  const r = resolveData(chart, (id) => (id === "t1" ? t : null));
  assert.equal(r.linked, true);
  assert.deepEqual(r.data.series[0].values, [10, 30]);
  assert.equal(resolveData(chart, () => null).missing, true);
  const ranged = resolveData({ ...chart, source: { tableId: "t1", range: "A1:B2" } }, () => t);
  assert.deepEqual(ranged.data.categories, ["Q1"]);
  const s = sortData({ categories: ["a", "b", "c"], series: [{ name: "s", values: [2, 9, 5] }] }, "desc");
  assert.deepEqual(s.categories, ["b", "c", "a"]);
  const n = normalizeChart({ type: "nope", data: { categories: ["a"], series: [{ name: "s", values: ["12", "x", 3] }] } });
  assert.equal(n.type, "column");
  assert.deepEqual(n.data.series[0].values, [12, null, 3]);
  assert.equal(n.data.categories.length, 3);
});

function itemsOk(items) {
  const bad = [];
  const visit = (it) => {
    if (it.t === "group") return it.items.forEach(visit);
    if (it.t === "path") for (const c of it.d) for (const v of c.slice(1)) if (!Number.isFinite(v)) bad.push(it);
    if (it.t === "text") for (const r of it.runs) if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width)) bad.push(r);
  };
  items.forEach(visit);
  return bad.length === 0;
}

test("every gallery preset and chart type renders finite geometry, SVG and PDF", () => {
  assert.ok(CHART_PRESETS.length >= 10);
  for (const type of CHART_TYPE_IDS) assert.ok(CHART_PRESETS.some((p) => p.type === type), `no preset for ${type}`);
  for (const p of CHART_PRESETS) {
    const chart = chartFromPreset(p.id);
    for (const [w, h] of [[480, 300], [160, 90], [900, 500]]) {
      const { items } = renderChart(chart, chart.data, w, h, approxMeasurer);
      assert.ok(items.length > 1, p.id);
      assert.ok(itemsOk(items), `${p.id} ${w}x${h}`);
    }
    const { items } = renderChart(chart, chart.data, 480, 300, approxMeasurer);
    const svg = displayListToSVG({ width: 480, height: 300, items }, {});
    assert.ok(svg.includes("<svg") && !svg.includes("NaN"), p.id);
    const pdf = createPDF([{ width: 480, height: 300, items }], { compress: false });
    assert.ok(pdf.length > 500, p.id);
  }
});

test("chart renders options: dark theme, log axis, horizontal, empty data, stacked negatives", () => {
  const base = chartFromPreset("stacked");
  for (const options of [{ theme: "dark", background: "#111827" }, { log: true }, { legend: "right", gridlines: false, xTitle: "X", yTitle: "Y" }, { dataLabels: true, legend: "top" }]) {
    const c = normalizeChart({ ...base, options: { ...base.options, ...options } });
    assert.ok(itemsOk(renderChart(c, c.data, 480, 300, approxMeasurer).items), JSON.stringify(options));
  }
  const empty = normalizeChart({ type: "line", data: { categories: [], series: [] } });
  assert.ok(itemsOk(renderChart(empty, empty.data, 300, 200, approxMeasurer).items));
  const neg = normalizeChart({ type: "stacked-bar", data: { categories: ["a", "b"], series: [{ name: "x", values: [5, -3] }, { name: "y", values: [-2, 4] }] } });
  assert.ok(itemsOk(renderChart(neg, neg.data, 400, 300, approxMeasurer).items));
  const tiny = chartFromPreset("pie");
  assert.ok(itemsOk(renderChart(tiny, tiny.data, 30, 30, approxMeasurer).items));
});

test("column geometry: bar heights follow the value scale", () => {
  const c = normalizeChart({ type: "column", options: { radius: 0, legend: "none", gridlines: false }, data: { categories: ["a", "b"], series: [{ name: "s", values: [50, 100] }] } });
  const { items, plot } = renderChart(c, c.data, 400, 300, approxMeasurer);
  const bars = items.find((i) => i.t === "path" && i.fill && i.d.length === 10);
  assert.ok(bars && plot);
  const rect = (k) => {
    const pts = bars.d.slice(k * 5, k * 5 + 5).filter((x) => x[0] !== "Z");
    const ys = pts.map((p) => p[2]);
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  const a = rect(0);
  const b = rect(1);
  near(a.bottom, b.bottom, 1e-6);
  near((a.bottom - a.top) * 2, b.bottom - b.top, 1e-6);
  assert.ok(b.top >= plot.y - 1e-6 && b.bottom <= plot.y + plot.h + 1e-6);
});

test("describeChart summarizes data for alt text", () => {
  const c = chartFromPreset("column");
  const t = describeChart(c, c.data);
  assert.match(t, /Column chart titled/);
  assert.match(t, /peaks at/);
});

test("table render: layout, hit testing, merged cells and export", () => {
  const t = createTable({ rows: 3, cols: 3, headerRows: 1, data: [["Name", "Qty", "Price"], ["Apples and a very long description that wraps", "3", "1.5"], ["Pears", "=B2*2", "2"]], width: 300, rowHeight: 30 });
  t.colFmt[2] = { type: "currency" };
  t.cells[2][0].fill = "#ffee00";
  const lay = layoutTable(t, approxMeasurer);
  assert.equal(lay.colX.length, 4);
  assert.ok(lay.rowHeights[1] > 30, "long text grows the row");
  near(lay.w, 300);
  const items = tableItems(t, lay);
  assert.ok(itemsOk(items));
  const text = items.find((i) => i.t === "text");
  const all = text.runs.map((r) => r.text).join("|");
  assert.match(all, /\$1\.50/);
  assert.match(all, /6/);
  const hit = cellAt(lay, lay.colX[1] + 2, lay.rowY[2] + 2);
  assert.deepEqual(hit, { r: 2, c: 1 });
  assert.equal(cellAt(lay, -50, -50), null);
  const svg = displayListToSVG({ width: 400, height: 300, items }, {});
  assert.ok(svg.includes("<text") && !svg.includes("NaN"));
  assert.ok(createPDF([{ width: 400, height: 300, items }], { compress: false }).length > 500);
  assert.deepEqual(cellRect(lay, t, 0, 0).w, lay.colX[1]);
});
