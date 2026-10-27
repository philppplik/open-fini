// Installer artwork and configuration: the generated images have the exact format NSIS / the DMG need,
// tauri.conf.json only references files that exist, and the custom NSIS template stays wired up.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ASSETS, decodePng, encodeBmp, encodePng } from "../../scripts/installer-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const nsis = conf.bundle.windows.nsis;
const installerDir = join(root, "src-tauri", "installer");

/** Width, height, bit depth and compression of a BMP file (BITMAPINFOHEADER). */
function bmpInfo(buf) {
  assert.equal(buf.toString("ascii", 0, 2), "BM", "BMP signature");
  return { size: buf.readUInt32LE(2), width: buf.readInt32LE(18), height: buf.readInt32LE(22), bits: buf.readUInt16LE(28), compression: buf.readUInt32LE(30) };
}

describe("installer artwork", () => {
  it("Windows sidebar is a 164x314 uncompressed 24-bit BMP", () => {
    const buf = readFileSync(join(installerDir, "sidebar.bmp"));
    const i = bmpInfo(buf);
    assert.deepEqual([i.width, i.height, i.bits, i.compression], [164, 314, 24, 0]);
    assert.equal(i.size, buf.length);
  });

  it("Windows header is a 150x57 uncompressed 24-bit BMP", () => {
    const buf = readFileSync(join(installerDir, "header.bmp"));
    const i = bmpInfo(buf);
    assert.deepEqual([i.width, i.height, i.bits, i.compression], [150, 57, 24, 0]);
    assert.equal(i.size, buf.length);
  });

  it("DMG background exists at 1x (660x400, matches the window size) and 2x", () => {
    const one = decodePng(readFileSync(join(installerDir, "dmg-background.png")));
    const two = decodePng(readFileSync(join(installerDir, "dmg-background@2x.png")));
    assert.deepEqual([one.width, one.height], [660, 400]);
    assert.deepEqual([two.width, two.height], [1320, 800]);
    assert.deepEqual(conf.bundle.macOS.dmg.windowSize, { width: 660, height: 400 });
  });

  it("every asset listed by the generator has an SVG source and an output", () => {
    for (const a of ASSETS) {
      assert.ok(existsSync(join(installerDir, a.svg)), a.svg);
      assert.ok(existsSync(join(installerDir, a.out)), a.out);
    }
  });

  it("encoders round-trip pixels", () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 1, 2, 3, 255, 4, 5, 6, 255]);
    const img = { width: 3, height: 2, rgba };
    assert.deepEqual([...decodePng(encodePng(img)).rgba], [...rgba]);
    const bmp = encodeBmp(img);
    assert.deepEqual([bmpInfo(bmp).width, bmpInfo(bmp).height, bmpInfo(bmp).bits], [3, 2, 24]);
    assert.equal(bmp.length, 54 + 12 * 2); // rows are padded to 4 bytes (9 -> 12)
    assert.deepEqual([...bmp.subarray(54, 57)], [30, 20, 10]); // bottom row first, BGR order
  });
});

describe("tauri.conf.json installer references", () => {
  const srcTauri = (rel) => join(root, "src-tauri", rel);

  it("NSIS images, icons, template and hooks exist", () => {
    for (const key of ["installerIcon", "uninstallerIcon", "sidebarImage", "headerImage", "uninstallerHeaderImage", "template", "installerHooks"]) {
      assert.ok(nsis[key], `bundle.windows.nsis.${key} is set`);
      assert.ok(existsSync(srcTauri(nsis[key])), `${key} -> ${nsis[key]}`);
    }
    assert.ok(nsis.sidebarImage.endsWith(".bmp") && nsis.headerImage.endsWith(".bmp"), "MUI2 needs BMP images");
  });

  it("installs per user without an admin prompt", () => {
    assert.equal(nsis.installMode, "currentUser");
  });

  it("DMG background exists and positions are inside the window", () => {
    const dmg = conf.bundle.macOS.dmg;
    assert.ok(existsSync(srcTauri(dmg.background)), dmg.background);
    for (const p of [dmg.appPosition, dmg.applicationFolderPosition]) {
      assert.ok(p.x > 0 && p.x < dmg.windowSize.width && p.y > 0 && p.y < dmg.windowSize.height);
    }
    assert.ok(dmg.appPosition.x < dmg.applicationFolderPosition.x);
  });

  it("every configured icon file exists", () => {
    for (const icon of conf.bundle.icon) assert.ok(existsSync(srcTauri(icon)), icon);
  });
});

