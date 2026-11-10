// Design checks and assets (group "Design checks and assets"): work a designer does by rule, without an image model.
//   lint_design / fix_design_issues   contrast, tiny text, near-miss alignment, uneven gaps, off-grid, overlaps …
//   generate_asset                    procedural vectors: patterns, blobs, dividers, placeholders, QR and Code 128
//   make_palette / extract_palette    harmonies, 50-900 scales with text colors; the colors a page really uses
//   type_scale / column_grid          modular type sizes; column positions for a page width
//   list_merge_fields / data_merge    <<Field>> placeholders filled from records, one page per record
// Pure logic lives in ../design-lib.js (lazy). The session supplies ctx.lookup (see power.js).
// Modules the app loads at start-up are imported statically here: a dynamic import() would make each its own entry
// chunk and split the start-up bundle.
import { tool, S, requireDoc } from "./helpers.js";
import { historyMark, mergeSince } from "../../extensions/history.js";
import { exportRaster } from "../../core/io.js";
import * as DM from "../../engine/layout/data-merge.js";
import { resultValue } from "../query.js";
import { pageFacts } from "./power.js";

/** pageFacts plus what the linter needs: text color and alt text. */
function lintInput(app, pg) {
  const doc = app.doc;
  const flat = pageFacts(app, pg, { maxText: 200 }).flat;
  for (const f of flat) {
    const n = doc.find(f.id);
    if (!n) continue;
    if (n.type === "text") f.color = doc.stories[n.storyId]?.defaults?.char?.color || "#000000";
    if (n.alt) f.alt = n.alt;
  }
  return flat;
}

