// `ofini`: the OpenFini command line tool (docs/cli.md, docs/adr/0032-ofini-cli.md). Every command is a function of
// (flags, args, ctx) that returns an exit code; `main(argv, io)` parses, dispatches and maps errors to exit codes, so
// tests run commands in-process with captured streams.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { resolve, dirname, basename, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8 } from "../../app/vendor/fflate/fflate.js";
import { FORMAT_VERSION } from "../../app/src/core/ofini-migrate.js";
import { diagnoseFile, repairFile, findingText, FIXES, isOfiniName } from "../../app/src/core/doctor/file.js";
import { readZipStrict, scanLocalHeaders, safeEntryName, writeOfiniZip, crc32, DOCTOR_LIMITS, looksLikeZip } from "../../app/src/core/doctor/zip.js";
import { parseArgs, parsePages, UsageError } from "./args.mjs";
import { createOutput, table, bytes as fmtBytes, sev } from "./term.mjs";
import { expandAll } from "./glob.mjs";
import { CliError, EXIT, NEW_KINDS, SIZE_PRESETS, createProject, openInput, readOfini, templatesFor, writeOfini, projectKind } from "./project.mjs";
import { exportProject, formatsFor, formatFromName, projectText } from "./export.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

// ------------------------------------------------------------------------------------------------ helpers

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const withoutExt = (p) => p.slice(0, p.length - extname(p).length);

function readInput(ctx, path, { name } = {}) {
  if (path === "-") {
    if (!ctx.io.stdin) throw new CliError("No standard input is available.", EXIT.IO);
    const data = ctx.io.readStdin ? ctx.io.readStdin() : readFileSync(0);
    return { bytes: new Uint8Array(data), name: name || "stdin.ofini", path: "-" };
  }
  const abs = resolve(ctx.cwd, path);
  try {
    const st = statSync(abs);
    if (st.isDirectory()) throw new CliError(`${path} is a folder; this command needs a file.`, EXIT.IO);
    return { bytes: new Uint8Array(readFileSync(abs)), name: basename(abs), path, abs };
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(e.code === "ENOENT" ? `${path}: no such file.` : `${path}: cannot read (${e.code || e.message}).`, EXIT.IO);
  }
}

function writeOutput(ctx, path, data, { force = false } = {}) {
  if (path === "-") {
    ctx.io.stdout.write(data);
    return "-";
  }
  const abs = resolve(ctx.cwd, path);
  if (existsSync(abs) && !force) throw new CliError(`${path} already exists. Use --force to overwrite it.`, EXIT.IO);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  } catch (e) {
    throw new CliError(`${path}: cannot write (${e.code || e.message}).`, EXIT.IO);
  }
  return path;
}

function needArgs(args, n, what) {
  if (args.length < n) throw new UsageError(`Missing ${what}.`);
}

/** Runs `fn` for each file, collecting results; I/O errors of one file do not stop the others. */
async function eachFile(ctx, files, fn) {
  let worst = 0;
  const results = [];
  for (const f of files) {
    try {
      const r = await fn(f);
      results.push(r.result);
      worst = Math.max(worst, r.code);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      ctx.out.error(e.message);
      results.push({ file: f, error: e.message });
      worst = Math.max(worst, e.code);
    }
  }
  return { worst, results };
}

// ------------------------------------------------------------------------------------------------ info

function infoLines(c, r) {
  const i = r.info;
  const lines = [`${c.bold(r.name)}${i?.title ? `  ${c.dim("“")}${i.title}${c.dim("”")}` : ""}`];
  if (!i) {
    lines.push(`  ${c.dim("type")}     ${r.type}, ${fmtBytes(r.size)}`);
    return lines;
  }
  if (r.type !== "ofini") {
    lines.push(`  ${c.dim("type")}     ${r.type}, ${fmtBytes(r.size)}${i.parts ? `, ${plural(i.parts, "part")}` : ""}${i.size ? `, ${i.size.width}×${i.size.height}` : ""}`);
    return lines;
  }
  const rows = [
    ["kind", `${i.kind}${i.studio && i.studio !== i.kind ? ` (studio ${i.studio})` : ""}`],
    ["format", `${i.format ?? "none"}${i.format > i.formatKnown ? c.yellow(` (newer than ${i.formatKnown})`) : ""}`],
    ["size", `${fmtBytes(r.size)} on disk, ${fmtBytes(i.unpackedBytes)} unpacked, ${plural(i.parts, "part")}`],
    ["pages", i.pages.length ? `${i.pages.length}: ${i.pages.slice(0, 6).map((p) => `${Math.round(p.width)}×${Math.round(p.height)}`).join(", ")}${i.pages.length > 6 ? ", …" : ""}${i.unit && i.unit !== "px" ? ` px (unit ${i.unit}, ${i.dpi} dpi)` : " px"}` : "0"],
  ];
  if (i.masters) rows.push(["masters", String(i.masters)]);
  rows.push(["layers", i.layers.total ? `${i.layers.total}: ${Object.entries(i.layers.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ")}` : "0"]);
  if (i.stories) rows.push(["text", plural(i.stories, "story", "stories")]);
  if (i.fonts.length) rows.push(["fonts", i.fonts.join(", ")]);
  rows.push(["assets", i.assets.length ? `${i.assets.length} (${fmtBytes(i.assets.reduce((s, a) => s + a.bytes, 0))})` : "0"]);
  if (i.pixelLayers) rows.push(["pixels", plural(i.pixelLayers, "pixel layer")]);
  if (i.websiteFiles) rows.push(["website", plural(i.websiteFiles, "file")]);
  if (i.officeMedia) rows.push(["media", plural(i.officeMedia, "file")]);
  if (i.comments) rows.push(["comments", String(i.comments)]);
  rows.push(["preview", i.thumbnail ? "yes" : "no"]);
  for (const [k, v] of rows) lines.push(`  ${c.dim(k.padEnd(8))} ${v}`);
  const n = r.counts;
  if (n.error || n.warning) lines.push(`  ${c.dim("health".padEnd(8))} ${n.error ? c.red(plural(n.error, "error")) : c.green("no errors")}${n.warning ? `, ${c.yellow(plural(n.warning, "warning"))}` : ""} ${c.dim("(ofini doctor for details)")}`);
  return lines;
}

