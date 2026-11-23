# UI polish audit

An audit of OpenFini's interface against the "signs of slop" checklist from
[unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0), used here as design guidance
only. The goal is a quieter, more deliberate interface: neutral chrome, one accent used rarely, a small type
and spacing scale, and copy that says what things do.

Audited on 2026-11-23 against `main` at `921089b`, dark theme, default ("Solid") surface, in the browser
build (`node scripts/serve.mjs --port 3020`) at 800 × 432 and 1440 × 900. Screens walked: start screen,
Vector with a blank document, Vibe (empty chat), Scene start screen, Office launcher, Settings (General,
Studios), File and View menus, the onboarding invitation. The Code studio was looked at but not edited
(another change is in flight there). Screens are named by where they are in the app; no screenshots are
committed, to keep the repository small.

## Overall verdict

**Light slop.** OpenFini is mostly designed: one icon set (Bootstrap Icons plus OpenFini's own glyphs), no
emoji in the interface, almost no hype copy, a real token layer (`app/styles/theme.css`). The tells that
remain are the usual ones: accent glows on active buttons, a violet radial wash behind the start screen,
uppercase tracked labels everywhere, the accent spread over every card icon, and a type scale with too many
half-pixel steps. So this is a polish pass, not a redesign: keep the brand, the layout and the features, and
fix how the tokens are used.

## Direction

- **Product.** A light, local-first creative suite for drawing, photos, page layout, code, video and office
  documents, for people who want one small app instead of five big ones.
- **Character.** Exact, calm, a little workshop-like.
- **World.** A maker's desk: cutting mat, ruler, proof prints. Neutrals stay graphite; the world shows in the
  canvas and the documents, not in the chrome.
- **Moments.** The canvas and the document itself. The chrome around it stays quiet so the work is the
  brightest thing on screen.
- **Signature.** Keycaps for shortcuts and the studio glyphs (the `of` icon set), used consistently.

## Findings

Severity: **High** is visible on every screen or breaks something, **Medium** is visible on a main screen,
**Low** is a detail.

### High

| # | Sign | Where | Status |
| --- | --- | --- | --- |
| H1 | Colored glow under the active studio button and the active tool | `app/styles/app.css` `.of-studio.active`, `.of-tool.active` | Fixed in this PR |
| H2 | Violet radial wash behind the start screen | `app/styles/app.css` `.of-welcome` | Fixed |
| H3 | Uppercase, wide-tracked section labels across ~30 components (settings groups, dock sections, menus, Vibe, Office, Scene, extensions) | `app/styles/*.css` | Fixed outside the Code studio (see M6) |
| H4 | Undefined tokens `--of-text-muted` and `--of-bg-hover`: Scene Studio's muted text rendered at full text color and its hover states had no background | `app/styles/scene.css` | Fixed (mapped to `--of-text-dim` / `--of-hover`) |
| H5 | Accent used on every card icon (start screen, Scene start, Office launcher), so nothing stands out next to the one primary action | `.of-welcome__icon`, `.of-scene-start__card sl-icon`, `.of-launch__cardicon`, `.of-launch__tplthumb` | Fixed: icons take the secondary text color, accent on hover only (start screen) |

### Medium

| # | Sign | Where | Status |
| --- | --- | --- | --- |
| M1 | Glowing accent tile with a large colored shadow above "What do you want to make?" | `app/styles/vibe.css` `.of-vempty__logo` | Fixed |
| M2 | Gradient text with an accent hue on the "Thinking…" and running-tool shimmer | `app/styles/vibe.css` `.of-shimmer` | Fixed: neutral highlight only, motion kept because the state is live |
| M3 | Cards lift on hover (`translateY(-2px)`) and turn the border accent | start screen cards | Fixed: surface step and a quieter border; the same hover now on Vibe ideas, Scene start and Office launcher cards |
| M4 | One-sided accent bars left over after #129: onboarding invitation, pinned Vibe messages, collaboration mentions | `onboarding.css`, `vibe-ui.css`, `vibe-bubbles.css`, `collab.css` | Fixed: hairline ring or soft tint |
| M5 | Heavy headings (700) on the start screen, default bold on the Vibe, Scene and Office titles | `.of-welcome h1`, `.of-vempty h1`, `.of-scene-start h2`, `.of-launch__head h1` | Fixed: 600 with slight tracking on display sizes |
| M6 | Uppercase tracked labels in the Code studio (sidebar titles, bottom tabs, add categories, style sections, template and library groups) | `app/styles/code.css`, `code-frameworks.css`, `code-assist.css` | Open (S), held back while the Code studio is being changed |
| M7 | Office templates show an empty box with a 24 px glyph as the "thumbnail", twenty times in a grid: reads as placeholder card soup | `app/src/office/` launcher, `.of-launch__tplthumb` | Fixed |
| M8 | The type scale has 25 font sizes, including 10.5, 11.5, 12.5, 13.5 and 16.5 px (148 × 12 px, 63 × 12.5 px, 58 × 11.5 px) | all `app/styles/*.css` | Fixed |
| M9 | Font weights 550, 560, 620 and 650 next to 600 and 700 | all `app/styles/*.css` | Fixed |
| M10 | Radii: 19 different values (1 to 30 px); `--of-radius` is 6 px but cards use 8, 10, 12, 14 and 16 | all `app/styles/*.css` | Fixed |
| M11 | The onboarding invitation sits above modal dialogs (z-index 5500 over Settings) | `app/styles/onboarding.css` `.of-nudge` | Fixed |
| M12 | A menu opened from the menu bar stays open when a dialog opens from the keyboard or a command | `app/src/ui/menus.js` | Fixed |

### Low

| # | Sign | Where | Status |
| --- | --- | --- | --- |
| L1 | Text-to-speech sample: "Hello! I am Vibe. Shall we make something nice today? Let's go." (greeting, exclamation mark, chirpy) | `app/src/ui/vibe/panel-voice.js` | Fixed: "This is how Vibe sounds. Pick a voice and speed that suit you." |
| L2 | "Thinking…" is hard-coded and not translated | `app/src/ui/vibe/chat.js`, `app/src/ui/vibe/tool-cards.js` | Fixed |
| L3 | Generic fallback "Nothing to show here yet." in empty dock panels, for example Scene's Media bin before a sequence exists | `app/src/ui/panels/index.js` | Fixed |
| L4 | Menus use Title Case ("Show Models and Connections") while panels, settings and buttons use sentence case | menu definitions in `app/src/commands/` | Open (M, decision): pick one; platform menus commonly stay Title Case, so document the rule in `docs/design-system.md` |
| L5 | Card paddings differ between sibling launchers (welcome 20/16, Scene 14, Office 12, Vibe ideas 12/14) | `app.css`, `scene.css`, `office-suite.css`, `vibe.css` | Fixed |
| L6 | Diagnostics log levels and badges are uppercase and bold (`ERROR`, `WARN`) | `app/styles/diagnostics.css` | Kept on purpose: log levels are a fixed vocabulary that reads like code |
| L7 | Slideshow presenter labels uppercase | `app/styles/office-slides.css` `.of-sl-show__label` | Kept: presenter view on a dark stage |
| L8 | The accent is violet (`#8b7cf6`), the family unslop flags most often | `app/styles/theme.css`, `app/src/ui/themes.js` | Open (decision for the owner): it is the brand color and themes can change it; if a new default is wanted, take it from the maker's-desk world (a cobalt or a cutting-mat green) |
| L9 | Composer carries a large soft drop shadow (`0 6px 24px`) on the dark theme, where depth should come from surface steps | `app/styles/vibe.css` `.of-composer` | Fixed |
| L10 | Opt-in "Glass" surface uses color mesh gradients and drifting blobs | `app/styles/glass.css` | Kept: an explicit appearance choice, off by default |

## What was kept on purpose

- The studio glyphs, the logo and the accent as the brand.
- Accent fill on the active studio button and active tool: it marks the selection, which is what the accent
  is for. Only the glow was removed.
- The shimmer motion on live AI states, because it shows that something is running. It is now neutral.
- Gradients that are content, not decoration: transparency checkerboards, the levels ramp, the audio meter,
  the custom color swatch.

## Fix list

Small (S) tasks fit in a single short PR; medium (M) tasks touch many files or need a decision.

Done in this PR:

1. S: Remove the glows on `.of-studio.active` and `.of-tool.active` (H1).
2. S: Plain canvas background behind the start screen (H2).
3. M: Sentence-case section labels outside the Code studio; 10 and 10.5 px labels to 11 px, weights 650/700 to 600 (H3, M9 in part).
4. S: Map the undefined Scene tokens (H4).
5. S: Neutral card icons and one hover treatment on launcher cards (H5, M3).
6. S: Vibe empty state without the glowing tile; neutral idea tags (M1).
7. S: Neutral shimmer (M2).
8. S: Replace the remaining one-sided accent bars (M4).
9. S: Heading weights 600 on start, Vibe, Scene and Office screens (M5).
10. S: Rewrite the text-to-speech sample (L1).

Remaining:

1. S: Sentence-case the Code studio labels (M6), once the Code studio work has landed.
2. M: Real template previews in the Office launcher, or a denser list (M7).
3. M: Font-size tokens and migration of half-pixel sizes (M8).
4. S: Remove weights 550, 560, 620 and 650 (M9).
5. M: Card and panel radius tokens (M10).
6. S: Keep the onboarding invitation below dialogs (M11).
7. S: Close menu-bar menus when a dialog opens (M12).
8. S: Translate "Thinking…" (L2).
9. S: Per-panel empty states with a next step (L3).
10. M: Decide and document Title Case versus sentence case for menus (L4).
11. S: One card padding across launchers (L5).
12. S: Composer depth from a surface step instead of a large shadow (L9).
13. Decision: keep or replace the violet default accent (L8).

---

Checklist adapted from unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0.
