# Decision Records

Architecture decision records (ADRs) capture the decisions that shape OpenFini and are hard to reverse. They live in `docs/adr/` in the repository; this page indexes them with a short summary of each. New decisions get the next number; superseded ones stay in place and are marked as such.

## Index

| # | Decision | Summary | Status |
| --- | --- | --- | --- |
| [0001](https://github.com/philppplik/open-fini/blob/main/docs/adr/0001-desktop-shell-tauri.md) | Tauri as the desktop shell | Use Tauri v2 with the operating system's web view and ship the same web app as a PWA. The frontend uses no Tauri npm packages: `app/src/platform` talks to injected globals, so one code base runs in a browser too. Installers stay small | Accepted |
| [0002](https://github.com/philppplik/open-fini/blob/main/docs/adr/0002-canvas2d-rendering.md) | Canvas 2D, no WebGL requirement | Render with Canvas 2D only. Vector content is drawn with `Path2D`; groups are isolated into pooled offscreen canvases only when needed; adjustments run on the viewport region. Works on old and low-power hardware | Accepted |
| [0003](https://github.com/philppplik/open-fini/blob/main/docs/adr/0003-shoelace-design-system.md) | Shoelace as the design system | Vendor Shoelace (autoloader, components, themes, a subset of icons) and theme it with a small token layer, instead of writing every control | Accepted |
| [0004](https://github.com/philppplik/open-fini/blob/main/docs/adr/0004-no-framework-no-build.md) | Plain ES modules, no framework, no build step in development | Native modules with a tiny hyperscript helper, an event emitter and explicit panel and tool classes. `app/` is served as is; production bundles with esbuild | Accepted |
| [0005](https://github.com/philppplik/open-fini/blob/main/docs/adr/0005-display-list.md) | Scene graph compiled to a display list | Nodes compile to a backend-neutral display list (paths, images, text runs, groups), cached per node revision and independent of zoom. Canvas, SVG and PDF backends consume only it, so what you see is what exports | Accepted |
| [0006](https://github.com/philppplik/open-fini/blob/main/docs/adr/0006-ofini-format.md) | `.ofini` is a ZIP of JSON plus assets | `document.json`, original image bytes, one PNG per pixel layer and a thumbnail, inspectable with standard tools | Accepted |
| [0007](https://github.com/philppplik/open-fini/blob/main/docs/adr/0007-i18n-english-as-key.md) | English text is the translation key | `t("English text")` with a generated catalog; untranslated strings fall back to English, and adding a language is one JSON file | Accepted |
| [0008](https://github.com/philppplik/open-fini/blob/main/docs/adr/0008-vibe-hub.md) | Vibe hub | Concurrent chats with a fair document write lock and tag-based run undo, so several chats and sub-agents can work without interleaving inside a step | Accepted |
| [0009](https://github.com/philppplik/open-fini/blob/main/docs/adr/0009-bundled-extensions.md) | Bundled extensions are data | Packed from source into `.ofext` packages and a catalog, installed on demand through the normal consent dialog; none is enabled by default | Accepted |
| [0010](https://github.com/philppplik/open-fini/blob/main/docs/adr/0010-collaboration-e2e-relay.md) | Collaboration through a dumb relay with end-to-end encryption | Rooms use a relay that forwards opaque encrypted frames (or a same-device channel); keys travel only in the invite's URL fragment; no accounts and no OpenFini server | Accepted |
| [0018](https://github.com/philppplik/open-fini/blob/main/docs/adr/0018-built-in-network-services.md) | Built-in relay, FTP/FTPS and SMTP in the desktop shell | The desktop app runs the collaboration relay (plain `ws://`) and FTP/FTPS and SMTP clients in Rust with the system TLS stack and trust on first use; no Node.js needed. Browsers keep the Node relay and helper; SFTP is not built in | Accepted |

## Write a new ADR

1. Copy the format of an existing record: title `NNNN: Decision`, `Status`, `Context`, `Decision`, `Consequences`.
2. Use the next number, keep it short (a page), and state the alternatives you rejected and why.
3. Add a row to `docs/adr/README.md` and to the table on this page.
4. Mark a superseded record as such instead of deleting it.

Write an ADR for decisions that are hard to reverse: a new dependency, a file-format change, a security model, a new platform layer.

## See also

- [[Architecture Overview]]
- [[Collaboration]]
- [[Git Workflow and Releases]]
- [[Contributing]]
