// Regenerates every raster icon from the two SVG masters in app/icons.
//
//   npm run icons
//
// Inputs   app/icons/icon.svg            rounded tile (96% of the canvas; Windows, Linux, PWA), transparent corners
//          app/icons/icon-macos.svg      same art on the macOS grid (824/1024 tile) for icon.icns
//          app/icons/icon-maskable.svg   full-bleed square for adaptive icons
// Outputs  src-tauri/icons/*             what the desktop bundles need (and nothing else)
//          app/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
//
//          app/icons/doc-icon.svg        document icon (page with folded corner + the mark) for .ofini files
//   ->     src-tauri/icons/ofini-doc.ico, ofini-doc.icns   (Windows / macOS document type icon)
//          src-tauri/linux/application-x-openfini.svg, .png (Linux MIME icon)
//
//   npm run icons -- --only=doc   regenerates just the document icons
//
// The raster work is done by the Tauri CLI that is already a devDependency
// (it renders SVG with resvg), so this adds no dependencies of its own.
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const appIcons = join(root, "app", "icons");
const desktopIcons = join(root, "src-tauri", "icons");

/** Files of the default `tauri icon` output that desktop bundles use. */
const onlyDoc = process.argv.includes("--only=doc");
const linuxDir = join(root, "src-tauri", "linux");

const DESKTOP_FILES = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.icns", "icon.ico"];

function tauriIcon(input, output, extraArgs = []) {
  const res = spawnSync(process.execPath, [tauriCli, "icon", input, "-o", output, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`tauri icon failed for ${input}\n${res.stdout}\n${res.stderr}`);
  }
}

const work = await mkdtemp(join(tmpdir(), "openfini-icons-"));
try {
  if (!onlyDoc) {
  // 1. Desktop set. `tauri icon` also emits Windows Store, iOS and Android assets;
  //    we keep only the files that the desktop bundlers read.
  const full = join(work, "desktop");
  tauriIcon(join(appIcons, "icon.svg"), full);
  await mkdir(desktopIcons, { recursive: true });
  for (const name of DESKTOP_FILES) {
    await copyFile(join(full, name), join(desktopIcons, name));
  }
  // macOS adds its own padding, so its .icns comes from the standard-grid master (824/1024 tile).
  const mac = join(work, "macos");
  tauriIcon(join(appIcons, "icon-macos.svg"), mac);
  await copyFile(join(mac, "icon.icns"), join(desktopIcons, "icon.icns"));

  // 2. PWA set.
  const any = join(work, "any");
  tauriIcon(join(appIcons, "icon.svg"), any, ["--png", "192,512"]);
  await copyFile(join(any, "192x192.png"), join(appIcons, "icon-192.png"));
  await copyFile(join(any, "512x512.png"), join(appIcons, "icon-512.png"));

  const maskable = join(work, "maskable");
  tauriIcon(join(appIcons, "icon-maskable.svg"), maskable, ["--png", "180,512"]);
  await copyFile(join(maskable, "512x512.png"), join(appIcons, "icon-maskable-512.png"));
  // iOS rounds the corners itself and wants an opaque square, so use the full-bleed art.
  await copyFile(join(maskable, "180x180.png"), join(appIcons, "apple-touch-icon.png"));
  }

  // 3. Document type icons (.ofini, .ofext): Windows .ico, macOS .icns, Linux MIME icon.
  const doc = join(work, "doc");
  tauriIcon(join(appIcons, "doc-icon.svg"), doc);
  await copyFile(join(doc, "icon.ico"), join(desktopIcons, "ofini-doc.ico"));
  await copyFile(join(doc, "icon.icns"), join(desktopIcons, "ofini-doc.icns"));
  await mkdir(linuxDir, { recursive: true });
  await copyFile(join(appIcons, "doc-icon.svg"), join(linuxDir, "application-x-openfini.svg"));
  await copyFile(join(doc, "128x128@2x.png"), join(linuxDir, "application-x-openfini.png"));
} finally {
  await rm(work, { recursive: true, force: true });
}

for (const f of onlyDoc ? [] : DESKTOP_FILES) {
  const s = await stat(join(desktopIcons, f));
  console.log(`icons: src-tauri/icons/${f} (${s.size} B)`);
}
for (const f of onlyDoc ? [] : ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
  const s = await stat(join(appIcons, f));
  console.log(`icons: app/icons/${f} (${s.size} B)`);
}
for (const f of ["icons/ofini-doc.ico", "icons/ofini-doc.icns", "linux/application-x-openfini.svg", "linux/application-x-openfini.png"]) {
  const s = await stat(join(root, "src-tauri", f));
  console.log(`icons: src-tauri/${f} (${s.size} B)`);
}
