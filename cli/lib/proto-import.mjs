// `ofini proto import`: HTML (static path), SVG, Sketch, Penpot exports and images into a new Proto design, or into an
// existing one (docs/cli.md ▸ Proto, docs/concepts/proto-studio.md §9 and §11, task T8). The importers are the app's
// (app/src/engine/proto/import/), so the CLI and the studio produce the same layers; HTML has no browser here, so its
// sizes and positions come from a static CSS cascade and are approximate.
import { basename } from "node:path";
import { importInto, designFromImport, applyImport, emptyDocument, FORMATS } from "../../app/src/engine/proto/import/index.js";
import { applyAll } from "../../app/src/engine/proto/ops.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { storeModel } from "../../app/src/engine/proto/format.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { UsageError } from "./args.mjs";
import { CliError, EXIT, createProject, writeOfini } from "./project.mjs";
import { readInput, writeOutput, replaceFile, needArgs, withoutExt, plural } from "./io.mjs";
import { readProto, assertWritable, protoBytes, findPage } from "./proto-model.mjs";

export async function cmdImport(flags, args, ctx) {
  needArgs(args, 1, "the file to import (HTML, SVG, .sketch, .penpot or an image)");
  if (flags.from && flags.from !== "image" && !FORMATS.includes(flags.from)) throw new UsageError(`--from must be one of ${FORMATS.join(", ")}.`);
  const width = flags.width !== undefined ? Number(flags.width) : 1280;
  if (!(width >= 100 && width <= 10000)) throw new UsageError("--width needs a number of pixels between 100 and 10000.");
  const seed = flags.seed !== undefined ? Number(flags.seed) : null;
  if (seed !== null && !Number.isInteger(seed)) throw new UsageError("--seed needs an integer.");
  const random = seed !== null ? seededRandom(seed) : undefined;
  const input = readInput(ctx, args[0], { name: flags.name });
  const name = input.path === "-" ? flags.name || "input.html" : basename(input.path);
  const into = flags.into;
  let model;
  let state = null;
  if (into) {
    const d = readInput(ctx, into);
    state = readProto(d.bytes, d.name);
    assertWritable(state);
    state.input = d;
    model = state.model;
  } else model = emptyDocument({ title: withoutExt(name), random });
  let result;
  try {
    result = importInto(model, { name, bytes: input.bytes, from: flags.from || null, width, random, pages: flags["one-page"] ? "current" : "new" });
  } catch (e) {
    throw new CliError(`${name}: ${e.message}`, e.code === "format" ? EXIT.UNSUPPORTED : EXIT.PROBLEMS);
  }
  let out;
  try {
    if (into) {
      const page = findPage(model, flags.page).id;
      out = applyAll(model, applyImport(result, { page })).model;
    } else out = designFromImport(model, result);
  } catch (e) {
    throw new CliError(`${name}: the import could not be applied (${e.message}).`, EXIT.PROBLEMS);
  }
  const v = validate(out);
  if (!v.ok) throw new CliError(`${name}: the imported design is not valid: ${v.errors.slice(0, 3).map((p) => p.message).join("; ")}`, EXIT.PROBLEMS);
  let written = null;
  if (!flags["dry-run"]) {
    if (into) {
      if (flags["in-place"] && flags.out) throw new UsageError("Use either --in-place or --out, not both.");
      if (flags["in-place"]) written = replaceFile(ctx, state.input.path, protoBytes(state, out, state.input.path));
      else if (flags.out) written = writeOutput(ctx, flags.out, protoBytes(state, out, flags.out), { force: !!flags.force });
      else throw new UsageError("With --into, choose where the design goes: --out <file>, --in-place, or --dry-run.");
    } else {
      const target = flags.out || (input.path === "-" ? "-" : `${withoutExt(input.path)}.ofini`);
      let bytes;
      if (/\.json$/i.test(target)) bytes = new TextEncoder().encode(`${JSON.stringify(storeModel(out), (k, v) => (v instanceof Uint8Array ? undefined : v), 2)}\n`);
      else {
        const doc = await createProject("proto", { title: withoutExt(name) });
        doc.office = new OfficeProject(storeModel(out), "proto");
        bytes = writeOfini(doc);
      }
      written = writeOutput(ctx, target, bytes, { force: !!flags.force });
    }
  }
  const layers = Object.keys(out.nodes).length - Object.keys(model.nodes).length;
  const summary = { file: args[0], format: result.report.format, written, layers, pages: result.pages.length, media: Object.keys(out.media || {}).length - Object.keys(model.media || {}).length, report: result.report.toJSON() };
  if (ctx.out.json) ctx.out.data(summary);
  else if (written !== "-") {
    const { c } = ctx.out;
    ctx.out.result(`${written ? `${c.green("wrote")} ${written}` : c.dim("dry run: valid")}: ${plural(layers, "layer")}${result.pages.length ? `, ${plural(result.pages.length, "page")}` : ""} from ${result.report.format}`);
    for (const [status, label, col] of [["flattened", "flattened", c.yellow], ["dropped", "not imported", c.red], ["note", "note", c.dim]]) for (const t of result.report.by(status)) ctx.out.print(`  ${col(label)} ${t}`);
  }
  return 0;
}

export const IMPORT_COMMAND = {
  summary: "Import HTML, SVG, Sketch, Penpot exports or images into a new design (or into a design)",
  usage: "ofini proto import <file|-> [--from html|svg|sketch|penpot|image] [--out <file.ofini>] [--width <px>]\n        ofini proto import <file> --into <design.ofini> [--page <p>] (--out <file> | --in-place | --dry-run)",
  flags: {
    name: { type: "string", desc: "File name to assume for standard input (-)" },
    from: { type: "string", desc: "Input format (default: from the name and content)" },
    out: { type: "string", short: "o", desc: "The design to write (default: <name>.ofini; .json writes the bare model without media)" },
    into: { type: "string", desc: "Add the import to this design instead of creating one" },
    page: { type: "string", short: "p", desc: "With --into: the page for layers (Sketch and Penpot pages become new pages)" },
    "one-page": { type: "bool", desc: "Put every Sketch or Penpot page on one page, side by side" },
    width: { type: "string", short: "w", desc: "HTML: the viewport width to lay out at (default 1280)" },
    seed: { type: "string", desc: "Seed for new ids (reproducible output)" },
    "in-place": { type: "bool", desc: "With --into: replace the design file (atomically)" },
    "dry-run": { type: "bool", short: "n", desc: "Check only; write nothing" },
    force: { type: "bool", short: "f", desc: "Overwrite existing files" },
  },
  details: ["HTML is laid out without a browser (approximate); the Proto Studio renders it in a sandboxed frame for exact boxes.", "Scripts never run and nothing remote is fetched. Figma .fig files are not supported (no public specification)."],
  run: cmdImport,
  examples: ["ofini proto import landing.html", "ofini proto import icons.svg --into app.ofini --in-place", "ofini proto import kit.sketch -o kit.ofini", "ofini proto import login.penpot --json", "curl -s https://example.com | ofini proto import - --name page.html -o page.ofini"],
};