describe("custom NSIS template", () => {
  const tpl = read("src-tauri/windows/installer.nsi");

  it("keeps the placeholders the Tauri bundler fills in", () => {
    for (const ph of ["{{compression}}", "{{installer_hooks}}", "{{product_name}}", "{{version}}", "{{license}}", "{{sidebar_image}}", "{{header_image}}", "{{main_binary_path}}", "{{#each languages}}", "{{#each file_associations as |association| ~}}", "{{#each resources}}"]) {
      assert.ok(tpl.includes(ph), `template contains ${ph}`);
    }
  });

  it("calls the installer hooks and has the integration page, finish page and persistence", () => {
    for (const s of ["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_POSTINSTALL", "NSIS_HOOK_PREUNINSTALL", "NSIS_HOOK_POSTUNINSTALL", "Page custom PageIntegration PageIntegrationLeave", "MUI_FINISHPAGE_RUN", "MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenQuickStart", "DeleteAppDataCheckbox"]) {
      assert.ok(tpl.includes(s), s);
    }
    assert.ok(tpl.indexOf("Page custom PageIntegration") < tpl.indexOf("!insertmacro MUI_PAGE_INSTFILES"), "options page comes before the install page");
  });

  it("balances every block directive (a cheap syntax check; makensis is not available in CI for tests)", () => {
    const strip = tpl.split("\n").map((l) => l.replace(/;.*$/, "").trim());
    const count = (re) => strip.filter((l) => re.test(l)).length;
    assert.equal(count(/^Function /), count(/^FunctionEnd/), "Function / FunctionEnd");
    assert.equal(count(/^Section\b/), count(/^SectionEnd/), "Section / SectionEnd");
    assert.equal(count(/^!if/), count(/^!endif/), "!if / !endif");
    assert.equal(count(/^\$\{If(Not)?\}/), count(/^\$\{EndIf\}/), "If / EndIf");
  });

  it("installer language follows Windows: English and German, no language dialog, every custom string translated", () => {
    assert.deepEqual(nsis.languages, ["English", "German"]);
    assert.equal(nsis.displayLanguageSelector, false);
    const names = (lang) => [...tpl.matchAll(/^LangString (\w+) \$\{LANG_(\w+)\}/gm)].filter((m) => m[2] === lang).map((m) => m[1]).sort();
    const en = names("ENGLISH");
    assert.ok(en.length >= 10, "custom strings exist");
    assert.deepEqual(names("GERMAN"), en, "German covers every English string");
    // No hard-coded English left in the custom pages: they use $(name) lookups.
    const hook = read("src-tauri/windows/open-with.nsh");
    for (const n of en) assert.ok(tpl.includes(`$(${n})`) || hook.includes(`$(${n})`), `$(${n}) is used`);
  });

  it("the app icon is the light tile with a dark mark everywhere", () => {
    for (const f of ["icon.svg", "icon-macos.svg", "icon-maskable.svg", "doc-icon.svg"]) {
      const svg = read(`app/icons/${f}`);
      assert.ok(svg.includes("#111114"), `${f} has the dark mark`);
      assert.ok(!svg.includes("linearGradient"), `${f} has no gradient`);
    }
    assert.ok(!existsSync(join(root, "app/icons/icon-light.svg")));
  });

  it("the hook honours the open-with choice and still removes everything on uninstall", () => {
    const hook = read("src-tauri/windows/open-with.nsh");
    assert.match(hook, /\$\{If\} \$OpenWithChoice = 1/);
    for (const s of ["DeleteRegKey SHCTX \"Software\\OpenFini\"", "DeleteRegKey SHCTX \"Software\\Classes\\OpenFini.File\"", "RegisteredApplications"]) {
      assert.ok(hook.includes(s), s);
    }
  });

  it("registers the folder right-click verbs (default on, remembered, removed on uninstall)", () => {
    const hook = read("src-tauri/windows/open-with.nsh");
    const install = hook.slice(hook.indexOf("!macro NSIS_HOOK_POSTINSTALL"), hook.indexOf("!macro NSIS_HOOK_PREUNINSTALL"));
    const uninstall = hook.slice(hook.indexOf("!macro NSIS_HOOK_PREUNINSTALL"));
    assert.match(install, /\$\{If\} \$FolderChoice = 1/);
    assert.ok(install.includes('"Software\\Classes\\Directory\\shell\\OpenFini\\command" "" "$\\"$INSTDIR\\${MAINBINARYNAME}.exe$\\" $\\"%1$\\""'), "folder verb passes %1");
    assert.ok(install.includes('"Software\\Classes\\Directory\\Background\\shell\\OpenFini\\command" "" "$\\"$INSTDIR\\${MAINBINARYNAME}.exe$\\" $\\"%V$\\""'), "background verb passes %V");
    assert.ok(!/HKCU|HKLM/.test(install.replace(/;.*$/gm, "")), "uses SHCTX so per-user installs need no administrator rights");
    for (const key of ["Directory\\shell\\OpenFini", "Directory\\Background\\shell\\OpenFini"]) assert.ok(uninstall.includes(`DeleteRegKey SHCTX "Software\\Classes\\${key}"`), key);
    // the page, the default (on), the remembered choice and the strings
    for (const s of ["Var FolderChoice", "StrCpy $FolderChoice 1", '"FolderMenu"', "$(optFolder)", "LangString folderVerb ${LANG_GERMAN}"]) assert.ok(tpl.includes(s), s);
    assert.ok(hook.includes("$(folderVerb)"), "the verb label is a translated string");
  });
});
