# Engine contracts

This document defines the data shapes and module boundaries that the OpenFini
engines share. Every engine module under `app/src/engine/pixel`,
`app/src/engine/layout` and `app/src/engine/backends` is **pure**: it must not
touch the DOM, `window`, `document`, `Canvas`, `OffscreenCanvas` or `ImageData`,
so it runs unchanged in the browser, in a Web Worker and in Node.js (for tests).

Conventions

- ES modules only, no build step required, no dependencies except the vendored
  libraries in `app/vendor` (`fflate`, `polygon-clipping`).
- All user-facing strings are US English (`en-US`).
- JSDoc types on every exported function. Tight loops use typed arrays and avoid
  allocations — OpenFini targets low-power devices.
- Coordinates: x right, y down, units are document pixels unless stated.
- Tests live in `tests/**/*.test.js`, use `node:test` and `node:assert/strict`,
  and run with `npm test` (Node 20+).

---

## 1. Primitive types

```js
/** Affine matrix, identical to CanvasRenderingContext2D.transform(a,b,c,d,e,f):
 *  x' = a*x + c*y + e ;  y' = b*x + d*y + f */
type Mat = [a: number, b: number, c: number, d: number, e: number, f: number];

/** RGBA, 8 bit, NON-premultiplied, row-major — the same layout as ImageData. */
type RGBAImage = { width: number; height: number; data: Uint8ClampedArray }; // length = width*height*4

/** 8 bit coverage mask, 0 = unselected, 255 = fully selected. */
type MaskData = { width: number; height: number; data: Uint8Array };         // length = width*height

type Color = string;   // '#rrggbb' or '#rrggbbaa' (lower-case hex), always sRGB
```

### 1.1 Control schema (auto-generated UI)

Adjustments, filters, effects and the Develop pipeline describe their parameters
with a schema; the UI builds property panels from it, so engine authors never
write UI code.

```js
type Control = {
  key: string;                       // property name inside `params`
  label: string;                     // US English, Title Case
  type: 'range' | 'int' | 'bool' | 'select' | 'color' | 'angle' | 'curve' | 'point';
  min?: number; max?: number; step?: number;   // range / int / angle (degrees)
  options?: { value: string; label: string }[]; // select
  unit?: string;                     // e.g. 'px', '%', '°'
  group?: string;                    // optional section heading
  hint?: string;                     // tooltip
  default: any;
};
// 'curve' value: [[x,y], ...] with x,y in 0..1, sorted by x, first x=0 last x=1
// 'point' value: {x,y} in 0..1 relative to the image
// 'color' value: Color
```

### 1.2 Effect registries

```js
type EffectModule = {
  id: string;                        // stable identifier, kebab-case
  label: string;
  category: string;                  // used for menus, e.g. 'Tone', 'Color', 'Blur'
  defaults: object;                  // params with all defaults
  controls: Control[];
  /** Applies the effect. May mutate `img` and return it, or return a new image
   *  (same size unless the effect documents otherwise). Must not keep references.
   *  `ctx.scale` is the render scale (1 = document pixels). Any length-like param
   *  (radius in px, ...) MUST be multiplied by ctx.scale so a zoomed-out preview
   *  matches the full resolution result. Masks/selections are applied by the HOST. */
  apply(img: RGBAImage, params: object, ctx: { scale: number }): RGBAImage;
};
// Registries export plain objects keyed by id:  export const ADJUSTMENTS = { levels: {...}, ... }
```

### 1.3 Vector path model (`VPath`) — editable, node based

```js
type VNode = {
  x: number; y: number;              // anchor
  ix: number | null; iy: number | null;   // incoming handle, ABSOLUTE coordinates, null = none
  ox: number | null; oy: number | null;   // outgoing handle, ABSOLUTE coordinates, null = none
  t?: 'smooth' | 'symmetric' | 'cusp';    // handle behavior when editing (default 'cusp')
};
type VSubpath = { closed: boolean; nodes: VNode[] };
type VPath = { subpaths: VSubpath[] };   // fill rule is a property of the owning shape
```

---

## 2. Display list (DL)

The scene graph is compiled into a display list (cached per node). Backends
consume only the display list: Canvas2D (screen, PNG, JPEG, WebP), SVG and PDF.

