# Extensions

Extensions are small add-ons that add commands, menu items, dock panels, themes, templates, importers, exporters, code snippets, and tools and skills for the Vibe assistant. They are plain JavaScript against a small, versioned API (version 1) and run in a sandbox with explicit permissions. This page is the user guide and security model; the developer reference is [[Extension SDK Reference]].

## Install

Open *Studio ▸ Extensions…* (or *Settings ▸ Extensions*).

| Source | How |
| --- | --- |
| A `.ofext` file | *Install from file…*, or open or drop the file on OpenFini |
| A folder | *From folder…* |
| A link | *From URL…* (https only; `http://localhost` is accepted for development) |
| The bundled catalog | *Available extensions* ([[Bundled Extensions]]) |

Before anything is installed a dialog shows the name, publisher, version, what it adds and **every permission it asks for**, with a plain explanation and a risk level. Nothing installs without your confirmation, and the Vibe assistant cannot confirm for you. An update that asks for more permissions asks again; otherwise it keeps your settings and stored data.

## Manage

The manager shows each extension's state (running, idle, disabled, stopped, invalid), an on/off switch, **a switch per permission** (revoking applies immediately), what it contributes, its settings, its source (`main.js`) and a log. *Restart* restarts it; *Uninstall* removes it and its stored data. *Settings ▸ Extensions* has **Run extensions** (turn off to start OpenFini without any extension) and **Developer mode**.

Where contributions appear:

- Commands: in the menus the extension chose, *Studio ▸ Extension Commands*, the Code studio command palette, optionally with a shortcut (clashing shortcuts are ignored and logged).
- Panels: tabs in the right dock of the declared studios.
- Themes: the theme picker in *Settings ▸ Appearance*.
- Templates, importers, exporters: the *File* menu (*New from…*, *Import with…*, *Export with…*); importers also handle dropped files of their type.
- Snippets: Code studio completion.
- Vibe tools and skills: *Settings ▸ Artificial intelligence ▸ Tools* and *Skills*; tools **always ask for approval**.

While offline mode is on, extensions cannot use the network and URL installs are refused.

## Security model

- **No extension code runs in the app.** Each extension runs in its own `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so it cannot read the app, its storage, API keys, cookies or other extensions. The host never calls `eval` or `new Function` on extension code.
- **The frame has its own Content-Security-Policy:** `connect-src 'none'`, no frames, workers or forms; images and fonts only from `data:` and `blob:`. The only door is the RPC below.
- **All communication is a validated `postMessage` RPC.** The host checks the sender, the envelope, the method and every argument, caps size (4 MB per request, 8 MB per result), rate-limits (burst 100, 60 per second sustained), times out (30 s; dialogs 10 min) and checks the permission before the handler runs.
- **Network** is per origin (`network:https://api.example.com`); the host fetches without cookies or redirects, with a 5 MB response cap and a 30 s timeout.
- **Documents** are changed only through the same tools the assistant uses (validated against schemas); every command, import and tool call folds into one undo step.
- **Failure handling:** a frame that floods, sends oversized data or stops answering heartbeats is stopped and logged, and disabled after three stops.
- The manifest is validated at install and on every load. Themes may only set `--of-*` and `--sl-*` variables with plain values.

### Limits you should know

A runaway synchronous loop in an extension can freeze the window until reload. Extensions are not signed or reviewed and there is no marketplace. A user who grants `document.write` has trusted the extension with the open document, and one who grants a network origin has allowed data to be sent there. The sandbox protects the app and your other data, not the document the extension may change.

## Vibe

Four tools: `list_extensions`, `run_extension_command`, `install_extension_from_url` (shows you the permission dialog) and `create_extension`, which writes a small local extension from a description and installs it after you confirm its permissions.

## Sharing

By file or URL only: send the `.ofext` or host it over https. There is no marketplace, signing or review. Keep permissions minimal and tell users what to expect.

## See also

- [[Extension SDK Reference]]
- [[Bundled Extensions]]
- [[VS Code Extensions]]
- [[Security and Privacy]]
