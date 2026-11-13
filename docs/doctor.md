# Doctor: diagnose and repair

The Doctor checks `.ofini` projects and the app itself, explains each finding in plain language and repairs what can
be repaired safely. It has two surfaces that share one pure module, `app/src/core/doctor/`:

* **In the app**: *Help ▸ Doctor…* and *Settings ▸ Troubleshooting ▸ Doctor*. When an `.ofini` file cannot be
  opened, OpenFini shows why and offers **Repair with Doctor** instead of only failing.
* **In a terminal**: `ofini doctor` ([cli.md](cli.md)).

## File checks

Every finding has a severity (error, warning, note), an explanation and, where possible, a fix. **Safe** fixes never
remove what someone made: they fill in defaults, rebuild the container, drop bytes nothing refers to or re-number
duplicates. The other fixes can remove broken layers or clips and are applied only when asked (`--fix=all`, or per item
in the app).

| Check | Finding | Fix (safe unless marked) |
| --- | --- | --- |
| Container | Empty file, not a ZIP, over the limits (100,000 parts, 1 GiB per part, 2 GiB, as in [security.md](security.md#zip-files)) | none |
| Container | Truncated file or damaged central directory: the local file headers are scanned and every part whose data inflates and matches its CRC-32 is recovered; damaged parts are listed | `recover-entries` |
| Container | Part names with `..`, a leading `/`, a drive letter, a backslash or NUL | `drop-unsafe` |
| Type marker | `mimetype` missing, wrong, compressed or not first | `mimetype` |
| Content | `document.json` missing (the remaining parts can still be extracted), not JSON, not an object | none |
| Content | Stray bytes around the JSON (byte order mark, NUL padding, a partial write) | `json-clean` |
| Format | Missing or wrong `format`; unreadable, missing (very old) or newer `version` | `format-field`; `version-reset` (not safe) |
| Structure | Missing or mistyped `pages`, `masters`, `assets`, `stories`, `styles`, `swatches`, `settings`, `comments`, `web`, `office`; no pages; a page without a layer tree or without its settings (position, margins, columns, gutter, bleed, guides) | `structure` |
| Ids | Pages or layers without an id, duplicate ids | `ids` |
| Values | Invalid numbers (JSON turns `NaN` into `null`), transforms that are not six numbers, negative sizes, opacity outside 0 to 1, page sizes that are not positive | `values` |
| Layers | Unreadable layers (not an object, no type) | `drop-invalid` |
| Layers | Trees nested more than 200 levels deep | `drop-deep` (not safe) |
| References | Image layers whose picture is missing | `drop-broken-images` (not safe) |
| References | Text layers whose story is missing; unreadable stories | `stories` (an empty story) |
| References | Pages using a master page that does not exist; text using paragraph or character styles that do not exist | `refs` |
| Assets | Picture records without bytes; pictures whose bytes do not match their type; parts over 64 MiB | none (reported) |
| Assets | Stored files nothing refers to (`assets/`, `pixels/`, `office/`, `web/files/`) | `prune-orphans` |
| Assets | Asset records no layer uses | `prune-unused` (not safe: a picture may be kept on purpose) |
| Pixel layers | Missing or damaged pixel images (PNG signature, chunk CRCs, end chunk) | none (the layer opens empty) |
| Website | Files listed in the website manifest but missing | `web` |
| Office | Media records whose file is missing | `office` |
| Scene | Compositions that contain themselves, directly or through others | `scene-cycle` |
| Scene | Clips whose composition or media is missing | `scene-refs` (not safe) |
| Preview | A damaged `thumbnail.png` (the app writes a new one on the next save) | `thumbnail` |
| Other | Unknown parts | none (kept as they are) |

Other files get a short report: ZIP-based files (DOCX, XLSX, PPTX, ODF, ORA, KRA, Sketch, ZIP) are checked and
recovered like the project container; PNG (chunk CRCs), JPEG (start and end markers), PDF (header and end marker),
JSON-based files (Excalidraw, tldraw), SVG and text (UTF-8) are checked for damage.

**What the Doctor cannot fix.** A `document.json` that is not JSON even after the stray bytes are removed, parts whose
compressed data is damaged, and the pixels of a damaged pixel layer. `ofini extract --assets` still saves every
readable picture and media file of such a project.

### In the app

*Help ▸ Doctor…* checks the open document exactly as *Save* would write it. *Repair in a new tab* applies the safe
fixes to a copy and opens it; *Repair everything in a new tab* applies all fixes after a confirmation; the **Fix**
button of a finding applies only that fix. The original document and file are never changed. When an `.ofini` file
fails to open, the dialog offers *Repair with Doctor* (opens a repaired copy) and *Details* (the Doctor for that
file).

### In a terminal

```sh
ofini doctor file.ofini                      # report, exit code 1 on errors
ofini doctor --fix file.ofini                # safe fixes → file.repaired.ofini
ofini doctor --fix=all file.ofini            # all fixes
ofini doctor --fix=prune-orphans,thumbnail file.ofini
ofini doctor --fix --out fixed.ofini file.ofini
ofini doctor --fix --in-place file.ofini     # replaces the file, keeps file.ofini.bak
ofini doctor --json *.ofini                  # findings for machines
```

The repaired copy is never written over the original without `--in-place`, and `--in-place` refuses to replace an
existing `.bak` without `--force`.

## App checks

The in-app Doctor also checks the environment. Each check that can be fixed has a **Fix** button; *Fix all safe
issues* runs the safe ones (and repairs the open document in a new tab when it has safe fixes).

| Area | Check | Fix |
| --- | --- | --- |
| Storage | Quota usage (warning at 70 %, error at 90 %); whether stored data is persistent | Ask the browser to keep data |
| Storage | The local database (IndexedDB) opens; entries that cannot be read | Remove unreadable entries |
| Recovery | Autosaved documents that are damaged and would be skipped on restore; recent files without a stored copy | Remove unreadable recovery entries |
| Offline | Service worker registered; caches from earlier versions | Re-register; remove old caches; clear the offline cache (asks first) |
| Capabilities | WebGL, WebGPU, WebCodecs, OffscreenCanvas, listing installed fonts | none (explains the fallback) |
| Fonts | Added fonts that failed to load | none |
| Workers | The worker pool answers a tiny job within 8 seconds | none |
| Extensions | Extensions in an error state or hung; registered engines | Restart failed extensions |
| AI | The selected provider exists; addresses are https or on this device; providers that need a key have one; the provider's address answers | none (Settings ▸ Artificial intelligence) |
| Settings | Saved settings parse and have the types of the defaults | Back up and reset settings (the old ones stay in this browser under `openfini.prefs.v1.backup`) |

**Privacy.** No check reads key values or document contents into the result. The reachability check is a plain
`HEAD` request to the provider's own address, without credentials, cookies or a referrer, and is skipped in offline
mode. *Copy report* and *Save report* contain the findings with layer, asset, file and provider names replaced by "…"
in the document section and user names removed from paths; they contain no file contents and no keys.

## Vibe

`run_doctor` (read-only, *Diagnostics and security* group) returns the app and document findings with their fix ids.
It repairs nothing; the assistant points you to *Help ▸ Doctor* to apply fixes.

## For developers

* `core/doctor/zip.js`: strict ZIP reading with the limits, the local-header recovery scan, CRC-32, the container
  writer.
* `core/doctor/file.js`: `diagnoseFile(bytes, { name })` and `repairFile(bytes, { name, fixes })`. One walk does both:
  a requested fix is applied to the working copy where the problem is found, then the copy is written and checked
  again. Messages are English templates marked with a local `N_` for the i18n extractor.
* `core/doctor/env.js`: `evaluateEnvironment(status)`, pure; `core/doctor/collect.js` collects the status in the
  browser and runs the fixes.
* `ui/doctor-dialog.js`: the dialog and the "could not be opened" dialog. Both load lazily
  (`tests/architecture/guardrails.test.js` ▸ `LAZY_AREAS`).
* Tests: `tests/core/doctor-file.test.js` (broken fixtures built in the test), `tests/core/doctor-env.test.js`,
  `tests/packaging/ofini-cli.test.js`.

To add a check: add the finding where the walk reaches the data, a fix id in `FIXES` when it can be repaired, a test
with a broken fixture, a row in the table above and the German text in `de.json`.
