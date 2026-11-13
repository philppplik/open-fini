# Command Line Tool

The `ofini` command works with OpenFini projects from a terminal: it inspects, validates, diagnoses and repairs `.ofini` files, creates projects from the app's templates, converts Office files and exports the formats that need no rendering. The full reference is [docs/cli.md](https://github.com/philppplik/open-fini/blob/main/docs/cli.md).

## Install

It needs Node.js 20 or later and a clone of the repository. The desktop app does not install it.

```sh
npm link          # puts ofini on your PATH
ofini version
```

## Commands

| Command | Use it to |
| --- | --- |
| `ofini info <file...>` | See kind, pages, layers, fonts, assets and size |
| `ofini validate <file...>` | Check files in CI (exit code 1 on errors) |
| `ofini doctor [file...] [--fix]` | Diagnose and repair (see [[Troubleshooting and Logs]]) |
| `ofini export <file> --format <fmt>` | Export SVG, PDF, DOCX, Markdown, XLSX, CSV, PPTX and more |
| `ofini convert <in> <out>` | Convert Office files (`.docx`, `.xlsx`, `.pptx`, `.md` and others) to each other or to `.ofini` |
| `ofini extract <file> --assets` | Save the embedded pictures and media |
| `ofini ls`, `unpack`, `pack`, `diff` | Look inside a project, keep it in Git as a folder, compare versions |
| `ofini new <kind> <file>` | Start a vector, pixel, layout, code, document, sheet, slides, board or scene project |
| `ofini completion <shell>` | Tab completion for bash, zsh, fish and PowerShell |

Started without arguments in a terminal, `ofini` opens an interactive prompt with history and Tab completion.

## Good to know

- Every command takes `--json`, `--quiet` and `--no-color`; `NO_COLOR` is respected.
- Wildcards work in every shell, also PowerShell: `ofini validate "designs/**/*.ofini"`.
- Exit codes: 0 ok, 1 problems found, 2 usage error, 3 file error, 4 needs the app, 5 internal error.
- PNG and other raster formats, video, and PDF pages with pictures need the app's renderer; `ofini` says so instead of drawing them differently.

## See also

- [[Troubleshooting and Logs]]
- [[File Formats]]
- [[Export and Publish]]
- [[Development Setup]]
