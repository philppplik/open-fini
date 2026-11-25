# The `ofini` command line tool

`ofini` works with OpenFini projects from a terminal: inspect, validate, diagnose and repair `.ofini` files, create
new projects from the app's templates, convert Office files and export to the formats whose writers run without a
window. It runs on Node.js 20 or later and has no dependencies beyond the repository itself. Architecture:
[ADR 0032](adr/0032-ofini-cli.md). Diagnose and repair in detail: [doctor.md](doctor.md).

## Install

From a clone of the repository:

```sh
npm link            # or: npm install -g .   puts `ofini` on your PATH
ofini version
npx ofini help      # without installing (inside the clone)
npm run ofini -- info poster.ofini
```

The desktop app does not install the command: it would need Node.js and the engine modules on disk, which the app
bundle does not ship (see [ADR 0032](adr/0032-ofini-cli.md) ▸ Desktop). Shell completion:

```sh
eval "$(ofini completion bash)"                       # ~/.bashrc
eval "$(ofini completion zsh)"                        # ~/.zshrc
ofini completion fish > ~/.config/fish/completions/ofini.fish
ofini completion powershell | Out-String | Invoke-Expression   # $PROFILE
```

## Commands

| Command | What it does |
| --- | --- |
| `ofini info <file...>` | Kind, studio, format version, size, pages, layers by type, text stories, fonts, assets, pixel layers, website and media files, preview |
| `ofini validate <file...>` | Checks files; exit code 1 when one has errors (`--strict`: also warnings) |
| `ofini doctor [file...]` | Diagnoses files and repairs them with `--fix`; without files, checks the command line environment |
| `ofini export <file...> --format <fmt>` | Exports a project (`--out`, `--pages`, `--no-background`) |
| `ofini convert <in> <out>` | Opens `.ofini` or an Office file and writes the format of the output name |
| `ofini formats [file]` | Lists export and import formats, or what one file can become |
| `ofini extract <file> --assets\|--text\|--json` | Writes embedded pictures, pixel layers, media and website files to a folder; prints the text; prints `document.json` |
| `ofini ls <file>` | Lists the parts inside a project file (size, CRC-32, what each part is) |
| `ofini new <kind> <file>` | Creates an empty project from the app's templates (`--template`, `--size`, `--pages`, `--title`, `--list`) |
| `ofini unpack <file> [folder]` | Unpacks a project into a folder (`--pretty` indents `document.json` for diffs in Git) |
| `ofini pack <folder> [file]` | Packs such a folder into an `.ofini` file (the type marker first and stored) |
| `ofini diff <a> <b>` | Structural comparison: title, kind, pages, layer counts, text stories, stored parts; exit code 1 when they differ |
| `ofini proto <command>` | Proto designs: `info`, `tree`, `inspect`, `validate`, `lint`, `render`, `assets`, `tokens`, `flows`, `diff`, `apply` ([below](#proto-designs)) |
| `ofini version` | Version, document format, Node.js and platform |
| `ofini help [command]` | Help, options and examples of a command |
| `ofini completion <shell>` | Completion script for bash, zsh, fish or PowerShell |

`list` is an alias of `ls`, `check` of `validate`. `ofini` without arguments in a terminal starts the
**interactive mode**: a prompt `ofini ›` with history (Up and Down, this session) and Tab completion of commands,
options, kinds and file paths; every line runs the same commands; `exit` or Ctrl+D leaves. When input or output is not
a terminal, `ofini` without arguments prints a usage error instead.

## Options for every command

| Option | Effect |
| --- | --- |
| `--json` | Machine-readable JSON on standard output (one object, or an array for several files) |
| `-q`, `--quiet` | Only results and errors |
| `--no-color` | No colors. Colors are also off when `NO_COLOR` is set, `TERM=dumb`, or output is not a terminal; `FORCE_COLOR=1` or `--color` turns them on |
| `-h`, `--help` | Help for the command |
| `--name <file>` | The name to assume for standard input (`-`), so the format is known: `cat a.docx \| ofini convert - a.md --name a.docx` |

File arguments accept wildcards (`*.ofini`, `designs/**/*.ofini`, `report-?.ofini`, `[ab].ofini`), also in shells that do
not expand them (cmd.exe, PowerShell) and when quoted. `-` reads standard input or writes standard output where
it makes sense (`info`, `validate`, `doctor`, `export -o -`, `convert`, `extract`). Commands that write never replace an
existing file without `--force` (`-f`).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success (no errors; warnings allowed unless `--strict`) |
| 1 | Problems found: validation or Doctor errors, damaged input, `diff` found differences |
| 2 | Usage error: unknown command or option, missing argument, invalid value |
| 3 | File error: not found, unreadable, not writable, or the output exists (use `--force`) |
| 4 | Not supported headless: the format or operation needs the app (rendering) |
| 5 | Internal error (please report it with the command you ran) |
| 130 | Interrupted (Ctrl+C) |

With several files the worst code wins; one unreadable file does not stop the others.

## Formats

| Project | `ofini export` / `convert` formats |
| --- | --- |
| Design (Vector, Pixel, Layout) | `svg` (one file per page, pictures and pixel layers embedded as they are stored), `pdf` (vector pages only), `txt` |
| Website (Code studio) | `zip` (the website files) |
| Document | `docx`, `odt`, `rtf`, `html`, `md`, `txt`, `pdf` |
| Spreadsheet | `xlsx`, `ods`, `csv`, `tsv`, `pdf` |
| Presentation | `pptx`, `odp`, `pdf` |
| Whiteboard | `excalidraw`, `tldraw`, `svg`, `pdf` |
| Scene | project only |
| Proto (Labs) | project only; SVG, assets and tokens with [`ofini proto`](#proto-designs) (code export follows) |
| Every project | `ofini`, `json` (the document content, indented) |

`convert` reads `.ofini` and the formats the Office apps open: `.docx`, `.odt`, `.rtf`, `.html`, `.md`, `.txt`,
`.xlsx`, `.ods`, `.csv`, `.tsv`, `.pptx`, `.odp`, `.excalidraw`, `.tldraw` (`ofini formats` prints the live list).

**What needs the app.** PNG, JPEG, WebP, AVIF, GIF, TIFF, PSD, video, PDF of design pages that contain pictures or
pixel layers, pages with adjustment layers, and Office exports that need rendering (PNG of sheets, slides and boards;
pictures in some formats). These are rendered by the app's canvas engine; `ofini` refuses them with exit code 4
instead of drawing them differently. Text in a design PDF uses the PDF base fonts (Helvetica, Times, Courier) and
text layout uses their metrics, so line breaks can differ slightly from the app, which measures the real fonts.

## Kinds and templates for `ofini new`

`vector`, `pixel`, `layout` (sizes: `full-hd`, `hd`, `4k`, `mobile`, `tablet`, `a3`, `a4`, `a5`, `letter`, `legal`,
`tabloid`, `business-card`, `postcard`, `square`, `story`, `open-graph`, `icon`, or `WIDTHxHEIGHT` with `px`, `mm`,
`in` or `pt`), `code` (the Code studio's website templates), `document`, `sheet`, `slides`, `board` (the Office apps'
templates), `scene` (the Scene Studio's templates) and `proto` (`blank`, `desktop` with a 1440 × 1024 frame, `phone`
with a 390 × 844 frame; `--size` makes one frame of any size). `ofini new --list` prints every template id. New
projects have no preview image; the app adds one when it saves them.

## Proto designs

`ofini proto <command>` works with Proto Studio designs (Labs) through the same engine modules as the app
([concept §9](concepts/proto-studio.md#9-cli)). A design is read from an `.ofini` file, from its `document.json` (after
`ofini unpack`) or from a bare model (`*.json`); commands that change a design write the same kind of file, keep the
rest of an `.ofini` file (preview, media) and refuse a design with validation errors or a newer schema. `ofini help
proto <command>` lists every option.

| Command | What it does |
| --- | --- |
| `ofini proto info <file...>` | Pages, frames, layers by type, components with variants and instance counts, variable collections and modes, styles, media, flows, health |
| `ofini proto tree <file> [--page] [--node] [--depth] [--boxes]` | The layer outline: id, type, name, sizes, layout, text, instance, bindings, styles, modes, interactions; `--boxes` adds positions and sizes from the pure solver |
| `ofini proto inspect <file> --node <ids> [--resolved] [--css]` | Full JSON of layers (also instance-inner keys such as `n5/n22`), the resolved layer, its CSS declarations and its solver box |
| `ofini proto validate <file...> [--strict]` | Schema, references and limits; exit code 1 on errors (and on a newer schema) |
| `ofini proto lint <file...> [--rules] [--format text\|json\|sarif] [--fix]` | Design lint (below); exit code 1 on errors (`--strict`: warnings too); `--fix` writes `<name>.fixed.ofini` (or `--out`, `--in-place`) |
| `ofini proto render <file> [--node \| --page] [--out]` | SVG of layers (default: the top-level layers of the first page, one file each) through the pure layout solver; `--mode`, `--scale`, `--background`, `--media embed\|link\|none` |
| `ofini proto assets <file> [--node] [--out dir]` | Vector layers (or the chosen layers) as SVG and embedded media as files, into `<name>-assets` |
| `ofini proto tokens <file> [--format dtcg\|css\|tailwind\|swift\|json] [--mode]` | Design tokens: DTCG 2025.10 (default), CSS custom properties, Tailwind v4 `@theme`, Swift, or plain values per variable name (`json`) |
| `ofini proto tokens import <file> <tokens.json\|->` | Imports DTCG tokens (`--collection`, `--mode`); needs `--out`, `--in-place` or `--dry-run` |
| `ofini proto flows <file...> [--page]` | Prototype flows: the screens each flow reaches from its start and the interactions on them; exit code 1 when a start frame or a target is missing |
| `ofini proto diff <a> <b>` | Structural diff: pages, layers (with the changed fields), collections, variables, styles, media; exit code 1 when they differ |
| `ofini proto apply <file> <ops.json\|->` | Applies operations (one object, an array or `{ "ops": [...] }`; also `--ops '<json>'`) as one all-or-nothing batch; needs `--out`, `--in-place` or `--dry-run`; `--seed` makes new ids reproducible |

`--mode Theme=dark,Density=compact` picks variable modes by collection and mode name (or id); for `render`, `inspect`
and `tree --boxes` they are set on the top-level layer, so they win over the mode it picks itself. `--node` takes ids,
exact layer names or instance-inner keys, comma-separated.

**Lint rules.** The design rules are the ones the assistant's `proto_lint` and `proto_fix` run
(`app/src/engine/proto/lint.js`), so the CLI and the assistant report the same findings: `contrast`, `touch-target`
(under 24 px a warning, under 44 px a note), `unbound-color`, `unbound-spacing`, `off-grid`, `detached-style`,
`inactive-override` (instance overrides of layers the main component no longer has), `detached-instance`, `empty-frame`,
`naming`, `overflow-text` and `unused-token`. Three checks of the file itself run only in the CLI: `schema` (validation
errors and warnings), `unresolved` (variables, components or modes that cannot be resolved) and `clipped` (a layer
sticking out of a parent that clips). The names of 1.3.0 still work in `--rules`: `stale-override` means
`inactive-override`, `text-overflow` means `overflow-text`. `--fix` applies the fixes the engine marks safe (one batch per
finding); the others (deleting unused tokens, replacing detached copies) are listed as `suggestion` in JSON. Engine
`info` findings are `note`s. The geometry rules use the pure solver and are marked approximate. `--format sarif` writes
SARIF 2.1.0 for code-scanning annotations in CI.

**Approximate.** Without a browser, layout and text come from the pure solver with the PDF base-14 font metrics (no
kerning, no real fonts), so text positions can differ by a pixel or two from the canvas. The SVG render also draws conic
gradients with their first color and leaves out inner shadows and background blur (reported as warnings). PNG needs the
app's renderer: `--format png` exits with code 4. Code export (`ofini proto export`), imports and `ofini mcp` follow
with later Proto tasks.

```sh
ofini new proto app.ofini --template phone
ofini proto tree app.ofini --boxes
ofini proto lint 'designs/*.ofini' --format sarif > proto.sarif   # CI annotations
ofini proto render app.ofini -o shots/ --mode Theme=dark
ofini proto tokens app.ofini -t css -o tokens.css
ofini proto tokens import app.ofini brand.tokens.json --in-place
echo '{"op":"node.update","id":"n2","set":{"name":"Title"}}' | ofini proto apply app.ofini - --in-place
ofini proto diff main.ofini feature.ofini --json
```

## Examples

```sh
ofini info poster.ofini
ofini validate --strict designs/**/*.ofini          # in CI: exit code 1 on any problem
ofini doctor broken.ofini                           # report
ofini doctor --fix broken.ofini                     # safe fixes, writes broken.repaired.ofini
ofini doctor --fix=all --in-place broken.ofini      # all fixes, keeps broken.ofini.bak
ofini new layout flyer.ofini --size a5 --pages 2
ofini new sheet budget.ofini --template budget
ofini export budget.ofini -t csv -o -               # CSV to standard output
ofini export flyer.ofini -t svg                     # flyer-1.svg, flyer-2.svg
ofini convert report.docx report.md
ofini convert data.xlsx data.ofini
ofini extract brochure.ofini --assets -o pictures
ofini unpack poster.ofini --pretty && git diff poster/document.json
ofini pack poster poster.ofini
ofini diff v1.ofini v2.ofini --json
```

## Safety

`ofini` reads files with the same ZIP limits as the app ([security.md](security.md#zip-files)): 100,000 parts, 1 GiB
per part, 2 GiB in total. Part names with `..`, a leading `/`, a drive letter or a backslash are never written by
`unpack` or `extract`, and nothing is written outside the chosen folder. It opens no network connection and reads no
app storage, keys or settings.
