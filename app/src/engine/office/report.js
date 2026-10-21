// A minimal import report collector with the same surface as core/import-report.js (kept / flattened / dropped / note),
// so the pure readers can fill either one. Pure.

export function createReport(format = "", file = "") {
  const items = [];
  const add = (status, text) => {
    if (text && !items.some((i) => i.status === status && i.text === text)) items.push({ status, text: String(text) });
    return r;
  };
  const r = {
    format,
    file,
    items,
    add,
    kept: (t) => add("kept", t),
    flattened: (t) => add("flattened", t),
    dropped: (t) => add("dropped", t),
    note: (t) => add("note", t),
    by: (s) => items.filter((i) => i.status === s).map((i) => i.text),
  };
  return r;
}

/** Copies the items of a pure report into another report object (for example an ImportReport). */
export function copyReport(from, to) {
  for (const i of from.items || []) to.add(i.status, i.text);
  return to;
}

/** Counter helper: adds "N things" once at the end. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