```js
type PathCmd =
  | ['M', x, y] | ['L', x, y]
  | ['C', x1, y1, x2, y2, x, y]      // cubic
  | ['Q', x1, y1, x, y]              // quadratic
  | ['Z'];
type PathData = PathCmd[];

type Stop  = { o: number /*0..1*/; color: Color /* '#rrggbb' */; alpha: number /*0..1*/ };
type Paint =
  | { type: 'solid';  color: Color; alpha: number }
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: Stop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; fx?: number; fy?: number; stops: Stop[] }
  | { type: 'conic';  cx: number; cy: number; angle: number /*radians*/; stops: Stop[] };
// Paint coordinates live in the same local space as the item's geometry (before `m`).
// Print/vector backends may approximate or rasterize 'conic'.

type Stroke = {
  paint: Paint; width: number;
  cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; miterLimit: number;
  dash: number[] | null; dashOffset: number;
};

type ImageRef = {
  id: string;                        // stable id, used for de-duplication
  width: number; height: number;
  rgba?: Uint8ClampedArray;          // raw RGBA (non-premultiplied) — present for the PDF/SVG exporters
  jpeg?: Uint8Array;                 // original JPEG bytes if available (PDF passes them through unchanged)
  source?: any;                      // host-only (canvas / bitmap). Pure backends ignore it.
};

type TextRun = {                     // one run of identically styled glyphs on a single baseline
  text: string;
  x: number; y: number;              // origin of the first glyph, y = BASELINE, in item-local space
  width: number;                     // advance width of the whole run (already includes letterSpacing)
  font: { family: string; size: number; weight: number; style: 'normal' | 'italic' };
  fill: Paint | null; stroke: Stroke | null;
  letterSpacing: number;             // px added after every glyph
  underline: boolean; strike: boolean;
};

type DLItem =
  | { t: 'path';  d: PathData; rule: 'nonzero' | 'evenodd'; fill: Paint | null; stroke: Stroke | null; m: Mat }
  | { t: 'image'; img: ImageRef; m: Mat /* image pixel space -> parent space */; smooth: boolean }
  | { t: 'text';  runs: TextRun[]; m: Mat }
  | { t: 'group'; items: DLItem[]; m: Mat; opacity: number; blend: Blend;
      clip: { d: PathData; rule: 'nonzero' | 'evenodd'; m: Mat } | null; isolate: boolean }
  | { t: 'adjust'; kind: string; params: object };   // raster only; never reaches the PDF/SVG backends

type Blend = 'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|
             'hard-light'|'soft-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity';
              // identical to CSS mix-blend-mode and to the PDF /BM names (PascalCase in PDF)

type DisplayList = { width: number; height: number; items: DLItem[] };   // one per page, page px, y down
```

Backend entry points

- `backends/pdf.js`: `createPDF(pages: DisplayList[], options): Uint8Array`
- `backends/svg.js`: `displayListToSVG(dl, options): string` (written by the host)
- `backends/canvas.js`: `drawDisplayList(ctx, dl, options)` (written by the host, needs DOM)

---

## 3. Text model

Rich text is a **story**: an ordered list of paragraphs, each made of runs.
Frames (text boxes) display a story, and several frames can be linked to flow one
story across them (Layout studio).

```js
type CharAttrs = {
  fontFamily?: string; fontSize?: number /*px*/; fontWeight?: number /*100..900*/;
  fontStyle?: 'normal' | 'italic'; color?: Color;
  underline?: boolean; strike?: boolean;
  tracking?: number;      // 1/1000 em, added after each glyph
  baselineShift?: number; // px, positive = up
  caps?: 'none' | 'upper' | 'small';
  field?: 'pageNumber' | 'pageCount' | 'date' | string; // run text is replaced by opts.fields[field] at layout time
};
type ParaAttrs = {
  align?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;            // multiplier of the font size, default 1.25
  spaceBefore?: number; spaceAfter?: number;          // px
  indentFirst?: number; indentLeft?: number; indentRight?: number; // px
  hyphenate?: boolean;
  keepLinesTogether?: boolean; keepWithNext?: boolean; widowOrphan?: number; // min lines, default 2
  bullet?: null | { kind: 'bullet' | 'number' | 'alpha' | 'roman'; char?: string; indent?: number };
  dropCap?: null | { lines: number; chars: number };
  tabs?: { pos: number; align: 'left' | 'right' | 'center' | 'decimal'; leader?: string }[];
};
type Run       = { text: string; attrs?: CharAttrs; styleId?: string };  // no '\n' in text; '\t' and ' ' (forced line break) allowed
type Paragraph = { runs: Run[]; attrs?: ParaAttrs; styleId?: string };
type Story     = { paragraphs: Paragraph[] };

// Document level styles (referenced through styleId):
type Styles = {
  paragraph: { [id: string]: { name: string; basedOn?: string; next?: string; attrs?: ParaAttrs; char?: CharAttrs } };
  character: { [id: string]: { name: string; basedOn?: string; attrs: CharAttrs } };
};
type Defaults = { char: Required<Pick<CharAttrs,'fontFamily'|'fontSize'|'fontWeight'|'fontStyle'|'color'>> & CharAttrs; para: ParaAttrs };
```

Resolution order (later wins): defaults → paragraph style (+ its `char`) → paragraph attrs →
character style → run attrs.

The story is addressed by a single **character offset** (paragraph breaks count as
one character), so that carets, selections, undo and clipboard share one coordinate system.

---

## 4. Module ownership

| Area | Files | Owner |
| --- | --- | --- |
| Pixel algorithms (adjustments, filters, selection masks, flood fill, liquify, retouch, histogram, develop, tracing contours) | `app/src/engine/pixel/*` | pixel engine |
| Text model, text layout, SFNT font parsing, PDF backend, CSV data merge | `app/src/engine/layout/*`, `app/src/engine/backends/pdf.js` | layout engine |
| Desktop shell (Tauri), PWA, build scripts, CI/CD, platform bridge | `src-tauri/*`, `app/sw.js`, `app/manifest.webmanifest`, `app/src/platform/*`, `scripts/*`, `.github/*` | packaging |
| Document model, history, scene graph, display list builder, canvas/SVG backends, vector geometry, UI, studios | `app/src/core/*`, `app/src/engine/vector/*`, `app/src/engine/backends/{canvas,svg}.js`, `app/src/ui/*`, `app/src/studios/*` | host |
