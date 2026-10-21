# FAQ

Short answers to the questions people ask most, with links to the pages that explain more. Answers state limits plainly; if a feature is missing, this page says so.

## General

**Is OpenFini free?** Yes. It is open source under the MIT License; third-party components are listed in `THIRD_PARTY_NOTICES.md`.

**Is it ready for production work?** It is alpha. It is a real, tested application, but file formats and APIs may still change and several professional features are missing (CMYK, color management, RAW). See [[Roadmap and Known Limits]].

**Does it collect data?** No accounts and no telemetry. The only traffic is what you switch on ([[Security and Privacy]]).

**Is it affiliated with another product?** No. It is an independent clean-room implementation ([[Clean-Room Policy]]).

## Files

**Can it open Affinity, InDesign, Figma or XD files?** No; these formats are proprietary with no public specification. OpenFini detects them and tells you how to export PSD, PDF, IDML or SVG ([[File Formats]]).

**Can it open Photoshop files?** Yes: PSD and PSB open with layers, groups, masks and text where readable; adjustment layers and effects are listed as not imported. It writes 8-bit RGB PSD.

**Why did Save write an `.ofini` and not my PNG?** Writing a flat file back would destroy layers. PNG, JPEG and similar formats always go to `.ofini`; use Export for flat files. Text and Office documents save in their own format ([[Save in Original Format]]).

**Where is my autosaved work after a crash?** In the app profile; the next start restores it when the *restore the last session* option in *Settings ▸ General* is on. Pop-out windows also recover ([[Multi-Window]]).

## Studios and features

**Is there CMYK or ICC support?** No. Everything is sRGB, 8 bits per channel; PDF is DeviceRGB.

**Does the Code studio run npm, TypeScript or Sass?** No: there is no Node.js. Projects must run as they are in the browser ([[Frameworks and Libraries]]).

**Is the LaTeX preview real LaTeX?** No. It is a subset converter to HTML with KaTeX math ([[Markdown and LaTeX]]).

**Can several people edit one document live?** Not yet. Rooms offer chat, comments, versions, presence and snapshot sharing ([[Collaboration]]).

**Can I edit spreadsheets or slides?** Not in the Office studio yet. Save spreadsheets as CSV (imports as a table in Layout); export slides as PDF and open the PDF in Layout ([[Office Studio]]).

**Does it have an AI assistant?** Yes, Vibe, off by default; you bring your own API key or local model ([[Vibe Studio]]). It cannot use a ChatGPT or Claude.ai subscription.

**Can I use VS Code extensions?** No, not yet ([[VS Code Extensions]]). OpenFini has its own extension system ([[Extensions]]).

## Using the app

**A shortcut does nothing in my browser.** The browser reserves some keys (`Ctrl+N`, `Ctrl+W`, `Ctrl+T`). Install the PWA or use the desktop app, or use the menus ([[Keyboard Shortcuts]]).

**How do I change a shortcut or hide a tool?** *Settings ▸ Keyboard shortcuts* and *Toolbox and menus* ([[Customization and Profiles]]).

**How do I get a German interface?** It follows your system language; change it in *Settings ▸ General ▸ Language* ([[Internationalization]]).

**How do I move my settings to another computer?** Export a profile (`.ofprofile`) in *Settings ▸ Profiles and backup*. Secrets are never included.

**Where do I report a bug?** *Help ▸ Troubleshooting… ▸ Report an issue* prefills a GitHub form. Security issues go through the private advisory form ([[Troubleshooting and Logs]]).

## Installing

**Windows says "protected your PC".** The builds are unsigned: choose More info, then Run anyway ([[Installation]]).

**macOS says the app is damaged.** Run `xattr -cr /Applications/OpenFini.app` once.

**Does it update itself?** The desktop app does not; check *Settings ▸ About*. The PWA updates in the background.

## Contributing

**How do I start?** Read [[Development Setup]] and [[Contributing]]. Small pure modules under `app/src/engine/` are the easiest entry point.

## See also

- [[Quick Start]]
- [[Troubleshooting and Logs]]
- [[Glossary]]
- [[Roadmap and Known Limits]]
