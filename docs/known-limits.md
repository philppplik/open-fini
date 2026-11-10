# Known limits and open work

A single backlog of everything OpenFini does not do yet, does only partly, or has never been verified on real hardware. Compiled after 1.0.0 and the post-1.0 waves. When you close an item, delete it here and note it in `CHANGELOG.md`. Causes and the extension point that lifts each AI, Vibe and platform limit: [limits-audit.md](limits-audit.md).

Legend: **Unverified** = built and unit-tested but never run in the real environment. **Missing** = not built. **Partial** = built with a known gap.

## Verification gaps (built, never run for real)

- **Desktop app runs** (Tauri): native glass materials (Mica/Acrylic/vibrancy), `run_command`, preview server, TeX compile, tunnel launcher, built-in relay on a real LAN.
- **Real devices and networks:** multi-device collab over LAN/WAN, phones and tablets, small-screen header on real small displays.
- **Real AI models:** tool-calling behavior across providers, orchestrator (`plan_work`), OpenAI plan sign-in (preview terms), MCP OAuth against real servers.
- **File interop:** Office files produced by Excel, PowerPoint and LibreOffice; PDF/X output against real validators (preflight, Acrobat).
- **Rust tests locally:** the local `cargo test` binary does not start on the Windows dev machine; CI is the only Rust test run.
- **Office sheet dialogs:** print flow, table/validation/names/pivot/sparkline/page-setup dialogs, Alt+Shift grouping, keyboard navigation in the validation drop-down.

## Security and ownership follow-ups

- Two CodeQL alerts `rust/disabled-certificate-check` in `src-tauri/src/netio.rs` (lines ~185–186) are intentional (user-opted self-signed FTPS/SMTP) and still need to be dismissed by the repo owner.
- Built-in Rust relay is plain `ws://` only (no TLS; it requires a relay key when started with a tunnel). Use the Node relay with `--tls-cert` or a TLS proxy for browsers on other devices.
- Wiki needs the owner's one-time "Create first page" / "Publish wiki".
- Dependabot PR for katex 0.19.0 to 0.19.1 may still be open.

## Vibe / AI

- **Computer use:** design only (ADR 0023), not implemented.
- **RAG:** no PDF or OCR ingestion.
- Not built from the post-1.0 batch: integrated terminal console in the Code studio, `ofini` CLI/TUI.

## Pixel studio

Missing: content-aware fill, patch tool, object eraser, horizon straighten, before/after compare, fill anti-aliasing, edge extension of rotated crop corners, "Move to position…" context entry.

## Office suite

- **Sheet:** the new features (named ranges, validation, table styles, groups, page setup, sparklines, pivots) are not read from or written to XLSX/ODS; spill formulas are saved as plain formulas (Excel may show an implicit `@`). Groups have no +/- outline gutter. Pivots are snapshots and do not refresh. "Fit to one page" sizes the page to the content instead of scaling onto the chosen paper. Validation checks typed input only, not pasted values or tool writes.
- **Slides:** no chart element yet (`sheet_chart_data` supplies data only).
- **Document, slides and board depth:** tracked in the "Roadmap: Office depth" section of `docs/office-suite.md`; check it for what the current wave has not landed.

## Performance and size budget

- Budgets in `scripts/size-budget.json` have been raised repeatedly (start-up 350 KiB, shell 1704+, total 2635+ KiB, plus the sheet-depth increase). Start-up is close to its cap.
- Deferred savings: lazy pixel effects registry (about 41 KiB; the canvas renderer calls it synchronously), menu tables, i18n split.

## Process and housekeeping

- Finished agent worktrees under `.claude/worktrees/agent-*` and their branches need cleanup (`git worktree remove --force`, `git worktree prune`, `git branch -D`); one directory previously hit "Permission denied".
- CI: the macOS runner sometimes never starts (rerun failed jobs); `gh` occasionally fails on network errors, so verify PR state with `gh pr view --json state` before tagging.