export function designAssistTools(app, ctx) {
  const lib = () => import("../design-lib.js");
  const lookup = (name) => {
    const t = ctx.lookup?.(name);
    if (!t) throw new Error(`The tool “${name}” is not available here.`);
    return t;
  };
  const pagesOf = (a) => {
    const doc = requireDoc(app);
    if (!doc.pages) throw new Error("This works on canvas documents (Vector, Pixel, Layout).");
    if (a.pageId && !doc.page(a.pageId)) throw new Error(`No page “${a.pageId}”. Pages: ${doc.pages.map((p) => p.id).join(", ")}.`);
    return a.scope === "document" ? doc.pages : [(a.pageId && doc.page(a.pageId)) || app.page];
  };
  const lintAll = async (a) => {
    const { lintFacts } = await lib();
    const out = [];
    for (const pg of pagesOf(a)) {
      const r = lintFacts(lintInput(app, pg), { w: pg.w, h: pg.h, bg: pg.bg }, { minFont: a.minFontSize, grid: a.grid, tolerance: a.tolerance, rules: a.rules });
      out.push({ page: pg.id, name: pg.name, ...r });
    }
    return out;
  };
  const LINT_PROPS = {
    scope: S.str("page (default: active page, or pageId) or document (every page)", { enum: ["page", "document"] }),
    pageId: S.str("Page id"),
    rules: { type: "array", items: { type: "string", enum: ["contrast", "tiny-text", "empty-text", "off-page", "off-grid", "near-align", "uneven-spacing", "text-overlap", "missing-alt", "near-colors", "many-fonts"] }, description: "Only these rules (default: all)" },
    minFontSize: S.num("Smallest acceptable text size in px (default 11)", { minimum: 1 }),
    grid: S.num("Grid in px for the off-grid rule (off when omitted)", { minimum: 1 }),
    tolerance: S.num("Px within which edges and gaps count as “almost equal” (default 3)", { minimum: 0.5, maximum: 20 }),
  };

  return [
    tool("lint_design", "Checks a page or the whole document like a careful designer: text contrast (WCAG), tiny or empty text, layers outside the page, off-grid positions, edges that miss each other by a pixel or two, almost-equal gaps, overlapping text, images without alt text, near-duplicate colors, too many fonts or sizes. Every issue names its layers and most carry a ready fix (a tool call). Run it before you call a design finished; fix_design_issues applies the fixes.", LINT_PROPS, [], async (a) => {
      const pages = await lintAll(a);
      const total = pages.reduce((s, p) => s + p.total, 0);
      return { total, fixable: pages.reduce((s, p) => s + p.fixable, 0), pages: pages.map((p) => ({ page: p.page, name: p.name, counts: p.counts, issues: p.issues, ...(p.total > p.issues.length ? { more: p.total - p.issues.length } : {}) })), note: total ? "Issues with a fix can be applied with fix_design_issues (or call the fix yourself)." : "No issues found." };
    }, { readOnly: true }),

    tool("fix_design_issues", "Applies the automatic fixes of lint_design in one undo step: recolors low-contrast text, raises tiny text to the minimum, deletes empty text layers, snaps to the grid, closes near-miss alignments, evens out gaps and merges near-duplicate colors. Give the same options as lint_design; rules limits what is fixed. Issues without an automatic fix are returned as remaining.", { ...LINT_PROPS, dryRun: S.bool("Only list the fixes that would run") }, [], async (a, c) => {
      const doc = requireDoc(app);
      const mark = historyMark(doc.history);
      let applied = 0;
      const failed = [];
      const planned = [];
      // several passes: aligning layers changes the gaps between them, so lint again until nothing fixable is left
      for (let pass = 0; pass < 4; pass++) {
        const fixes = (await lintAll(a)).flatMap((p) => p.issues.filter((i) => i.fix).map((i) => ({ ...i, page: p.page })));
        if (!fixes.length) break;
        if (a.dryRun) {
          planned.push(...fixes.map((f) => ({ rule: f.rule, ids: f.ids, fix: f.fix })));
          break;
        }
        let progressed = 0;
        for (const f of fixes) {
          try {
            resultValue(await lookup(f.fix.tool).run(f.fix.args, c));
            applied++;
            progressed++;
          } catch (err) {
            failed.push({ rule: f.rule, ids: f.ids, error: String(err?.message || err) });
          }
        }
        if (!progressed) break;
      }
      if (a.dryRun) return { dryRun: true, fixes: planned.slice(0, 100), count: planned.length };
      if (app.doc === doc && applied) {
        mergeSince(doc.history, mark, "AI: Fix design issues");
        const top = doc.history.entries[doc.history.index - 1];
        if (top && doc.history.tag && !top.tag) top.tag = doc.history.tag;
      }
      const after = await lintAll(a);
      return { applied, ...(failed.length ? { failed: failed.slice(0, 20) } : {}), remaining: after.reduce((s, p) => s + p.total, 0), remainingIssues: after.flatMap((p) => p.issues).slice(0, 30).map((i) => ({ rule: i.rule, ids: i.ids, message: i.message })) };
    }),

    tool("generate_asset", "Creates a vector asset by rule, with no image model, and places it on the page as editable paths: patterns (dots, grid, stripes, checker, waves, triangles, crosses, confetti), shapes (blob, wave-divider, sunburst, rings), a placeholder box with a label, a QR code or a Code 128 barcode. Same seed, same result. x and y are the center on the page.", {
      kind: S.str("What to make", { enum: ["dots", "grid", "stripes", "checker", "waves", "triangles", "crosses", "confetti", "blob", "wave-divider", "sunburst", "rings", "placeholder", "qr", "barcode"] }),
      width: S.num("Width in px (default 400)", { minimum: 8, maximum: 8000 }), height: S.num("Height in px (default: square; dividers and barcodes 120)", { minimum: 8, maximum: 8000 }),
      x: S.num("Center x on the page (default: page center)"), y: S.num("Center y on the page (default: page center)"),
      color: S.str("Main color #rrggbb (default #111827)"), colors: { type: "array", items: { type: "string" }, description: "Several colors for triangles and confetti" }, background: S.str("Background color (default none; QR and barcode white)"),
      cell: S.num("Pattern cell size in px (default 24)", { minimum: 2 }), size: S.num("Detail size: dot radius, line or band width, wave height, blob wobble 0-0.9"),
      angle: S.num("Stripe angle in degrees (default 45)"), count: S.num("Number of items: confetti pieces, blob points, rays, rings, wave humps", { minimum: 1, maximum: 4000 }),
      seed: S.num("Random seed (default 1)"), text: S.str("Content for qr and barcode, label for placeholder"), name: S.str("Layer name"),
    }, ["kind"], async (a, c) => {
      requireDoc(app);
      const { generateSvg } = await lib();
      const opts = { ...a };
      if (a.kind === "qr") {
        if (!a.text) throw new Error("Give the text or URL for the QR code.");
        const { encodeQR, qrToSvgPath } = await import("../../collab/qr.js");
        const qr = encodeQR(a.text);
        opts.qrPath = { d: qrToSvgPath(qr), size: qr.size };
      }
      if (a.kind === "barcode" && !a.text) throw new Error("Give the text for the barcode.");
      const g = generateSvg(a.kind, opts);
      const pg = app.page;
      const r = resultValue(await lookup("import_svg").run({ svg: g.svg, x: a.x ?? pg.w / 2, y: a.y ?? pg.h / 2, name: a.name || `${a.kind[0].toUpperCase()}${a.kind.slice(1)}` }, c));
      if (g.label && r?.id) {
        const cx = a.x ?? pg.w / 2;
        const cy = a.y ?? pg.h / 2;
        await lookup("add_text").run({ text: g.label, x: cx - g.width / 2, y: cy - g.fontSize * 0.65, w: g.width, align: "center", fontSize: g.fontSize, color: "#4b5563", name: "Label", parentId: r.id }, c);
      }
      return { id: r?.id ?? null, kind: a.kind, width: Math.round(g.width), height: Math.round(g.height), ...(g.modules ? { modules: g.modules } : {}), note: a.kind === "qr" || a.kind === "barcode" ? "Keep the white quiet zone and do not distort it; test the code with a scanner before printing." : "Placed as a group of paths; use set_style or transform_layers to adjust." };
    }),

    tool("make_palette", "Builds a color palette from one base color by color theory instead of guessing: a harmony (complementary, analogous, triadic, tetradic, split-complementary, monochrome) and a 50-900 tint and shade scale, each with the readable text color (black or white) and its WCAG contrast.", {
      base: S.str("Base color #rrggbb"),
      scheme: S.str("Harmony (default analogous)", { enum: ["complementary", "analogous", "triadic", "tetradic", "split-complementary", "monochrome"] }),
      scale: S.bool("Also return the 50-900 scale of the base color (default true)"),
    }, ["base"], async (a) => {
      const { harmony, colorScale, bestTextColor } = await lib();
      const { contrastRatio } = await import("../script-lib.js");
      const info = (c) => ({ color: c, text: bestTextColor(c), contrast: contrastRatio(bestTextColor(c), c) });
      return { scheme: a.scheme || "analogous", harmony: harmony(a.base, a.scheme || "analogous").map(info), ...(a.scale === false ? {} : { scale: Object.fromEntries(Object.entries(colorScale(a.base)).map(([k, c]) => [k, info(c)])) }) };
    }, { readOnly: true }),

    tool("extract_palette", "Returns the colors a page or the document really uses (fills, strokes, text), most used first, with use counts. With from: “render” it samples the rendered page instead, which includes photos and gradients.", {
      scope: S.str("page (default) or document", { enum: ["page", "document"] }), pageId: S.str("Page id"),
      from: S.str("layers (default) or render", { enum: ["layers", "render"] }), max: S.num("Number of colors (default 8)", { minimum: 2, maximum: 32 }),
    }, [], async (a) => {
      const { paletteFromFacts } = await lib();
      const pages = pagesOf(a);
      if (a.from !== "render") return { colors: paletteFromFacts(pages.flatMap((pg) => lintInput(app, pg)), { max: a.max || 8 }) };
      if (typeof OffscreenCanvas === "undefined") throw new Error("Sampling the render needs the app window; use from: “layers”.");
      const { quantize } = await import("../../engine/export/quantize.js");
      const pg = pages[0];
      const k = Math.min(1, 160 / Math.max(pg.w, pg.h));
      const r = await exportRaster(app, { page: pg, format: "png", scale: k });
      const bmp = await createImageBitmap(new Blob([r.bytes], { type: "image/png" }));
      const cv = new OffscreenCanvas(r.width, r.height);
      const g = cv.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const data = g.getImageData(0, 0, r.width, r.height).data;
      const q = quantize(data, r.width, r.height, { colors: a.max || 8 });
      const counts = new Map();
      for (let i = 0; i < q.indices.length; i++) counts.set(q.indices[i], (counts.get(q.indices[i]) || 0) + 1);
      const hex = (i) => `#${[0, 1, 2].map((c) => q.palette[i * 4 + c].toString(16).padStart(2, "0")).join("")}`; // palette: flat RGBA
      return { colors: [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([i, n]) => ({ color: hex(i), share: Math.round((n / q.indices.length) * 1000) / 10 })) };
    }, { readOnly: true }),

    tool("type_scale", "Computes a modular type scale (font sizes that belong together) with line heights and role names (caption, small, body, h6 … h1, display). Use the sizes with add_text and set_style instead of picking sizes by feel.", {
      base: S.num("Body size in px (default 16)", { minimum: 4, maximum: 200 }),
      ratio: { anyOf: [{ type: "number" }, { type: "string", enum: ["minor-second", "major-second", "minor-third", "major-third", "perfect-fourth", "augmented-fourth", "perfect-fifth", "golden"] }], description: "Scale ratio: a name or a number such as 1.25 (default major-third)" },
      up: S.num("Steps above the body size (default 6)", { minimum: 0, maximum: 12 }), down: S.num("Steps below (default 2)", { minimum: 0, maximum: 4 }),
    }, [], async (a) => ({ scale: (await lib()).typeScale({ base: a.base, ratio: a.ratio, up: a.up, down: a.down }) }), { readOnly: true }),

    tool("column_grid", "Computes a column grid for a page width: the x position and width of every column for the given margins, column count and gutter. Place and size layers on these values (or pass them to grid_layout).", {
      width: S.num("Page or container width in px (default: the active page)", { minimum: 1 }), margin: S.num("Left and right margin (default 64)", { minimum: 0 }),
      columns: S.num("Number of columns (default 12)", { minimum: 1, maximum: 48 }), gutter: S.num("Space between columns (default 24)", { minimum: 0 }),
    }, [], async (a) => (await lib()).columnGrid({ width: a.width || app.page?.w, margin: a.margin, columns: a.columns, gutter: a.gutter }), { readOnly: true }),

    tool("list_merge_fields", "Lists the <<Field Name>> placeholders in the text of a page: the fields data_merge can fill.", { pageId: S.str("Page id (default: active page)") }, [], async (a) => {
      const doc = requireDoc(app);
      const pg = pagesOf({ pageId: a.pageId })[0];
      const fields = new Set();
      for (const f of pageFacts(app, pg).flat) {
        const n = doc.find(f.id);
        if (n?.type === "text" && doc.stories[n.storyId]) for (const x of DM.listFields(doc.stories[n.storyId].story)) fields.add(x);
      }
      return { page: pg.id, fields: [...fields], note: fields.size ? "" : "No placeholders. Write them into text as <<Name>>, for example with add_text." };
    }, { readOnly: true }),

    tool("data_merge", "Variable data (mail merge): makes one copy of a template page per record and fills the <<Field Name>> placeholders in its text, for name badges, certificates, price tags, letters or social cards from a list. Give records as objects, or csv text with a header row. One undo step. The template page stays as it is.", {
      pageId: S.str("Template page (default: active page)"),
      records: { type: "array", maxItems: 500, items: { type: "object" }, description: "One object per copy: { \"Name\": \"Ada\", \"Role\": \"Engineer\" }" },
      csv: S.str("Instead of records: CSV text, the first row holds the field names"),
      missing: S.str("Placeholders without a value: keep them or empty them (default empty)", { enum: ["keep", "empty"] }),
      pageName: S.str("Name of the new pages; may contain <<Field>> (default: template name and number)"),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const tpl = pagesOf({ pageId: a.pageId })[0];
      let records = a.records;
      if (!records?.length && a.csv) {
        records = DM.parseCSV(a.csv, { delimiter: DM.detectDelimiter(a.csv) }).records.filter((r) => Object.values(r).some((v) => String(v).trim()));
      }
      if (!records?.length) throw new Error("Give records or csv with at least one data row.");
      if (records.length > 500) throw new Error("At most 500 records per call.");
      const mark = historyMark(doc.history);
      const made = [];
      const used = new Set();
      let at = doc.pages.indexOf(tpl);
      for (const [i, rec] of records.entries()) {
        // the Duplicate Page command copies the active page (with independent text stories) right after it
        app.setActivePage?.(tpl);
        const known = new Set(doc.pages);
        app.run("doc.duplicatePage");
        const np = doc.pages.find((p) => !known.has(p));
        if (!np) throw new Error("The page could not be duplicated.");
        // keep the copies in record order
        at++;
        if (doc.pages.indexOf(np) !== at) doc.movePage(np, at);
        const name = a.pageName ? a.pageName.replace(/<<\s*([^<>]+?)\s*>>/g, (_, k) => String(rec[k] ?? "")) : `${tpl.name} ${i + 1}`;
        doc.set(np, { name }, "AI: Data merge");
        for (const f of pageFacts(app, np).flat) {
          const n = doc.find(f.id);
          const entry = n?.type === "text" ? doc.stories[n.storyId] : null;
          if (!entry) continue;
          const fields = DM.listFields(entry.story);
          if (!fields.length) continue;
          fields.forEach((x) => used.add(x));
          doc.setStory(n.storyId, DM.mergeFields(entry.story, rec, { missing: a.missing || "empty" }), "AI: Data merge");
        }
        made.push({ id: np.id, name });
      }
      if (app.doc === doc) {
        mergeSince(doc.history, mark, "AI: Data merge");
        const top = doc.history.entries[doc.history.index - 1];
        if (top && doc.history.tag && !top.tag) top.tag = doc.history.tag;
      }
      app.setActivePage?.(tpl);
      app.emit("render");
      const fieldsInData = Object.keys(records[0] || {});
      const unusedData = fieldsInData.filter((k) => !used.has(k));
      return { pages: made.length, created: made.slice(0, 50), fieldsFilled: [...used], ...(unusedData.length ? { unusedColumns: unusedData } : {}), ...(used.size ? {} : { note: "The template has no <<Field>> placeholders, so the copies are identical. Check list_merge_fields." }) };
    }),
  ];
}
