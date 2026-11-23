---
title: Features
description: Everything around the studios in OpenFini: files and formats, collaboration, extensions, customization, privacy and security, performance, the command line tool and accessibility.
headline: Everything around the studios.
lead: >
  The studios share one set of tools for opening and saving files, working together, extending and customizing the
  app, keeping data safe, and running well on modest hardware.
---

## Files stay yours {files folder2-open}

A file opened with *File ▸ Open* is saved back in its own format with `Ctrl+S`; OpenFini only asks for `.ofini` when a
document outgrows that format. PSD and PSB, IDML, PDF and Illustrator files with PDF content open as editable
documents with an import report. Folders open as projects, and *Open with OpenFini* works from Windows Explorer,
Finder and Linux file managers.

[File formats](https://github.com/philppplik/open-fini/blob/main/wiki/File-Formats.md)

## Work together, end-to-end encrypted {collaboration people}

Room chat across studios with mentions, threads and files, comments, named versions, live cursors and *follow*.
*Edit together (beta)* merges simultaneous edits. It runs over a relay you start yourself, on your network or between
windows of one device. There are no accounts and no OpenFini server; the relay only sees ciphertext.

[Collaboration](https://github.com/philppplik/open-fini/blob/main/wiki/Collaboration.md)

## Extensions {extensions puzzle}

Sandboxed `.ofext` extensions add commands, menu items, dock panels, themes, templates and Vibe tools. Each one
declares its permissions and is undoable. VS Code themes, snippets and web extensions install from Open VSX or a
`.vsix` file with an honest compatibility badge. Five bundled extensions are ready to switch on.

[Extensions](https://github.com/philppplik/open-fini/blob/main/wiki/Extensions.md)

## Make it yours {customization sliders}

Rebind every shortcut, hide tools and menu items, dock panels where you want them, save workspaces, choose which five
studios the header shows, and share all of it as a profile. Twelve themes, each in light and dark, with accent colors
and high contrast.

[Customization](https://github.com/philppplik/open-fini/blob/main/wiki/Customization-and-Profiles.md)

## Privacy and security {security shield-lock}

No accounts, no telemetry. An app lock encrypts local data at rest; offline mode, safe mode, a protected mode for
untrusted projects, a stored-data inventory and redacted logs are built in. Update checks are optional and off by
default.

[Security and privacy](https://github.com/philppplik/open-fini/blob/main/wiki/Security-and-Privacy.md)

## Light on old hardware {performance cpu}

Canvas 2D only, no WebGL required. Display lists are cached per object, panning moves an already rendered bitmap, and
brush strokes recomposite only the tiles they touch. Low-power mode switches itself on with four CPU cores or 4 GB of
memory or less.

[Performance](https://github.com/philppplik/open-fini/blob/main/wiki/Performance-and-Low-Power.md)

## Command line tool {cli terminal}

`ofini` inspects, validates, repairs, converts and exports projects from a terminal, with shell completion for bash,
zsh, fish and PowerShell.

[Command line tool](https://github.com/philppplik/open-fini/blob/main/wiki/Command-Line-Tool.md)

## Accessibility {accessibility universal-access}

Keyboard operation of the application chrome, visible focus, themes with verified contrast, high contrast and reduced
motion settings, *What's this?* on `Shift+F1` and a command palette on `Ctrl+K`. The canvas itself is pointer driven,
and the documentation says so.

[Accessibility](https://github.com/philppplik/open-fini/blob/main/wiki/Accessibility.md)

## In your language {languages translate}

The interface follows your system language. German is complete for the main surfaces, and another language is one
translation file away.

[Internationalization](https://github.com/philppplik/open-fini/blob/main/wiki/Internationalization.md)
