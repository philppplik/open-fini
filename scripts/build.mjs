// Production build: app/ -> dist/ (used for the PWA and as the Tauri frontend).
//
//   npm run build
//   node scripts/build.mjs [--root app] [--out dist] [--version 1.2.3] [--target es2022] [--no-minify] [--quiet]
//
// What it does, in order:
//   1. copies app/ to dist/ (without sourcemaps, OS junk and unused Shoelace translations);
//   2. bundles + minifies every <script type="module" src> of index.html with esbuild
//      into content-hashed files in dist/assets/ (code splitting follows import());
//      files in app/vendor/shoelace stay untouched and external, because the Shoelace
//      autoloader imports its components at runtime by URL;
//   3. bundles Web Workers created with `new Worker(new URL("./w.js", import.meta.url))`
//      in place, and rewrites such `new URL(..., import.meta.url)` references so they
//      still resolve from dist/assets/;
//   4. minifies the <link rel="stylesheet"> files into content-hashed files;
//   5. rewrites index.html (adds modulepreload hints for the entry's static imports);
//   6. injects the build version and the precache manifest into sw.js;
//   7. writes dist/build-info.json.
//
// Conventions the app must follow (see docs/building.md): import() specifiers and
// new URL(..., import.meta.url) arguments must be string literals.
import { build as esbuild, transform } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- small helpers

const toPosix = (p) => p.split(sep).join("/");
const sha = (data, length = 8) => createHash("sha256").update(data).digest("hex").slice(0, length);
const exists = (p) => stat(p).then(() => true, () => false);

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** URL path from directory `fromDir` to file `to`, always starting with "./" or "../". */
function urlFrom(fromDir, to) {
  const rel = toPosix(relative(fromDir, to));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Like urlFrom() for a folder; the result always ends with "/". */
function folderUrl(fromDir, folder) {
  const rel = toPosix(relative(fromDir, folder));
  if (rel === "") return "./";
  return `${rel.startsWith(".") ? rel : `./${rel}`}/`;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function removeEmptyDirs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmptyDirs(join(dir, entry.name));
  }
  if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true });
}

// ----------------------------------------------------------------- HTML helpers

