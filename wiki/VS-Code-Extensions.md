# VS Code Extensions

Support for running VS Code extensions is planned but is not part of the current release. This page records the status honestly so nobody expects it: at the time of writing there is no VS Code extension host in OpenFini, and the repository has no `docs/vscode-extensions.md`.

## Status

| Question | Answer |
| --- | --- |
| Can OpenFini install VS Code extensions (`.vsix`)? | No |
| Is there a VS Code API shim? | No |
| What exists today? | OpenFini's own sandboxed extension system ([[Extensions]]), the Code studio's CodeMirror 6 editor with Emmet, completions, diagnostics and find in files ([[Code Studio]]) |
| Where will this be documented? | A guide `docs/vscode-extensions.md` in the repository once the work lands, then this page |

## What to use instead

- Editor features: snippets and a formatter through the bundled Code Snippets and Formatter extension ([[Bundled Extensions]]).
- Your own additions: the extension SDK adds commands, panels, snippets and themes ([[Extension SDK Reference]]).
- Themes: the Code editor follows OpenFini's themes; VS Code color themes are not imported.

## Why it is non-trivial

OpenFini runs untrusted code only in sandboxed frames without Node.js, a language server or a terminal, and the desktop Content-Security-Policy forbids `eval`. A VS Code extension host would need a compatibility layer for a large API surface and a clear permission model. No design has been published yet; whatever ships has to respect the sandbox rules described in [[Security and Privacy]].

## Following progress

Watch the repository's pull requests and the `docs/roadmap.md` file ([[Roadmap and Known Limits]]). If you want to help, open an issue to discuss the approach first ([[Contributing]]).

## See also

- [[Extensions]]
- [[Extension SDK Reference]]
- [[Code Studio]]
- [[Roadmap and Known Limits]]
