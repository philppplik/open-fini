// Regenerates the self-contained vendor bundles that ship in app/vendor.
//
// Most vendored libraries (Shoelace, fflate, Inter) are copied verbatim from
// their npm tarballs. polygon-clipping and CodeMirror import bare modules, so they are
// bundled into single ESM files here so the app can run with no build step.
//
//   npm run vendor
import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "app", "vendor", "polygon-clipping");

await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, "node_modules", "polygon-clipping", "dist", "polygon-clipping.esm.js")],
  outfile: join(out, "polygon-clipping.js"),
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "none",
  target: "es2020",
});
await copyFile(join(root, "node_modules", "polygon-clipping", "LICENSE.md"), join(out, "LICENSE")).catch(() =>
  copyFile(join(root, "node_modules", "polygon-clipping", "LICENSE"), join(out, "LICENSE")),
);
console.log("vendor: polygon-clipping bundled ->", out);

// CodeMirror 6 (the Code studio's editor): many small packages bundled into one ESM file.
const cmOut = join(root, "app", "vendor", "codemirror");
await mkdir(cmOut, { recursive: true });
await build({
  entryPoints: [join(root, "scripts", "codemirror-entry.mjs")],
  outfile: join(cmOut, "codemirror.js"),
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "none",
  target: "es2020",
});
await copyFile(join(root, "node_modules", "@codemirror", "view", "LICENSE"), join(cmOut, "LICENSE"));
console.log("vendor: CodeMirror bundled ->", cmOut);