const TAG_RE = /<(script|link)\b[^>]*>/gi;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(tag) {
  const attrs = {};
  const inner = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`, "i");
  return tag.replace(re, `$1"${value}"`);
}

const isLocalUrl = (url) => Boolean(url) && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

/** Resolves a URL from index.html to a file below `root` (query and hash dropped). */
function fileFromUrl(root, htmlDir, url) {
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  return clean.startsWith("/") ? join(root, clean) : resolve(htmlDir, clean);
}

// ------------------------------------------------------------------- the build

/**
 * @param {object} [options]
 * @param {string} [options.root]     source folder (default <project>/app)
 * @param {string} [options.out]      output folder (default <project>/dist)
 * @param {string} [options.version]  overrides "<package version>-<content hash>"
 * @param {string} [options.target]   esbuild JS target, default "es2022" (needed for top-level await)
 * @param {boolean} [options.minify]  default true
 * @param {boolean} [options.quiet]
 */
export async function build({
  root = join(projectRoot, "app"),
  out = join(projectRoot, "dist"),
  version,
  target = "es2022",
  minify = true,
  quiet = false,
} = {}) {
  root = resolve(root);
  out = resolve(out);
  const log = quiet ? () => {} : (...args) => console.log(...args);

  if (!(await exists(join(root, "index.html")))) throw new Error(`No index.html in ${root}`);
  if (out === root || isInside(root, out) || isInside(out, root) || dirname(out) === out) {
    throw new Error(`Refusing to build into ${out}: it overlaps the source folder ${root}.`);
  }

  const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const assetsDir = join(out, "assets");
  const shoelaceDir = join(root, "vendor", "shoelace");
  const codemirrorDir = join(root, "vendor", "codemirror");
  const pdfjsDir = join(root, "vendor", "pdfjs");
  const katexDir = join(root, "vendor", "katex");
  const distOf = (sourceFile) => join(out, relative(root, sourceFile));

  // 1. Copy -----------------------------------------------------------------
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(root, out, {
    recursive: true,
    filter: (source) => {
      const rel = toPosix(relative(root, source));
      const name = basename(source);
      if (/\.map$/i.test(name) || /\.d\.ts$/i.test(name)) return false;
      if ([".DS_Store", "Thumbs.db", "desktop.ini"].includes(name)) return false;
      // Shoelace ships many translations; the app only needs the built-in English one.
      if (/^vendor\/shoelace\/translations\/.+/.test(rel) && name !== "en.js") return false;
      return true;
    },
  });

  // Bundled extensions (data, not code of the app): the catalog and the packed .ofext files are served next to the
  // app so the extension manager can offer them. Only for the real app source; never precached (see below).
  if (root === join(projectRoot, "app") && (await exists(join(projectRoot, "extensions", "catalog.json")))) {
    await mkdir(join(out, "extensions"), { recursive: true });
    await cp(join(projectRoot, "extensions", "catalog.json"), join(out, "extensions", "catalog.json"));
    if (await exists(join(projectRoot, "extensions", "packages"))) await cp(join(projectRoot, "extensions", "packages"), join(out, "extensions", "packages"), { recursive: true });
  }

  // 2. Find what index.html references ----------------------------------------
  const indexPath = join(out, "index.html");
  const html = await readFile(indexPath, "utf8");
  const scriptEntries = []; // { tag, src, file }
  const styleEntries = []; // { tag, href, file }
  for (const match of html.matchAll(TAG_RE)) {
    const tag = match[0];
    const attrs = parseAttrs(tag);
    if (match[1].toLowerCase() === "script" && attrs.type === "module" && isLocalUrl(attrs.src)) {
      const file = fileFromUrl(root, root, attrs.src);
      if (isInside(file, shoelaceDir)) continue; // loaded as is
      if (!(await exists(file))) throw new Error(`index.html references ${attrs.src}, but ${file} does not exist.`);
      scriptEntries.push({ tag, src: attrs.src, file });
    } else if (match[1].toLowerCase() === "link" && /\bstylesheet\b/i.test(attrs.rel ?? "") && isLocalUrl(attrs.href)) {
      const file = fileFromUrl(root, root, attrs.href);
      if (isInside(file, join(root, "vendor"))) continue; // vendored CSS is shipped as is
      if (!(await exists(file))) throw new Error(`index.html references ${attrs.href}, but ${file} does not exist.`);
      styleEntries.push({ tag, href: attrs.href, file });
    }
  }

  // 3. JavaScript -------------------------------------------------------------
  const workerEntries = new Set();
  const inlinedSources = new Set();

  function makePlugins(outDir) {
    return [
      {
        name: "openfini-externals",
        setup(b) {
          // Shoelace stays a set of real files: reference them by URL, relative to the output.
          b.onResolve({ filter: /shoelace/ }, async (args) => {
            if (args.pluginData?.skipExternals || args.kind === "entry-point") return undefined;
            const resolved = await b.resolve(args.path, {
              importer: args.importer,
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: { skipExternals: true },
            });
            if (resolved.errors.length > 0 || !isInside(resolved.path, shoelaceDir)) return undefined;
            return { path: urlFrom(outDir, distOf(resolved.path)), external: true };
          });
          // The Code studio's editor (CodeMirror) is a vendored, already minified bundle. Keeping it a separate
          // file means it is fetched only when the studio is opened and does not count as application code.
          b.onResolve({ filter: /vendor\/(codemirror|pdfjs|katex)\// }, async (args) => {
            if (args.pluginData?.skipExternals || args.kind === "entry-point") return undefined;
            const resolved = await b.resolve(args.path, {
              importer: args.importer,
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: { skipExternals: true },
            });
            if (resolved.errors.length > 0 || !(isInside(resolved.path, codemirrorDir) || isInside(resolved.path, pdfjsDir) || isInside(resolved.path, katexDir))) return undefined;
            return { path: urlFrom(outDir, distOf(resolved.path)), external: true };
          });
          // new URL("./file", import.meta.url) points at a file next to the source module; after
          // bundling the code lives in another folder, so point it at the copy in dist/ instead.
          // Two forms are handled: a plain string, and a template literal whose static folder
          // prefix is rewritten (`../assets/icons/${name}.svg`).
          b.onLoad({ filter: /\.m?js$/ }, async (args) => {
            if (isInside(args.path, shoelaceDir)) return undefined;
            const source = await readFile(args.path, "utf8");
            if (!source.includes("import.meta.url")) return undefined;
            const re = /new\s+URL\(\s*(["'`])(\.{1,2}\/[^"'`$]*)((?:\$\{[^`]*)?)\1\s*,\s*import\.meta\.url\s*\)/g;
            let changed = false;
            const contents = source.replace(re, (whole, quote, prefix, dynamic, offset) => {
              if (dynamic && quote !== "`") return whole;
              if (!dynamic) {
                const target = resolve(dirname(args.path), prefix.split(/[?#]/)[0]);
                if (!isInside(target, root)) return whole;
                const suffix = prefix.slice(prefix.split(/[?#]/)[0].length);
                if (/new\s+(?:Shared)?Worker\(\s*$/.test(source.slice(Math.max(0, offset - 40), offset))) {
                  workerEntries.add(target);
                }
                changed = true;
                return `new URL(${quote}${urlFrom(outDir, distOf(target))}${suffix}${quote}, import.meta.url)`;
              }
              // Dynamic: only the folder part before the first ${...} can be rewritten.
              const slash = prefix.lastIndexOf("/");
              const folder = resolve(dirname(args.path), prefix.slice(0, slash + 1));
              if (!isInside(folder, root) && folder !== root) return whole;
              changed = true;
              return `new URL(\`${folderUrl(outDir, distOf(folder))}${prefix.slice(slash + 1)}${dynamic}\`, import.meta.url)`;
            });
            return changed ? { contents, loader: "js", resolveDir: dirname(args.path) } : undefined;
          });
        },
      },
    ];
  }

  const baseOptions = {
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    target,
    platform: "browser",
    minify,
    legalComments: "none", // licenses of vendored code stay next to the vendored files
    charset: "utf8",
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
    define: { "process.env.NODE_ENV": '"production"' },
  };

  const scriptMap = new Map(); // original src attribute -> { url, preloads[] }
  const extraCss = [];
  let outputs = {};
  let appMetafile = null; // esbuild metafile of the app bundle, returned for scripts/analyze-bundle.mjs
  if (scriptEntries.length > 0) {
    const names = new Map();
    const entryPoints = scriptEntries.map(({ file }) => {
      let name = basename(file, extname(file));
      const count = names.get(name) ?? 0;
      names.set(name, count + 1);
      if (count > 0) name += `-${count}`;
      return { in: file, out: name };
    });
    const result = await esbuild({
      ...baseOptions,
      entryPoints,
      outdir: assetsDir,
      splitting: true,
      entryNames: "[name]-[hash]",
      chunkNames: "chunk-[hash]",
      plugins: makePlugins(assetsDir),
    });
    appMetafile = result.metafile;
    outputs = Object.fromEntries(Object.entries(result.metafile.outputs).map(([k, v]) => [resolve(root, k), v]));
    for (const input of Object.keys(result.metafile.inputs)) inlinedSources.add(resolve(root, input));

    const staticImports = (outFile, seen = new Set()) => {
      for (const imp of outputs[outFile]?.imports ?? []) {
        const target = resolve(root, imp.path);
        if (imp.kind !== "import-statement" || imp.external || !outputs[target] || seen.has(target)) continue;
        seen.add(target);
        staticImports(target, seen);
      }
      return seen;
    };
    for (const entry of scriptEntries) {
      const outFile = Object.keys(outputs).find(
        (f) => outputs[f].entryPoint && resolve(root, outputs[f].entryPoint) === entry.file,
      );
      if (!outFile) throw new Error(`esbuild produced no output for ${entry.src}`);
      scriptMap.set(entry.src, {
        url: urlFrom(out, outFile),
        preloads: [...staticImports(outFile)].map((f) => urlFrom(out, f)),
      });
      if (outputs[outFile].cssBundle) extraCss.push(urlFrom(out, resolve(root, outputs[outFile].cssBundle)));
    }
  }

  // Workers: bundled in place (same path in dist/), so their own relative URLs keep working.
  const builtWorkers = new Set();
  while (true) {
    const pending = [...workerEntries].filter((f) => !builtWorkers.has(f));
    if (pending.length === 0) break;
    for (const file of pending) {
      builtWorkers.add(file);
      if (!(await exists(file))) {
        console.warn(`build: worker ${relative(root, file)} referenced via new URL() does not exist`);
        continue;
      }
      const outFile = distOf(file);
      const result = await esbuild({
        ...baseOptions,
        entryPoints: [file],
        outfile: outFile,
        allowOverwrite: true,
        plugins: makePlugins(dirname(outFile)),
      });
      for (const input of Object.keys(result.metafile.inputs)) inlinedSources.add(resolve(root, input));
    }
  }

  // Sources that now live inside a bundle do not need to ship separately.
  for (const source of inlinedSources) {
    if (!isInside(source, root) || isInside(source, shoelaceDir) || workerEntries.has(source)) continue;
    await rm(distOf(source), { force: true });
  }

  // 4. CSS --------------------------------------------------------------------
  const minifyCss = async (code) => (await transform(code, { loader: "css", minify, charset: "utf8", legalComments: "none" })).code;
  const cssMap = new Map();
  const hashedCss = new Set();
  const allCss = (await walk(out)).filter((f) => f.endsWith(".css") && !isInside(f, join(out, "vendor")));
  for (const entry of styleEntries) {
    const code = await minifyCss(await readFile(entry.file, "utf8"));
    const target = join(dirname(distOf(entry.file)), `${basename(entry.file, ".css")}-${sha(code)}.css`);
    await writeFile(target, code);
    hashedCss.add(target);
    cssMap.set(entry.href, urlFrom(out, target));
    // Keep the original when another stylesheet @imports it by name.
    const original = distOf(entry.file);
    let referenced = false;
    for (const other of allCss) {
      if (other === original || !(await exists(other))) continue; // an earlier entry may already have replaced its source
      if ((await readFile(other, "utf8")).includes(basename(original))) referenced = true;
    }
    if (referenced) {
      await writeFile(original, await minifyCss(await readFile(original, "utf8")));
    } else {
      await rm(original, { force: true });
    }
  }
  for (const file of allCss) {
    // Remaining stylesheets (imported by others, loaded at runtime): minify in place.
    if (!(await exists(file)) || hashedCss.has(file)) continue;
    await writeFile(file, await minifyCss(await readFile(file, "utf8")));
  }

  // 5. index.html ---------------------------------------------------------------
  let rewritten = html.replace(TAG_RE, (tag) => {
    const attrs = parseAttrs(tag);
    if (attrs.src && scriptMap.has(attrs.src) && /^<script/i.test(tag)) {
      const { url, preloads } = scriptMap.get(attrs.src);
      const hints = preloads.map((p) => `<link rel="modulepreload" href="${p}">\n    `).join("");
      return `${hints}${setAttr(tag, "src", url)}`;
    }
    if (attrs.href && cssMap.has(attrs.href) && /^<link/i.test(tag)) return setAttr(tag, "href", cssMap.get(attrs.href));
    return tag;
  });
  if (extraCss.length > 0) {
    const links = extraCss.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n    ");
    rewritten = rewritten.replace(/<\/head>/i, `    ${links}\n  </head>`);
  }
  await writeFile(indexPath, rewritten);

  await removeEmptyDirs(out);

  // 6. Service worker --------------------------------------------------------------
  const swPath = join(out, "sw.js");
  const infoPath = join(out, "build-info.json");
  const precacheExcluded = (rel) =>
    rel === "sw.js" ||
    rel === "build-info.json" ||
    rel.startsWith("extensions/") || // bundled extensions are fetched on demand when the user installs one
    /\.map$/.test(rel) ||
    /^vendor\/(pdfjs|katex)\//.test(rel) || // large and on demand: the service worker caches them on first use
    /^(LICENSE|COPYING|NOTICE)/i.test(basename(rel)) ||
    (rel.startsWith("vendor/") && /\.(md|txt)$/i.test(rel));

  const manifest = [];
  let totalBytes = 0;
  for (const file of (await walk(out)).sort()) {
    const rel = toPosix(relative(out, file));
    const data = await readFile(file);
    totalBytes += data.length;
    if (!precacheExcluded(rel)) manifest.push([rel, sha(data, 12)]);
  }
  const buildHash = sha(JSON.stringify(manifest));
  const buildVersion = version ?? `${pkg.version}-${buildHash}`;

  if (await exists(swPath)) {
    let sw = await readFile(swPath, "utf8");
    if (!sw.includes("@@BUILD_VERSION@@") || !/\/\*@@PRECACHE_MANIFEST@@\*\/\s*\[\]/.test(sw)) {
      throw new Error("sw.js is missing its @@BUILD_VERSION@@ / PRECACHE_MANIFEST tokens.");
    }
    sw = sw.replace("@@BUILD_VERSION@@", () => buildVersion);
    sw = sw.replace(/\/\*@@PRECACHE_MANIFEST@@\*\/\s*\[\]/, () => JSON.stringify(manifest));
    await writeFile(swPath, minify ? (await transform(sw, { loader: "js", minify: true, target, legalComments: "none" })).code : sw);
  } else {
    console.warn("build: app/sw.js not found; the build will not work offline.");
  }

  // 7. Build info ------------------------------------------------------------------
  const info = {
    name: pkg.name,
    version: pkg.version,
    buildId: buildVersion,
    commit: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : null,
    builtAt: new Date().toISOString(),
    precachedFiles: manifest.length,
    totalBytes,
  };
  await writeFile(infoPath, `${JSON.stringify(info, null, 2)}\n`);

  log(`build: ${relative(projectRoot, root) || "."} -> ${relative(projectRoot, out) || "."}`);
  log(`build: version ${buildVersion}, ${manifest.length} precached files, ${(totalBytes / 1024).toFixed(1)} KiB total`);
  return { out, version: buildVersion, files: manifest.length, totalBytes, manifest, metafile: appMetafile, root };
}

// ------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "--root") options.root = resolve(value());
    else if (arg === "--out") options.out = resolve(value());
    else if (arg === "--version") options.version = value();
    else if (arg === "--target") options.target = value();
    else if (arg === "--no-minify") options.minify = false;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build.mjs [--root <dir>] [--out <dir>] [--version <v>] [--target <es>] [--no-minify] [--quiet]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await build(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`build: ${err.message}`);
    process.exit(1);
  }
}
