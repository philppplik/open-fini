# Launch screen

While OpenFini starts it shows a launch card: the release artwork, a thin progress bar right under it, and a footer
with the OpenFini mark and wordmark on the left and the version on the right, plus a short status line ("Loading
studios…"). Design and trade-offs: [ADR 0031](adr/0031-launch-screen.md).

Turn it off in *Settings ▸ General ▸ Show launch screen* (preference `launchScreen`, default on). It takes effect at the
next start: the window then appears right away and fills in as it loads, as before.

## How it works

| Piece | Where |
| --- | --- |
| Card markup and critical CSS | inline in `app/index.html` and `app/splash.html`, between the `launch-css` and `launch-card` markers (the two copies must be identical; `tests/ui/launch-screen.test.js` checks it) |
| Controller | `app/src/launch.js`, a classic script (not a module) loaded right after the card |
| Boot stages | `main.js` calls `window.__ofLaunch.stage(id, label)`; session restore reports `progress("documents", fraction)`; `done()` after `boot()` |
| Artwork | `app/assets/launch/artwork.webp` |
| Version | stamped into the empty `data-of-version` element by `scripts/build.mjs` from `package.json`; in development `launch.js` asks `build-info.json` or the desktop app |
| Desktop window | `splash` window in `src-tauri/tauri.conf.json` (and `tauri.macos.conf.json`), capability `src-tauri/capabilities/splash.json`, command `launch_ready` in `src-tauri/src/lib.rs` |

### Progress

The bar follows real boot stages, each with a share of the bar: `start`, `language`, `studios` (tools and commands),
`interface` (the shell), `documents` (session restore, measured per document) and `finish`. A stage without a measure
shows a moving shimmer over the track; a measured one moves the bar within its share. The bar never moves backwards.
The model is `createBootProgress()` in `launch.js` (tests: `tests/ui/launch-screen.test.js`).

### Browser and PWA

The card is plain HTML and inline CSS in `index.html`, so it paints with the first frame without any module. `launch.js`
themes it (the saved theme, else the system's), removes it at once when the launch screen is off, and fades it out
(about 0.3 s, none with reduced motion) when the app is ready. A 15-second safety timer removes it when start-up fails,
so the error panels stay reachable. The artwork loads lazily with low priority; a gradient in the artwork's colors
fills its place until it arrives. The service worker precaches it like every other file of the build.

### Desktop app

The main window is created hidden (`visible: false`). A small frameless, centered, non-resizable, always-on-top
`splash` window loads `splash.html`, shows itself after its first paint (no empty frame) and listens for the main
window's progress (`openfini://launch` events). When the app is ready the main window calls `launch_ready`: the Rust
side shows and focuses the main window and destroys the splash window, once. It never blocks start-up:

- a timer in `lib.rs` shows the main window after 10 seconds whatever happens;
- the app lock prompt and the crash-loop panel show the main window first (`__ofLaunch.reveal()`);
- with the launch screen turned off, `launch_ready` is called right away (by the splash window and the main window);
- files opened from the OS during start-up are delivered as usual; the main window comes to the front when ready;
- every failure of the splash window is ignored.

The main window keeps its own position and size handling: the splash window only decides *when* it is shown.

## Accessibility

The card is a `role="status"` live region (`aria-live="polite"`, `aria-busy="true"` until ready) with a
`role="progressbar"` (`aria-valuenow` while measured). `prefers-reduced-motion` and the app's own *Reduce motion* turn the
shimmer and fades off. Light and dark follow the theme setting (the dark variant has a dark footer).

## Replacing the artwork for a release

1. Export the new artwork as WebP, **1600 × 670 px** (about 2.39:1), quality around 70, ideally under 200 KB
   (`tests/ui/launch-screen.test.js` fails above 200 KiB).
2. Save it over `app/assets/launch/artwork.webp` (keep the name; nothing else references the file).
3. Optionally adjust the placeholder gradient in `.of-splash__art` (both HTML files) to the new colors.
4. Run `npm run build` and `npm run check:size`; the artwork counts towards the total download budget.

The card always crops the artwork with `object-fit: cover`, so a slightly different aspect ratio still works. A
user-chosen image is not supported yet; it would replace the `src` of the card's image from a stored preference in
`launch.js`.
