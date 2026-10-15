// Keeps the three version numbers of OpenFini in sync and checks release tags.
//
//   node scripts/version.mjs check [--tag v1.2.3]   verify package.json, package-lock.json,
//                                                   src-tauri/Cargo.toml (and Cargo.lock) agree
//                                                   (and match the tag, when given)
//   node scripts/version.mjs set 1.2.3              write the version to all of them
//
// tauri.conf.json reads its version from ../package.json, so it needs no edit.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  pkg: join(root, "package.json"),
  lock: join(root, "package-lock.json"),
  cargo: join(root, "src-tauri", "Cargo.toml"),
  cargoLock: join(root, "src-tauri", "Cargo.lock"),
};

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const read = (file) => readFile(file, "utf8");
const readOptional = (file) => read(file).catch((err) => (err.code === "ENOENT" ? null : Promise.reject(err)));

/** The `version = "x"` line of the [package] table of a Cargo.toml. */
export function cargoVersion(toml) {
  const table = toml.match(/^\[package\][\s\S]*?(?=^\[|$(?![\s\S]))/m)?.[0] ?? "";
  return table.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/** The version of the `openfini` entry in a Cargo.lock, or null. */
export function cargoLockVersion(lock) {
  return lock.match(/\[\[package\]\]\s*\nname = "openfini"\s*\nversion = "([^"]+)"/)?.[1] ?? null;
}

export async function readVersions() {
  const pkg = JSON.parse(await read(files.pkg));
  const lock = JSON.parse((await readOptional(files.lock)) ?? "null");
  const cargo = cargoVersion(await read(files.cargo));
  const cargoLock = await readOptional(files.cargoLock);
  return {
    "package.json": pkg.version,
    ...(lock ? { "package-lock.json": lock.version, "package-lock.json (root package)": lock.packages?.[""]?.version } : {}),
    "src-tauri/Cargo.toml": cargo,
    ...(cargoLock ? { "src-tauri/Cargo.lock": cargoLockVersion(cargoLock) } : {}),
  };
}

async function check(tag) {
  const versions = await readVersions();
  const expected = tag ? tag.replace(/^v/, "") : versions["package.json"];
  let ok = true;
  if (!SEMVER.test(expected)) {
    console.error(`version: "${expected}" is not a valid semantic version (expected 1.2.3 or 1.2.3-beta.1)`);
    ok = false;
  }
  for (const [file, version] of Object.entries(versions)) {
    if (version === undefined || version === null) continue;
    const same = version === expected;
    if (!same) ok = false;
    console.log(`${same ? "ok   " : "FAIL "} ${file}: ${version}${same ? "" : ` (expected ${expected})`}`);
  }
  if (!ok) {
    console.error(`\nversion: mismatch. Run "node scripts/version.mjs set ${expected}" or fix the tag.`);
    process.exit(1);
  }
  console.log(`\nversion: ${expected}`);
}

async function set(version) {
  if (!SEMVER.test(version ?? "")) {
    console.error('version: usage: node scripts/version.mjs set <major.minor.patch[-prerelease]> (no leading "v")');
    process.exit(2);
  }
  const pkgText = await read(files.pkg);
  await writeFile(files.pkg, pkgText.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`));

  const lockText = await readOptional(files.lock);
  if (lockText) {
    const lock = JSON.parse(lockText);
    lock.version = version;
    if (lock.packages?.[""]) lock.packages[""].version = version;
    await writeFile(files.lock, `${JSON.stringify(lock, null, 2)}\n`);
  }

  const cargo = await read(files.cargo);
  await writeFile(files.cargo, cargo.replace(/^(\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m, `$1${version}$2`));

  const cargoLock = await readOptional(files.cargoLock);
  if (cargoLock) {
    await writeFile(files.cargoLock, cargoLock.replace(/(\[\[package\]\]\s*\nname = "openfini"\s*\nversion = ")[^"]*(")/, `$1${version}$2`));
  }
  console.log(`version: set to ${version}`);
  await check();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") {
    const i = rest.indexOf("--tag");
    await check(i >= 0 ? rest[i + 1] : undefined);
  } else if (command === "set") {
    await set(rest[0]);
  } else {
    console.error("Usage: node scripts/version.mjs check [--tag vX.Y.Z] | set X.Y.Z");
    process.exit(2);
  }
}
