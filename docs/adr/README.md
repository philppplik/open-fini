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
