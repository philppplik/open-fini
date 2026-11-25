// File input and output shared by the `ofini` commands (main.mjs, proto.mjs): reading a file or standard input,
// writing without replacing existing files unless forced, atomic in-place writes, and running a command per file.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { UsageError } from "./args.mjs";
import { CliError, EXIT } from "./project.mjs";

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const withoutExt = (p) => p.slice(0, p.length - extname(p).length);

/** Reads a file (or standard input for "-") → { bytes, name, path, abs? }. */
export function readInput(ctx, path, { name } = {}) {
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

/** Writes a file (or standard output for "-"); an existing file is replaced only with `force`. */
export function writeOutput(ctx, path, data, { force = false } = {}) {
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

/** Replaces an existing file atomically: a temporary file next to it, renamed over the original. */
export function replaceFile(ctx, path, data) {
  const abs = resolve(ctx.cwd, path);
  const tmp = `${abs}.ofini-tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new CliError(`${path}: cannot write (${e.code || e.message}).`, EXIT.IO);
  }
  return path;
}

export function needArgs(args, n, what) {
  if (args.length < n) throw new UsageError(`Missing ${what}.`);
}

/** Runs `fn` for each file, collecting results; I/O errors of one file do not stop the others. */
export async function eachFile(ctx, files, fn) {
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

/** A file name from a label: no path separators, control or reserved characters. */
export function safeFileName(s, fallback) {
  const n = String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return n || fallback;
}
