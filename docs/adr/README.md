# Architecture decision records

Short records of the decisions that shape OpenFini. New decisions get the next number; superseded ones stay
in place and are marked as such.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-desktop-shell-tauri.md) | Tauri (system WebView) as the desktop shell | Accepted |
| [0002](0002-canvas2d-rendering.md) | Canvas 2D rendering, no WebGL requirement | Accepted |
| [0003](0003-shoelace-design-system.md) | Shoelace as the prebuilt design system | Accepted |
| [0004](0004-no-framework-no-build.md) | Plain ES modules, no UI framework, no build step in development | Accepted |
| [0005](0005-display-list.md) | Scene graph compiled into a backend-neutral display list | Accepted |
| [0006](0006-ofini-format.md) | `.ofini` is a ZIP of JSON plus original assets | Accepted |
| [0007](0007-i18n-english-as-key.md) | Internationalization: the English text is the key | Accepted |
| [0009](0009-bundled-extensions.md) | Bundled extensions are data, packed from source, installed on demand | Accepted |
| [0008](0008-vibe-hub.md) | Vibe hub: concurrent chats, fair write lock, tag-based run undo | Accepted |
| [0010](0010-collaboration-e2e-relay.md) | Collaboration through a dumb relay with end-to-end encryption | Accepted |
| [0011](0011-live-editing-sync.md) | Live editing: state-diffed tree registers and an RGA for text | Accepted (beta) |
| [0012](0012-vscode-extensions.md) | VS Code extensions from Open VSX: declarative parts plus a sandboxed web-extension API subset | Accepted |
| [0013](0013-collab-popout.md) | The Collaboration window pops out as a UI-only remote view | Accepted |
| [0014](0014-model-routing-fallback.md) | Model routing with fallback as a provider wrapper | Accepted |
| [0015](0015-liquid-glass-refraction.md) | Liquid glass refraction: own SVG displacement-map code instead of vendoring amazing-glass | Accepted |
| [0016](0016-office-suite-apps.md) | Office Suite: one studio, a registry of lazily loaded apps per document kind | Accepted |
| [0017](0017-openai-account-auth.md) | OpenAI account sign-in on desktop, OAuth for MCP servers, nothing undocumented | Accepted |
