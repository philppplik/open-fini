# 0031: Launch screen: inline card for the web, a separate splash window on the desktop

Status: Accepted

## Context

OpenFini starts in a second or two, but on slow devices, with a large session to restore, the window shows an empty
dark frame first. The owner asked for a launch screen like other creative suites show: a card with the release
artwork, a thin progress bar, the logo and the version, light and dark, with a real progress bar driven by the boot.

Constraints:

- **Start-up budget.** `scripts/size-budget.json` caps the start-up module closure at 351 KiB gzip with almost no
  headroom; the launch screen must not make start-up slower or bigger.
- **Never block.** A broken launch screen must never keep the app from showing, including the crash-loop panel
  (`bootguard.js`) and the app lock prompt.
- **No white flash on the desktop.** A WebView window shows its background before the page paints.
- **Offline.** The PWA must show the same card offline.

## Options

a. **A module that draws the card from JavaScript.** Paints only after the module graph loaded, which is most of the
   wait; adds to the start-up closure.
b. **Inline HTML and CSS in `index.html` plus a tiny classic script** (chosen for the web). The card paints with the
   first frame; the script (`src/launch.js`) runs synchronously right after the card, so it themes or removes the card
   before the first paint, and it is not module code, so the start-up budget does not change.
c. **Desktop: the same inline card inside the main window.** The main window would have to be visible from the start,
   with its full size, title bar and the dark frame before the first paint.
d. **Desktop: a separate small splash window** (chosen). The main window is created hidden and only shown when it is
   ready, so it never shows an unpainted frame; the splash window is small, frameless, transparent around the card,
   centered and always on top while loading.

## Decision

Options b and d, sharing one card:

- The card markup and its critical CSS live inline in `index.html` and `splash.html` between markers; a test keeps the
  two copies identical. `launch.js` serves both pages: in the main window it owns the progress model and, on the
  desktop, forwards it to the splash window with Tauri events; in the splash window it only renders what arrives.
- Progress comes from real boot stages with weights (`createBootProgress`): start, language, studios, interface,
  documents (measured per restored document), finish. Stages without a measure show an indeterminate shimmer.
- The desktop shell reveals the main window in one idempotent function (`reveal_main_window`): on `launch_ready`, or
  after a 10-second timeout. Opening files from the OS during start-up does not show the window early.
- The version is stamped into the HTML at build time from `package.json` (never written by hand); development builds
  fill it at run time.
- The artwork is an ordinary file (`app/assets/launch/artwork.webp`), loaded lazily with low priority over a
  placeholder gradient, and precached by the service worker.
- The tab-to-studio memory that shipped with this change (docs/studios.md) is imported right after start instead of
  statically, which keeps its code out of the start-up closure.

## Consequences

- The total download grows by the artwork (about 107 KiB; WebP does not compress further). The start-up module budget
  grows by 1 KiB for the boot-stage calls and the tab hooks; the card itself adds no module code.
- Two HTML files carry the same card; changing it means changing both (the test fails otherwise).
- The splash window cannot be exercised in CI or a browser; its logic is small and covered by configuration tests,
  but it needs a manual check on each desktop platform.
- Swapping the artwork per release is a file replacement ([docs/launch-screen.md](../launch-screen.md)). A user-chosen
  image later only needs `launch.js` to read a stored image instead of the bundled one.
