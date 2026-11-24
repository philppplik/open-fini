# Known limits and open work

A single backlog of everything OpenFini does not do yet, does only partly, or has never been verified on real hardware. Compiled after 1.0.0 and the post-1.0 waves. When you close an item, delete it here and note it in `CHANGELOG.md`. Causes and the extension point that lifts each AI, Vibe and platform limit: [limits-audit.md](limits-audit.md).

Legend: **Unverified** = built and unit-tested but never run in the real environment. **Missing** = not built. **Partial** = built with a known gap.

## Verification gaps (built, never run for real)

- **Desktop app runs** (Tauri): native glass materials (Mica/Acrylic/vibrancy), `run_command`, preview server, TeX compile, tunnel launcher, built-in relay on a real LAN.
- **Collaboration window** ([ADR 0030](adr/0030-collab-native-window.md)): the desktop window (creation with the label `collab`, focus instead of a second window, frameless header with drag region and buttons, remembered position on mixed-DPI monitors, closing with the main window) and real browser popups (the bridge was checked between two browser tabs only).
- **Real devices and networks:** multi-device collab over LAN/WAN, phones and tablets, small-screen header on real small displays.
- **Real AI models:** tool-calling behavior across providers, orchestrator (`plan_work`), OpenAI plan sign-in (preview terms), MCP OAuth against real servers.
- **File interop:** Office files produced by Excel, PowerPoint and LibreOffice; PDF/X output against real validators (preflight, Acrobat).
- **Rust tests locally:** the local `cargo test` binary does not start on the Windows dev machine; CI is the only Rust test run.
- **Office sheet dialogs:** print flow, table/validation/names/pivot/sparkline/page-setup dialogs, Alt+Shift grouping, the outline gutter (+/- and level buttons), *Refresh Pivot Tables*, keyboard navigation in the validation drop-down. The XLSX / ODS round trips of names, validation, tables, groups, page setup, sparklines and dynamic arrays are unit-tested only, not opened in Excel or LibreOffice.

## Security and ownership follow-ups

- Two CodeQL alerts `rust/disabled-certificate-check` in `src-tauri/src/netio.rs` (lines ~185–186) are intentional (user-opted self-signed FTPS/SMTP) and still need to be dismissed by the repo owner.
- Built-in Rust relay is plain `ws://` only (no TLS; it requires a relay key when started with a tunnel). Use the Node relay with `--tls-cert` or a TLS proxy for browsers on other devices.
- Wiki needs the owner's one-time "Create first page" / "Publish wiki".
- Dependabot alert (moderate) for the Rust crate `glib` < 0.20 (`VariantStrIter` unsoundness): it comes in through Tauri's GTK stack on Linux (gtk-rs 0.18) and cannot be updated until Tauri moves to gtk-rs 0.20; OpenFini does not call the affected iterator.

## Vibe / AI

- **Computer use** ([vibe-computer-use.md](vibe-computer-use.md)): desktop app on Windows and macOS only (not Linux, not the browser). Real control of a desktop has not been verified end to end yet; macOS code is compiled by the release workflow only. No control of elevated windows or the secure desktop on Windows. Password fields cannot be detected (policy, card/IBAN/key detection and a window-title heuristic instead). Deny-listed windows are blacked out by their bounds; nothing else on screen is redacted. No native Anthropic computer tool type, no view-only screen sharing in the browser.
- **RAG:** no OCR engine is bundled; scanned PDF pages are skipped unless an extension registers an `ocr` engine ([engines.md](engines.md)).
- **Voice:** no local speech recognizer is bundled (pluggable `stt` engine; whisper.cpp WebAssembly not built). Spoken replies do not use registered `tts` engines yet.
- Not built from the post-1.0 batch: integrated terminal console in the Code studio, `ofini` CLI/TUI.

## Pixel studio

Partial: content-aware fill and the object eraser switch from patch synthesis to a smooth (blurry) fill above about 60 000 px, so large content-aware crop corners look soft (use *Extend edges*). The before/after snapshot is taken shortly after a page first shows in the Pixel studio and lives in memory only (not saved, at most 8 megapixels). Straighten Horizon searches ±30° (horizon) and ±30° from plumb (verticals). Unverified in a real browser: the Patch and Object Eraser interaction, the compare divider and the corner fills (unit-tested engines only).

## Office suite

