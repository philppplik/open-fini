# OpenFini Wiki

OpenFini is a lightweight, open-source creative suite that runs as a small desktop app (Windows, macOS, Linux) and as an installable browser app (PWA). It is built around **studios**, focused workspaces that share one document: Vector, Pixel, Layout, Code, Vibe and Office. This wiki is the user and developer manual; the files in the repository's `docs/` folder remain the deep technical reference.

> **Status: alpha.** OpenFini is a working application, but it is young. File formats and APIs can still change. Read [[Roadmap and Known Limits]] before you plan production work around it.

## What it is

| Studio | For | Read more |
| --- | --- | --- |
| Vector | Logos, icons, illustration, UI | [[Vector Studio]] |
| Pixel | Photo editing and painting | [[Pixel Studio]] |
| Layout | Brochures, books, print, tables and charts | [[Layout Studio]] |
| Code | Websites, Markdown and LaTeX, Git | [[Code Studio]] |
| Vibe | An AI assistant that works in every studio (off by default) | [[Vibe Studio]] |
| Office | Word-style documents (DOCX, ODT, RTF) | [[Office Studio]] |

Export is a button in the header, not a studio: see [[Export and Publish]]. Everything stays on your device: no accounts, no telemetry, no network calls unless you switch a feature on (see [[Security and Privacy]]).

## Install in one minute

| Platform | What to get |
| --- | --- |
| Windows x64 / ARM64 | `OpenFini_<version>_x64-setup.exe` or `..._arm64-setup.exe` from the [Releases](https://github.com/philppplik/open-fini/releases) page |
| macOS Apple Silicon / Intel | `OpenFini_<version>_aarch64.dmg` / `..._x64.dmg` |
| Linux x64 / ARM64 | `.deb`, `.rpm` or `.AppImage` |
| Any modern browser | The hosted app at <https://philppplik.github.io/open-fini/>, installable as a PWA |

Desktop builds are unsigned, so your operating system warns on first launch. Details and the workaround for each system are on [[Installation]].

## A five-minute tour

1. Start the app and press `Ctrl+N` (`Cmd+N` on macOS). Pick a studio card and a size; a document opens.
2. Draw something. In the Vector studio try `M` (rectangle), `P` (pen) or `T` (text); see [[Vector Studio]].
3. Switch studios with `Alt+1` to `Alt+5`. The document does not change; only the toolbox and panels do.
4. Open the command palette with `Ctrl+K` and type what you want to do.
5. Press the **Export** button in the header for PNG, JPEG, WebP, SVG or PDF.
6. Press `Ctrl+S`. You get an `.ofini` file that keeps every layer, page and website file.

The [[Quick Start]] page walks through the same steps with more detail.

## Where to go next

| I want to... | Go to |
| --- | --- |
| Understand documents, pages and studios | [[Concepts]] |
| Learn the tools of a studio | [[Studio Overview]] |
| Open or save a specific file type | [[File Formats]] and [[Save in Original Format]] |
| Build and publish a website | [[Code Studio]], [[Frameworks and Libraries]], [[Export and Publish]] |
| Work with an AI assistant | [[Vibe Studio]], [[Vibe Providers and Permissions]] |
| Work together with other people | [[Collaboration]] |
| Change shortcuts, themes, layout | [[Customization and Profiles]], [[Keyboard Shortcuts]], [[Themes and Surface Styles]] |
| Fix a problem | [[Troubleshooting and Logs]], [[FAQ]] |
| Contribute code | [[Architecture Overview]], [[Development Setup]], [[Contributing]] |

## About this wiki

The wiki is written in US English, rewritten as manual pages (not copied) from the repository docs, and kept in the repository under `wiki/`. It is published automatically; see [[Wiki Style Guide]] for the conventions and how to edit it. Statements are verified against the code; limits are stated honestly. If something here is wrong, please open an issue.

OpenFini is independent and clean-room. It is not affiliated with any commercial product; product names mentioned on these pages are trademarks of their owners and appear only to describe file-format compatibility. See [[Clean-Room Policy]].
