# ADR 0020: Color management and PDF/X output

Status: accepted (0.10 development)

## Context

Print users need CMYK colors, a soft proof and PDF/X files with an output intent. OpenFini is MIT licensed, runs in the
browser without a build step, and has tight size budgets (start-up 370 KiB gzip). Established color engines (LittleCMS
as WebAssembly, about 200-300 KiB) and measured CMYK profiles (FOGRA, GRACoL, SWOP: license restrictions or unclear
redistribution terms, 0.5-2 MB each) do not fit those constraints. We have no PDF/X validator in CI.

## Decision

* A compact pure-JS ICC engine (`app/src/engine/color/`): matrix/TRC and LUT-based (lut8/lut16/lutAtoB/lutBtoA) profiles,
  XYZ and Lab PCS, four intents, simplified black point compensation, LUT baking for images and the proof.
* No bundled CMYK profile. A built-in approximate CMYK (ink model) is the default, clearly labeled; users load the ICC
  profile of their printing condition, which is stored inside the document.
* Per-document color settings and native CMYK/spot values are additive fields in `.ofini` (no format version bump): the
  RGB `color` of a paint remains its preview, so older versions keep working.
* PDF/X-1a:2003 and PDF/X-4 from the existing PDF writer: DeviceCMYK conversion, OutputIntent, identification keys and
  XMP; PDF/X-1a flattens transparent pages by rasterizing them. Without a real profile the output is labeled
  "PDF/X-ish, not validated".
* A preflight with an explicit, documented check list instead of claims of conformance.
* Everything loads lazily; the soft proof post-processes the rendered canvas only while it is on.

## Consequences

* Color accuracy with a loaded profile depends on our engine (multilinear interpolation, simplified BPC); it is tested
  with synthetic profiles only, not against LittleCMS output or real press profiles.
* X-1a flattening turns text on transparent pages into pixels; a vector flattener is future work.
* Files can claim PDF/X identification without being validated; the UI, docs and preflight say so.
* Shell JS grows by about 17.5 KiB gzip (budget +15 KiB), start-up by about 0.7 KiB.
* Revisit when a validator becomes available in CI, or when a permissively licensed, small measured CMYK profile exists.