async function cmdInfo(flags, args, ctx) {
  needArgs(args, 1, "file");
  const files = expandAll(args, ctx.cwd);
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const input = readInput(ctx, f, { name: flags.name });
    const r = diagnoseFile(input.bytes, { name: input.name });
    if (!ctx.out.json) {
      ctx.out.result(infoLines(ctx.out.c, r).join("\n"));
      if (files.length > 1) ctx.out.result("");
    }
    const unreadable = r.container === "broken" || (r.type === "ofini" && !r.info);
    return { code: unreadable ? EXIT.PROBLEMS : 0, result: { file: f, name: r.name, type: r.type, size: r.size, container: r.container, info: r.info, counts: r.counts } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 && !args.some((a) => /[*?[]/.test(a)) ? results[0] : results);
  return worst;
}

// ------------------------------------------------------------------------------------------------ validate and doctor

function findingRows(c, findings) {
  return findings.map((f) => [sev(c, f.severity), c.dim(f.code), findingText(f), f.fixed ? c.green("fixed") : f.fix ? c.dim(`fix: ${f.fix.id}${f.fix.safe ? "" : " (--fix=all)"}`) : ""]);
}

async function cmdValidate(flags, args, ctx) {
  needArgs(args, 1, "file");
  const files = expandAll(args, ctx.cwd);
  const { c } = ctx.out;
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const input = readInput(ctx, f, { name: flags.name });
    const r = diagnoseFile(input.bytes, { name: input.name });
    const bad = r.counts.error > 0 || (flags.strict && r.counts.warning > 0);
    if (!ctx.out.json) {
      if (!bad) ctx.out.result(`${c.green("ok")}    ${f}${r.counts.warning ? c.dim(` (${plural(r.counts.warning, "warning")})`) : ""}`);
      else ctx.out.result(`${c.red("FAIL")}  ${f}  ${c.dim(`${plural(r.counts.error, "error")}, ${plural(r.counts.warning, "warning")}`)}`);
      const shown = r.findings.filter((x) => x.severity === "error" || (x.severity === "warning" && (bad || flags.verbose)));
      if (shown.length && !ctx.out.quiet) ctx.out.print(shown.map((x) => `      ${sev(c, x.severity)} ${findingText(x)}`).join("\n"));
    }
    return { code: bad ? EXIT.PROBLEMS : 0, result: { file: f, ok: !bad, errors: r.findings.filter((x) => x.severity === "error").map((x) => findingText(x)), warnings: r.findings.filter((x) => x.severity === "warning").map((x) => findingText(x)), counts: r.counts } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  else if (files.length > 1) ctx.out.print(c.dim(`${files.length} files, ${results.filter((r) => r.ok).length} ok`));
  return worst;
}

function fixMode(v) {
  if (v === undefined || v === false) return null;
  if (v === true || v === "safe") return "safe";
  if (v === "all") return "all";
  const ids = String(v).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !FIXES[id]);
  if (bad.length) throw new UsageError(`Unknown fix “${bad.join(", ")}”. Fixes: safe, all, or ${Object.keys(FIXES).join(", ")}.`);
  return ids;
}

function nodeEnvironment(ctx) {
  const major = Number(process.versions.node.split(".")[0]);
  const rows = [];
  const add = (severity, code, message) => rows.push({ severity, code, message });
  add(major >= 20 ? "ok" : "error", "node", `Node.js ${process.versions.node}${major >= 20 ? "" : " (ofini needs Node 20 or later)"}`);
  add("ok", "engine", `OpenFini engine ${VERSION}, document format ${FORMAT_VERSION}`);
  add("ok", "measure", "Text layout uses the PDF base-14 font metrics (no canvas in Node)");
  try {
    const probe = join(ctx.io.tmpdir || process.env.TMPDIR || process.env.TEMP || ctx.cwd, `.ofini-doctor-${process.pid}`);
    writeFileSync(probe, "ok");
    readFileSync(probe);
    import("node:fs").then((fs) => fs.rmSync(probe, { force: true }));
    add("ok", "temp", "The temporary folder is writable");
  } catch (e) {
    add("warning", "temp", `The temporary folder is not writable (${e.code || e.message})`);
  }
  const why = ctx.out.colorOn ? "on" : ctx.io.env.NO_COLOR ? "off (NO_COLOR is set)" : ctx.io.stdout.isTTY ? "off (--no-color)" : "off (output is not a terminal)";
  add("ok", "terminal", `Colors ${why}`);
  return rows;
}

async function cmdDoctor(flags, args, ctx) {
  const { c } = ctx.out;
  const mode = fixMode(flags.fix);
  if (!mode && (flags["in-place"] || flags.out)) throw new UsageError("--in-place and --out need --fix.");
  if (flags["in-place"] && flags.out) throw new UsageError("Use either --in-place or --out, not both.");
  if (!args.length) {
    const rows = nodeEnvironment(ctx);
    if (ctx.out.json) ctx.out.data({ environment: rows });
    else {
      ctx.out.result(c.bold("ofini doctor: command line environment"));
      ctx.out.result(table([], rows.map((r) => [sev(c, r.severity), c.dim(r.code), r.message])));
      ctx.out.print(c.dim("\nCheck files with: ofini doctor <file...>   Repair: ofini doctor --fix <file>"));
    }
    return rows.some((r) => r.severity === "error") ? EXIT.PROBLEMS : 0;
  }
  const files = expandAll(args, ctx.cwd);
  if (flags.out && files.length > 1) throw new UsageError("--out works with one file; use --in-place or the default “.repaired” copies for several.");
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const input = readInput(ctx, f, { name: flags.name });
    let report = diagnoseFile(input.bytes, { name: input.name });
    let written = null;
    let backup = null;
    let applied = [];
    if (mode) {
      const rep = repairFile(input.bytes, { name: input.name, fixes: mode });
      report = rep.before;
      applied = rep.applied;
      if (rep.bytes) {
        let target;
        if (flags["in-place"]) {
          if (f === "-") throw new UsageError("--in-place cannot be used with standard input.");
          backup = `${f}.bak`;
          if (existsSync(resolve(ctx.cwd, backup)) && !flags.force) throw new CliError(`${backup} already exists. Remove it or use --force to replace the backup.`, EXIT.IO);
          copyFileSync(resolve(ctx.cwd, f), resolve(ctx.cwd, backup));
          target = f;
        } else target = flags.out || (f === "-" ? "-" : `${withoutExt(f)}.repaired${extname(f) || ".ofini"}`);
        written = writeOutput(ctx, target, rep.bytes, { force: !!flags.force || !!flags["in-place"] });
        report = { ...rep.before, after: rep.after };
      }
    }
    const final = report.after || report;
    const bad = final.counts.error > 0 || (flags.strict && final.counts.warning > 0);
    if (!ctx.out.json) {
      const n = report.counts;
      const status = report.findings.length === 0 ? c.green("healthy") : n.error ? c.red(plural(n.error, "error")) : c.yellow(n.warning ? plural(n.warning, "warning") : plural(n.info, "note"));
      ctx.out.result(`${c.bold(f)}  ${status}${report.container === "recovered" ? c.yellow("  (container damaged)") : ""}`);
      const shown = flags.verbose ? report.findings : report.findings.filter((x) => x.severity !== "info" || x.fix);
      if (shown.length && !ctx.out.quiet) ctx.out.print(table([], findingRows(c, shown), { max: 0 }).replace(/^/gm, "  "));
      if (written) {
        ctx.out.result(`  ${c.green("wrote")} ${written === "-" ? "standard output" : written}${backup ? c.dim(` (original kept as ${backup})`) : ""}: ${plural(applied.length, "fix", "fixes")} applied (${applied.join(", ")})`);
        const a = report.after.counts;
        ctx.out.print(`  ${c.dim("after repair:")} ${a.error ? c.red(plural(a.error, "error")) : c.green("no errors")}, ${plural(a.warning, "warning")}, ${plural(a.info, "note")}`);
      } else if (mode) ctx.out.print(c.dim(`  nothing to repair${report.counts.fixable ? ` with --fix=${Array.isArray(mode) ? mode.join(",") : mode} (try --fix=all for the remaining fixes)` : ""}`));
      else if (report.counts.fixable) ctx.out.print(c.dim(`  ${plural(report.counts.fixable, "finding")} can be repaired: ofini doctor --fix ${f}`));
    }
    return { code: bad ? EXIT.PROBLEMS : 0, result: { file: f, ...report, written, backup } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  return worst;
}

// ------------------------------------------------------------------------------------------------ export / convert

async function writeExports(ctx, outs, outPath, force) {
  const written = [];
  for (const o of outs) {
    let p = outPath;
    if (o.suffix && p !== "-") p = `${withoutExt(p)}${o.suffix}${extname(p) || `.${o.ext}`}`;
    if (o.suffix && p === "-") throw new UsageError("Several pages cannot go to standard output; choose one page with --pages or an output file.");
    written.push(writeOutput(ctx, p, o.bytes, { force }));
    for (const w of o.warnings || []) ctx.out.warn(typeof w === "string" ? w : w.message || JSON.stringify(w));
  }
  return written;
}

async function cmdExport(flags, args, ctx) {
  needArgs(args, 1, "file");
  if (!flags.format && !flags.out) throw new UsageError("Choose a format with --format (or name an --out file with an extension).");
  const format = String(flags.format || formatFromName(flags.out)).toLowerCase();
  const files = expandAll(args, ctx.cwd);
  if (files.length > 1 && flags.out && !flags.out.endsWith("/") && !flags.out.endsWith(sep)) throw new UsageError("With several files, --out must be a folder (end it with /).");
  const { worst, results } = await eachFile(ctx, files, async (f) => {
    const input = readInput(ctx, f, { name: flags.name });
    const { doc, entries } = await openInput(input.bytes, input.name);
    const pages = flags.pages ? parsePages(flags.pages, doc.pages.length) : null;
    const outs = await exportProject(doc, format, { pages, entries, background: !flags["no-background"] });
    let out = flags.out || `${withoutExt(f === "-" ? "out" : f)}.${outs[0].ext}`;
    if (flags.out && (flags.out.endsWith("/") || flags.out.endsWith(sep))) out = join(flags.out, `${basename(withoutExt(f))}.${outs[0].ext}`);
    const written = await writeExports(ctx, outs, out, !!flags.force);
    if (!written.includes("-")) ctx.out.result(written.map((w) => `${ctx.out.c.green("wrote")} ${w}`).join("\n"));
    return { code: 0, result: { file: f, format, written } };
  });
  if (ctx.out.json) ctx.out.data(files.length === 1 ? results[0] : results);
  return worst;
}

async function cmdConvert(flags, args, ctx) {
  needArgs(args, 2, "input and output (ofini convert <in> <out>)");
  const [src, dst] = args;
  const format = String(flags.format || formatFromName(dst === "-" ? "" : dst)).toLowerCase();
  if (!format) throw new UsageError("Name the output format with --format when writing to standard output.");
  const input = readInput(ctx, src, { name: flags.name });
  const { doc, entries, imported } = await openInput(input.bytes, input.name);
  const pages = flags.pages ? parsePages(flags.pages, doc.pages.length) : null;
  const outs = await exportProject(doc, format, { pages, entries, background: !flags["no-background"] });
  const written = await writeExports(ctx, outs, dst, !!flags.force);
  if (ctx.out.json) ctx.out.data({ input: src, imported: imported || null, format, written });
  else if (!written.includes("-")) ctx.out.result(`${ctx.out.c.green("wrote")} ${written.join(", ")}${imported ? ctx.out.c.dim(` (read as ${imported})`) : ""}`);
  return 0;
}

async function cmdFormats(flags, args, ctx) {
  const { c } = ctx.out;
  if (args.length) {
    const input = readInput(ctx, args[0], { name: flags.name });
    const { doc } = await openInput(input.bytes, input.name);
    const list = formatsFor(doc);
    if (ctx.out.json) ctx.out.data({ file: args[0], kind: projectKind(doc), formats: list });
    else ctx.out.result(`${c.bold(args[0])} ${c.dim(`(${projectKind(doc)})`)}\n${table([], list.map((f) => [f.id, c.dim(f.label)])).replace(/^/gm, "  ")}`);
    return 0;
  }
  const { importableExtensions } = await import("./project.mjs");
  const kinds = [["design (vector, pixel, layout)", "svg, pdf, txt"], ["website (code)", "zip"], ["document", "docx, odt, rtf, html, md, txt, pdf"], ["sheet", "xlsx, ods, csv, tsv, pdf"], ["slides", "pptx, odp, pdf"], ["board", "excalidraw, tldraw, svg, pdf"], ["scene", "(project only)"]];
  const imports = [...new Set(importableExtensions().map((e) => e[0]))].join(", ");
  if (ctx.out.json) ctx.out.data({ export: Object.fromEntries(kinds.map(([k, v]) => [k, v.split(", ")])), always: ["ofini", "json"], import: imports.split(", "), needsApp: ["png", "jpg", "webp", "avif", "gif", "tiff", "mp4", "webm", "psd"] });
  else {
    ctx.out.result(c.bold("Export formats (ofini export / convert)"));
    ctx.out.result(table([], kinds.map(([k, v]) => [`  ${k}`, v])));
    ctx.out.result(`  ${c.dim("every project also: ofini, json")}`);
    ctx.out.result(`\n${c.bold("Import (convert input)")}\n  .ofini, ${imports.split(", ").map((e) => `.${e}`).join(", ")}`);
    ctx.out.result(`\n${c.bold("Needs the app")} ${c.dim("(rendering)")}\n  png, jpg, webp, avif, gif, tiff, video, psd; PDF of pages with pictures`);
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ extract / ls

function safeFileName(s, fallback) {
  const n = String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return n || fallback;
}

async function cmdExtract(flags, args, ctx) {
  needArgs(args, 1, "file");
  const what = ["assets", "text", "json"].filter((k) => flags[k]);
  if (what.length !== 1) throw new UsageError("Choose one of --assets, --text or --json.");
  const input = readInput(ctx, args[0], { name: flags.name });
  if (what[0] === "assets") {
    const { doc, entries } = readOfini(input.bytes, input.name);
    const dir = flags.out || `${withoutExt(args[0] === "-" ? "stdin" : args[0])}-assets`;
    const absDir = resolve(ctx.cwd, dir);
    if (existsSync(absDir) && readdirSync(absDir).length && !flags.force) throw new CliError(`${dir} is not empty. Use --force to write into it.`, EXIT.IO);
    const used = new Set();
    const uniq = (p) => {
      let q = p;
      for (let i = 2; used.has(q.toLowerCase()); i++) q = `${withoutExt(p)}-${i}${extname(p)}`;
      used.add(q.toLowerCase());
      return q;
    };
    const written = [];
    const put = (rel, data) => {
      const p = uniq(rel);
      writeOutput(ctx, join(dir, p), data, { force: true });
      written.push(p);
    };
    for (const a of Object.values(doc.assets)) {
      const key = Object.keys(entries).find((k) => k.startsWith(`assets/${a.id}.`));
      if (key) put(`${safeFileName(withoutExt(a.name || ""), a.id)}${extname(key)}`, entries[key]);
    }
    for (const k of Object.keys(entries)) if (k.startsWith("pixels/")) put(`pixels/${basename(k)}`, entries[k]);
    if (doc.office) for (const m of Object.values(doc.office.model.media || {})) if (m.bytes) put(`media/${safeFileName(m.name, m.id)}${m.name && extname(m.name) ? "" : `.${(m.mime || "").split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin"}`}`, m.bytes);
    if (doc.web) for (const [k, b] of Object.entries(doc.web.entries())) if (safeEntryName(k)) put(`website/${k.slice("web/files/".length)}`, b);
    if (ctx.out.json) ctx.out.data({ file: args[0], dir, files: written });
    else ctx.out.result(written.length ? `${ctx.out.c.green("wrote")} ${plural(written.length, "file")} to ${dir}` : "The project has no embedded files.");
    return 0;
  }
  if (what[0] === "json") {
    const z = readZipStrict(input.bytes);
    const djson = z.entries?.["document.json"];
    if (!djson) throw new CliError(`${args[0]} has no readable document content. Try “ofini doctor ${args[0]}”.`, EXIT.PROBLEMS);
    let text;
    try {
      text = `${JSON.stringify(JSON.parse(strFromU8(djson)), null, 2)}\n`;
    } catch {
      throw new CliError("The document content is not valid JSON. Try “ofini doctor --fix”.", EXIT.PROBLEMS);
    }
    if (flags.out) {
      writeOutput(ctx, flags.out, text, { force: !!flags.force });
      if (!ctx.out.json) ctx.out.result(`${ctx.out.c.green("wrote")} ${flags.out}`);
    } else ctx.out.raw(text);
    return 0;
  }
  const { doc } = await openInput(input.bytes, input.name);
  const text = await projectText(doc);
  if (ctx.out.json) ctx.out.data({ file: args[0], text });
  else if (flags.out) {
    writeOutput(ctx, flags.out, `${text}\n`, { force: !!flags.force });
    ctx.out.result(`${ctx.out.c.green("wrote")} ${flags.out}`);
  } else ctx.out.raw(text ? `${text}\n` : "");
  return 0;
}

function describeEntry(name) {
  if (name === "mimetype") return "file type marker";
  if (name === "document.json") return "document content";
  if (name === "thumbnail.png") return "preview image";
  if (name.startsWith("assets/")) return "picture";
  if (name.startsWith("pixels/")) return "pixel layer";
  if (name.startsWith("web/files/")) return "website file";
  if (name.startsWith("web/git/")) return "Git history";
  if (name.startsWith("office/")) return "media";
  return "";
}

async function cmdLs(flags, args, ctx) {
  needArgs(args, 1, "file");
  const input = readInput(ctx, args[0], { name: flags.name });
  if (!looksLikeZip(input.bytes)) throw new CliError(`${args[0]} is not a ZIP-based file.`, EXIT.PROBLEMS);
  let z = readZipStrict(input.bytes);
  let damaged = false;
  if (!z.ok) {
    const s = scanLocalHeaders(input.bytes);
    z = { entries: s.entries, order: s.order };
    damaged = true;
  }
  const rows = z.order.map((n) => ({ name: n, size: z.entries[n].length, crc32: crc32(z.entries[n]).toString(16).padStart(8, "0"), kind: describeEntry(n) }));
  if (ctx.out.json) ctx.out.data({ file: args[0], damaged, entries: rows });
  else {
    const { c } = ctx.out;
    if (damaged) ctx.out.warn("The ZIP directory is damaged; these are the parts that could be recovered.");
    ctx.out.result(table(["SIZE", "PART", "WHAT"], rows.map((r) => [fmtBytes(r.size), r.name, c.dim(r.kind)]), { align: ["r"], c }));
    ctx.out.print(c.dim(`${plural(rows.length, "part")}, ${fmtBytes(rows.reduce((s, r) => s + r.size, 0))} unpacked, ${fmtBytes(input.bytes.length)} on disk`));
  }
  return damaged ? EXIT.PROBLEMS : 0;
}

// ------------------------------------------------------------------------------------------------ new / pack / unpack

async function cmdNew(flags, args, ctx) {
  const { c } = ctx.out;
  if (flags.list || (args.length === 1 && flags.template === true)) {
    const kinds = args.length ? [args[0]] : NEW_KINDS;
    const all = {};
    for (const k of kinds) all[k] = await templatesFor(k);
    if (ctx.out.json) ctx.out.data(all);
    else for (const [k, list] of Object.entries(all)) ctx.out.result(`${c.bold(k)}\n${table([], list.map((t) => [`  ${t.id}`, c.dim(t.label)]))}`);
    return 0;
  }
  needArgs(args, 2, "kind and file (ofini new <kind> <file>); kinds: " + NEW_KINDS.join(", "));
  const [kind, file] = args;
  const out = file === "-" || /\.ofini$/i.test(file) ? file : `${file}.ofini`;
  const title = flags.title || (file === "-" ? "" : basename(withoutExt(out)));
  const doc = await createProject(kind, { template: flags.template || "blank", title, size: flags.size, pages: flags.pages });
  const bytes = writeOfini(doc);
  writeOutput(ctx, out, bytes, { force: !!flags.force });
  if (ctx.out.json) ctx.out.data({ kind, template: flags.template || "blank", file: out, bytes: bytes.length });
  else if (out !== "-") ctx.out.result(`${c.green("created")} ${out} ${c.dim(`(${kind}${flags.template ? `, ${flags.template}` : ""}, ${fmtBytes(bytes.length)})`)}`);
  return 0;
}

function listDir(abs, base = abs, out = []) {
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, e.name);
    if (e.isDirectory()) listDir(p, base, out);
    else if (e.isFile() && e.name !== ".DS_Store" && e.name !== "Thumbs.db") out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

async function cmdPack(flags, args, ctx) {
  needArgs(args, 1, "folder");
  const dir = args[0];
  const abs = resolve(ctx.cwd, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new CliError(`${dir} is not a folder.`, EXIT.IO);
  const names = listDir(abs).sort();
  if (!names.includes("document.json")) throw new CliError(`${dir} has no document.json; unpack an .ofini file first (ofini unpack) or create one (ofini new).`, EXIT.PROBLEMS);
  const entries = {};
  for (const n of names) {
    if (n === "mimetype") continue;
    if (!safeEntryName(n)) throw new CliError(`Refusing to pack the unsafe name “${n}”.`, EXIT.PROBLEMS);
    entries[n] = new Uint8Array(readFileSync(join(abs, n)));
  }
  try {
    entries["document.json"] = new TextEncoder().encode(JSON.stringify(JSON.parse(strFromU8(entries["document.json"]))));
  } catch (e) {
    throw new CliError(`document.json is not valid JSON (${e.message}).`, EXIT.PROBLEMS);
  }
  const bytes = writeOfiniZip(entries);
  const out = args[1] || `${abs.replace(/[\\/]+$/, "")}.ofini`;
  const target = args[1] ? out : relative(ctx.cwd, out) || out;
  writeOutput(ctx, target, bytes, { force: !!flags.force });
  const r = diagnoseFile(bytes, { name: basename(out) });
  if (ctx.out.json) ctx.out.data({ dir, file: target, parts: Object.keys(entries).length + 1, bytes: bytes.length, counts: r.counts });
  else {
    ctx.out.result(`${ctx.out.c.green("packed")} ${target} ${ctx.out.c.dim(`(${plural(Object.keys(entries).length + 1, "part")}, ${fmtBytes(bytes.length)})`)}`);
    if (r.counts.error || r.counts.warning) ctx.out.warn(`the packed file has ${plural(r.counts.error, "error")} and ${plural(r.counts.warning, "warning")}; run “ofini doctor ${target}”.`);
  }
  return r.counts.error ? EXIT.PROBLEMS : 0;
}

async function cmdUnpack(flags, args, ctx) {
  needArgs(args, 1, "file");
  const input = readInput(ctx, args[0], { name: flags.name });
  const z = readZipStrict(input.bytes);
  if (!z.ok) throw new CliError(`${args[0]} is damaged (${z.error || "unreadable"}). Repair it first: ofini doctor --fix ${args[0]}`, EXIT.PROBLEMS);
  const dir = args[1] || withoutExt(args[0] === "-" ? "stdin" : args[0]);
  const absDir = resolve(ctx.cwd, dir);
  if (existsSync(absDir) && readdirSync(absDir).length && !flags.force) throw new CliError(`${dir} is not empty. Use --force to write into it.`, EXIT.IO);
  let n = 0;
  for (const name of z.order) {
    const target = resolve(absDir, ...name.split("/"));
    if (!target.startsWith(absDir + sep)) continue; // never outside the folder (names are already checked)
    let data = z.entries[name];
    if (name === "document.json" && flags.pretty) {
      try {
        data = `${JSON.stringify(JSON.parse(strFromU8(data)), null, 2)}\n`;
      } catch {
        /* keep the bytes as they are */
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    n++;
  }
  if (z.unsafe.length) ctx.out.warn(`skipped ${plural(z.unsafe.length, "part")} with unsafe names: ${z.unsafe.slice(0, 3).join(", ")}`);
  if (ctx.out.json) ctx.out.data({ file: args[0], dir, parts: n, skipped: z.unsafe });
  else ctx.out.result(`${ctx.out.c.green("unpacked")} ${plural(n, "part")} to ${dir}`);
  return 0;
}

// ------------------------------------------------------------------------------------------------ diff

function snapshot(bytes, name) {
  const r = diagnoseFile(bytes, { name });
  const z = readZipStrict(bytes);
  const parts = {};
  if (z.ok) for (const k of z.order) parts[k] = crc32(z.entries[k]);
  let json = null;
  try {
    json = JSON.parse(strFromU8(z.entries["document.json"]));
  } catch {
    json = null;
  }
  return { r, parts, json };
}

async function cmdDiff(flags, args, ctx) {
  needArgs(args, 2, "two files");
  const A = readInput(ctx, args[0]);
  const B = readInput(ctx, args[1]);
  const a = snapshot(A.bytes, A.name);
  const b = snapshot(B.bytes, B.name);
  const changes = [];
  const ch = (kind, what, detail = "") => changes.push({ kind, what, detail });
  const ia = a.r.info || {};
  const ib = b.r.info || {};
  for (const k of ["title", "kind", "studio", "format", "unit", "dpi"]) if (ia[k] !== ib[k]) ch("~", k, `${ia[k] ?? "–"} → ${ib[k] ?? "–"}`);
  const pa = ia.pages || [];
  const pb = ib.pages || [];
  if (pa.length !== pb.length) ch("~", "pages", `${pa.length} → ${pb.length}`);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i].width !== pb[i].width || pa[i].height !== pb[i].height) ch("~", `page ${i + 1} size`, `${pa[i].width}×${pa[i].height} → ${pb[i].width}×${pb[i].height}`);
  const types = new Set([...Object.keys(ia.layers?.byType || {}), ...Object.keys(ib.layers?.byType || {})]);
  for (const t of [...types].sort()) {
    const x = ia.layers?.byType?.[t] || 0;
    const y = ib.layers?.byType?.[t] || 0;
    if (x !== y) ch(y > x ? "+" : "-", `${t} layers`, `${x} → ${y}`);
  }
  const sa = a.json?.stories || {};
  const sb = b.json?.stories || {};
  for (const id of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (!sa[id]) ch("+", "text story", id);
    else if (!sb[id]) ch("-", "text story", id);
    else if (JSON.stringify(sa[id]) !== JSON.stringify(sb[id])) ch("~", "text story", `${id} (text changed)`);
  }
  for (const k of new Set([...Object.keys(a.parts), ...Object.keys(b.parts)])) {
    if (k === "document.json" || k === "mimetype") continue;
    if (!(k in a.parts)) ch("+", "part", k);
    else if (!(k in b.parts)) ch("-", "part", k);
    else if (a.parts[k] !== b.parts[k]) ch("~", "part", `${k} (bytes differ)`);
  }
  if (!changes.length && a.parts["document.json"] !== b.parts["document.json"]) ch("~", "document.json", "content differs (ids, timestamps or styles)");
  if (ctx.out.json) ctx.out.data({ a: args[0], b: args[1], same: !changes.length, changes });
  else if (!changes.length) ctx.out.result(ctx.out.c.green("The files are the same."));
  else {
    const { c } = ctx.out;
    const col = { "+": c.green, "-": c.red, "~": c.yellow };
    ctx.out.result(table([], changes.map((x) => [col[x.kind](x.kind), x.what, c.dim(x.detail)])));
  }
  return changes.length ? EXIT.PROBLEMS : 0;
}

// ------------------------------------------------------------------------------------------------ version, help, completion

async function cmdVersion(flags, args, ctx) {
  const v = { ofini: VERSION, format: FORMAT_VERSION, node: process.versions.node, platform: `${process.platform}-${process.arch}` };
  if (ctx.out.json) ctx.out.data(v);
  else ctx.out.result(`ofini ${VERSION} (document format ${FORMAT_VERSION}, Node ${process.versions.node}, ${v.platform})`);
  return 0;
}

const IO_FLAGS = { name: { type: "string", desc: "File name to assume for standard input (-), e.g. in.docx" } };
const FORCE = { force: { type: "bool", short: "f", desc: "Overwrite existing files" } };

/** Command table: summary, usage, flags, examples and the implementation. */
export const COMMANDS = {
  info: { summary: "Show what a project contains", usage: "ofini info <file...>", flags: { ...IO_FLAGS }, run: cmdInfo, examples: ["ofini info poster.ofini", "ofini info 'designs/*.ofini' --json"] },
  validate: { summary: "Check files; exit code 1 on errors", usage: "ofini validate <file...>", flags: { ...IO_FLAGS, strict: { type: "bool", desc: "Treat warnings as errors" }, verbose: { type: "bool", short: "v", desc: "Also list warnings of valid files" } }, run: cmdValidate, examples: ["ofini validate *.ofini", "ofini validate --strict --json report.ofini"] },
  doctor: { summary: "Diagnose and repair files (or check this environment)", usage: "ofini doctor [file...] [--fix[=safe|all|ids]] [--in-place | --out <file>]", flags: { ...IO_FLAGS, ...FORCE, fix: { type: "bool", optional: true, desc: "Repair: safe fixes (default), all, or a comma list of fix ids" }, "in-place": { type: "bool", desc: "Replace the file (the original is kept as <file>.bak)" }, out: { type: "string", short: "o", desc: "Write the repaired copy here (default: <name>.repaired.ofini)" }, strict: { type: "bool", desc: "Exit code 1 also for warnings" }, verbose: { type: "bool", short: "v", desc: "Also list notes" } }, run: cmdDoctor, examples: ["ofini doctor", "ofini doctor broken.ofini", "ofini doctor --fix broken.ofini", "ofini doctor --fix=all --in-place broken.ofini", "ofini doctor --fix=prune-orphans,thumbnail big.ofini"] },
  export: { summary: "Export a project to another format", usage: "ofini export <file...> --format <fmt> [--out <path>] [--pages <list>]", flags: { ...IO_FLAGS, ...FORCE, format: { type: "string", short: "t", desc: "Target format (see ofini formats)" }, out: { type: "string", short: "o", desc: "Output file, folder (ending in /) or - for standard output" }, pages: { type: "string", short: "p", desc: "Pages, e.g. 1, 2-4, 1,3 or all (design projects)" }, "no-background": { type: "bool", desc: "Leave the page color out of SVG" } }, run: cmdExport, examples: ["ofini export poster.ofini --format svg", "ofini export book.ofini -t pdf -o book.pdf", "ofini export report.ofini -t md -o -"] },
  convert: { summary: "Convert between formats (Office files in, any export format out)", usage: "ofini convert <in> <out>", flags: { ...IO_FLAGS, ...FORCE, format: { type: "string", short: "t", desc: "Output format when the output name has no extension" }, pages: { type: "string", short: "p", desc: "Pages (design projects)" }, "no-background": { type: "bool", desc: "Leave the page color out of SVG" } }, run: cmdConvert, examples: ["ofini convert notes.docx notes.md", "ofini convert data.xlsx data.csv", "ofini convert slides.pptx slides.ofini", "cat in.md | ofini convert - out.docx --name in.md"] },
  formats: { summary: "List export and import formats (for a file: what it can become)", usage: "ofini formats [file]", flags: { ...IO_FLAGS }, run: cmdFormats, examples: ["ofini formats", "ofini formats budget.ofini"] },
  extract: { summary: "Extract pictures and media, text or the document JSON", usage: "ofini extract <file> (--assets [--out dir] | --text | --json) [--out file]", flags: { ...IO_FLAGS, ...FORCE, assets: { type: "bool", desc: "Write embedded pictures, pixel layers, media and website files to a folder" }, text: { type: "bool", desc: "Print the text" }, json: { type: "bool", desc: "Print document.json, indented" }, out: { type: "string", short: "o", desc: "Output folder (--assets) or file" } }, run: cmdExtract, examples: ["ofini extract brochure.ofini --assets", "ofini extract brochure.ofini --text > brochure.txt", "ofini extract brochure.ofini --json -o brochure.json"] },
  ls: { summary: "List the parts inside a project file", usage: "ofini ls <file>", flags: { ...IO_FLAGS }, run: cmdLs, examples: ["ofini ls poster.ofini"] },
  new: { summary: "Create an empty project from the app's templates", usage: "ofini new <kind> <file> [--template <id>] [--size <size>] [--pages <n>]", flags: { ...FORCE, template: { type: "string", desc: "Template id (ofini new --list)" }, title: { type: "string", desc: "Document title (default: the file name)" }, size: { type: "string", desc: `Page size for vector, pixel, layout: ${SIZE_PRESETS.slice(0, 6).join(", ")}, … or WxH[px|mm|in|pt]` }, pages: { type: "string", desc: "Number of pages (vector, pixel, layout)" }, list: { type: "bool", short: "l", desc: "List kinds and templates" } }, run: cmdNew, examples: ["ofini new vector logo.ofini", "ofini new layout flyer.ofini --size a5 --pages 2", "ofini new sheet budget.ofini --template budget", "ofini new code site.ofini --template landing", "ofini new --list"] },
  pack: { summary: "Pack a folder (from unpack) into an .ofini file", usage: "ofini pack <folder> [file.ofini]", flags: { ...FORCE }, run: cmdPack, examples: ["ofini pack poster poster.ofini"] },
  unpack: { summary: "Unpack an .ofini file into a folder", usage: "ofini unpack <file> [folder]", flags: { ...IO_FLAGS, ...FORCE, pretty: { type: "bool", desc: "Indent document.json (for diffs in Git)" } }, run: cmdUnpack, examples: ["ofini unpack poster.ofini --pretty"] },
  diff: { summary: "Compare two projects structurally; exit code 1 when they differ", usage: "ofini diff <a> <b>", flags: {}, run: cmdDiff, examples: ["ofini diff v1.ofini v2.ofini"] },
  version: { summary: "Print the version", usage: "ofini version", flags: {}, run: cmdVersion, examples: [] },
  help: { summary: "Help for a command", usage: "ofini help [command]", flags: {}, run: cmdHelp, examples: ["ofini help doctor"] },
  completion: { summary: "Print a shell completion script", usage: "ofini completion <bash|zsh|fish|powershell>", flags: {}, run: cmdCompletion, examples: ["ofini completion bash >> ~/.bashrc", "ofini completion powershell | Out-String | Invoke-Expression"] },
};
const ALIASES = { list: "ls", check: "validate", "--version": "version", "-V": "version" };

export const EXIT_CODES = [
  [0, "Success (no errors; warnings allowed unless --strict)"],
  [1, "Problems found: validation or doctor errors, damaged input, diff found differences"],
  [2, "Usage error: unknown command or option, missing argument"],
  [3, "File error: not found, unreadable, or the output exists (use --force)"],
  [4, "Not supported headless: the format or operation needs the app"],
  [5, "Internal error (please report it)"],
  [130, "Interrupted (Ctrl+C)"],
];

function generalHelp(c) {
  const rows = Object.entries(COMMANDS).map(([k, v]) => [`  ${c.bold(k)}`, v.summary]);
  return [
    `${c.bold("ofini")} ${VERSION}: OpenFini projects from the terminal`,
    "",
    `${c.bold("Usage")}  ofini <command> [options] [files]`,
    "        ofini            (no arguments in a terminal: interactive mode)",
    "",
    c.bold("Commands"),
    table([], rows),
    "",
    c.bold("Options for every command"),
    "  --json        machine-readable output     -q, --quiet   only results and errors",
    "  --no-color    no colors (or NO_COLOR=1)   -h, --help    help for the command",
    "",
    `Files accept wildcards (*.ofini, designs/**/*.ofini) and - for standard input or output.`,
    "",
    c.bold("Exit codes"),
    table([], EXIT_CODES.map(([k, v]) => [`  ${k}`, v]), { align: ["r"] }),
    "",
    c.dim("Reference: docs/cli.md"),
  ].join("\n");
}

function commandHelp(c, name) {
  const cmd = COMMANDS[name];
  const flags = Object.entries(cmd.flags).map(([k, v]) => [`  ${v.short ? `-${v.short}, ` : "    "}--${k}${v.type === "string" ? " <value>" : v.optional ? "[=value]" : ""}`, v.desc || ""]);
  const out = [`${c.bold(`ofini ${name}`)}: ${cmd.summary}`, "", `${c.bold("Usage")}  ${cmd.usage}`];
  if (flags.length) out.push("", c.bold("Options"), table([], flags));
  out.push("", c.dim("  also: --json, --quiet, --no-color, --help"));
  if (cmd.examples.length) out.push("", c.bold("Examples"), ...cmd.examples.map((e) => `  ${e}`));
  if (name === "doctor") out.push("", c.bold("Fixes"), table([], Object.entries(FIXES).map(([k, v]) => [`  ${k}`, v.safe ? "safe" : c.yellow("--fix=all"), v.label])));
  return out.join("\n");
}

async function cmdHelp(flags, args, ctx) {
  const name = args[0] && (COMMANDS[args[0]] ? args[0] : ALIASES[args[0]]);
  if (args[0] && !name) throw new UsageError(`Unknown command “${args[0]}”. Run ofini help for the list.`);
  if (ctx.out.json) ctx.out.data(name ? { command: name, ...COMMANDS[name], run: undefined } : { commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, v]) => [k, v.summary])), exitCodes: Object.fromEntries(EXIT_CODES) });
  else ctx.out.result(name ? commandHelp(ctx.out.c, name) : generalHelp(ctx.out.c));
  return 0;
}

async function cmdCompletion(flags, args, ctx) {
  needArgs(args, 1, "shell (bash, zsh, fish or powershell)");
  const { completionScript } = await import("./completion.mjs");
  const s = completionScript(args[0], COMMANDS);
  if (!s) throw new UsageError(`Unknown shell “${args[0]}”. Shells: bash, zsh, fish, powershell.`);
  ctx.out.raw(s);
  return 0;
}

// ------------------------------------------------------------------------------------------------ main

/**
 * Runs one command line. Never throws; returns the exit code.
 * @param {string[]} argv arguments after "ofini"
 * @param {{ stdout, stderr, stdin?, env?, cwd?, readStdin?: () => Uint8Array, tmpdir?: string }} io
 */
export async function main(argv, io = {}) {
  io = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env, cwd: process.cwd(), ...io };
  let [cmd, ...rest] = argv;
  if (cmd === "-h" || cmd === "--help") (cmd = "help"), (rest = []);
  if (cmd && ALIASES[cmd]) cmd = ALIASES[cmd];
  const pre = { json: argv.includes("--json"), quiet: argv.includes("-q") || argv.includes("--quiet"), color: argv.includes("--no-color") ? false : argv.includes("--color") ? true : null };
  let out = createOutput({ ...io, ...pre });
  if (!cmd) {
    out.error("Missing command.");
    out.hint("Run “ofini help” for the commands, or start ofini in a terminal for interactive mode.");
    return EXIT.USAGE;
  }
  const def = COMMANDS[cmd];
  if (!def) {
    const near = Object.keys(COMMANDS).find((k) => k.startsWith(cmd.slice(0, 2)));
    out.error(`Unknown command “${cmd}”.${near ? ` Did you mean “${near}”?` : ""}`);
    out.hint("Run “ofini help” for the list of commands.");
    return EXIT.USAGE;
  }
  try {
    const { flags, args } = parseArgs(rest, def.flags);
    out = createOutput({ ...io, json: !!flags.json, quiet: !!flags.quiet, color: flags.color ?? null });
    if (flags.help) return cmdHelp({}, [cmd], { out, io, cwd: io.cwd });
    return await def.run(flags, args, { out, io, cwd: io.cwd });
  } catch (e) {
    if (e instanceof UsageError) {
      out.error(e.message);
      out.hint(`Usage: ${def.usage}   (ofini help ${cmd})`);
      return EXIT.USAGE;
    }
    if (e instanceof CliError) {
      out.error(e.message);
      return e.code;
    }
    out.error(`internal error: ${e?.stack || e}`);
    out.hint("Please report this at https://github.com/philppplik/open-fini/issues with the command you ran.");
    return EXIT.INTERNAL;
  }
}

export { ALIASES };