- **Sheet:** pivot tables are written to XLSX / ODS as values (their definition travels as a hidden name and refreshes only in OpenFini); ODS does not write charts or conditional formats; validation does not recheck values already in cells, formulas or fill. Spill references (`A1#`), LET / LAMBDA, INDIRECT / OFFSET, pictures, file comments, rich text in a cell and multi-range selection are missing (see [office-limits-audit.md](office-limits-audit.md)).
- **Whiteboard comments and sidebar:** checked in a browser (comment tool, pins following a moved element, orphan pin and undo, reply and resolve, clusters, sidebar tabs, drawer on a narrow window, light and dark). Not checked by hand: dragging outline rows (HTML drag and drop; the reordering is unit-tested and `Alt+Up`/`Alt+Down` was checked), dragging library tiles onto the board, comment sync between two people in a room (the comment op merge is unit-tested), the desktop app (Tauri) and touch devices. Pins are never included in exports (there is no option to include them).
- **Document, slides and board depth:** tracked in the "Roadmap: Office depth" section of `docs/office-suite.md`; check it for what the current wave has not landed.

## Scene Studio

- Spatial Bezier handles on motion paths, track mattes, shape trim paths / repeaters, 2.5D camera parallax, stabilization and tracking are not built (see docs/scene-studio.md ▸ Limits).
- Time-remapped video clips are seeked frame by frame while playing (the preview may stutter); reversed clips play no reversed sound.
- Referenced media (desktop): checked with unit tests (saving, loading, lookup, folder matching, relink, embed); the desktop flows (import by path, reading back after a restart, *Find Missing Media…*, *Save Project with Media…*) were not run in the Tauri app. Files outside Desktop, Documents, Downloads, Pictures, Videos and Music must be found again once per session; older versions drop referenced items.
- The timeline's context menus, keyframe rows and effects browser were exercised in a browser with synthetic events; real pointer drags of keyframes (Alt-scale) and the sound-driven tools on real footage are not verified.

## Panels and workspaces

- **Partial:** docking ([workspaces.md](workspaces.md), [ADR 0033](adr/0033-docking-layout.md)) covers every studio: Vector, Pixel, Layout, Code (sidebar, bottom and style panels), Scene (Media, Effects, Inspector), Vibe (Chats, Canvas, Activity) and the Office apps Document (Outline, Styles), Presentation (Slides) and Whiteboard (Comments, Outline, Properties, Library).
- **Missing:** the Scene timeline and the Code editor/preview stay in the central area (the engine's central area is the canvas); only their side panels dock. The Spreadsheet has no panels to dock (its sheet tabs and formula bar are part of the grid). The Presentation app has a single panel, so it has no extra workspace; the ribbons and toolbars of the Office apps are not panels.
- **Partial:** tearing a panel off into its own window ([workspaces.md](workspaces.md#tear-a-panel-off-into-its-own-window)). The panel window is an empty page the main window fills, so menus, dialogs, toasts and tooltips a torn-off panel opens appear in the main window, the panel window has no right-click menu, and a panel cannot be dragged from one panel window into another or into the app (use *Dock Back* or *Window ▸ Dock Back All Windows*). Browsers open one popup per click, so after a reload or when several torn-off panels come back at once the others wait in the app with an *Open in Window* button. The desktop path (a Tauri window answering `window.open`, ADR 0033) was written against Tauri 2.12 and is not verified on Windows, macOS or Linux yet; the browser path was checked with a same-origin frame standing in for the popup.
- **Partial:** on narrow windows (960 px and less) the left and right docks slide in as overlays; floating panels and the bottom dock stay as they are.

## Performance and size budget

- Budgets in `scripts/size-budget.json` have been raised repeatedly (start-up 350 KiB, shell 1704+, total 2635+ KiB, plus the sheet-depth increase). Start-up is close to its cap.
- Deferred savings: lazy pixel effects registry (about 41 KiB; the canvas renderer calls it synchronously), menu tables, i18n split.

## Process and housekeeping

- Finished agent worktrees under `.claude/worktrees/agent-*` and their branches need cleanup (`git worktree remove --force`, `git worktree prune`, `git branch -D`); one directory previously hit "Permission denied".
- CI: the macOS runner sometimes never starts (rerun failed jobs); `gh` occasionally fails on network errors, so verify PR state with `gh pr view --json state` before tagging.
