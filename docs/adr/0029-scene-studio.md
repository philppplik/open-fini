# ADR 0029: Scene Studio (video editing and motion design)

- Status: Accepted
- Date: 2026-11-11

## Context

OpenFini has studios for vector, pixel, layout, code and office work, and none for time. People who design a
poster or a slide deck in OpenFini have to leave for another program to cut a clip, add a title or export a short
video. The assistant (Vibe) can edit every document natively but has no way to work with video.

The goal is one studio that covers the two things people expect from separate products: a timeline editor
(cut, trim, tracks, transitions, sound) and a motion design tool (keyframes, easing, effects, text animation,
compositions), usable by hand and by the assistant, running in the browser, the PWA and the desktop app, without a
server and without a helper program.

## Decision

Add the **Scene Studio** (`app/src/scene/`, registered in `studios/scene.js`). Full description:
[docs/scene-studio.md](../scene-studio.md).

1. **One data model, pure.** A scene is one immutable value (`scene/model.js`): a sequence with tracks, clips,
   markers, media items and pre-compositions. Editing operations are pure functions that return a new model. Times
   are seconds on the frame grid.
2. **Frame = f(model, time).** `scene/evaluate.js` turns the model and a time into a plain list of layers with
   resolved properties. The viewer, the exporter, thumbnails and the assistant's `scene_render_frame` all draw that
   same list with the same compositor (`scene/render.js`), so the preview and the export cannot disagree. This is
   the property that makes a declarative, Remotion-like description possible: the assistant writes data, not
   imperative animation code.
3. **Canvas 2D compositor with a WebGL pass.** Transforms, opacity, blend modes and CSS filters use the 2D canvas
   (GPU-accelerated in every engine). Per-pixel effects (color grade, looks, chroma key, duotone, vignette,
   posterize, grain) run in one WebGL 2 fragment shader (`scene/gl.js`) and fall back to the same formulas on the
   CPU (`scene/effects.js ▸ applyPixel`), which is also what the unit tests check.
4. **Media through the browser's decoders.** Import and playback use `<video>` elements and `decodeAudioData`;
   sound always plays from decoded buffers through Web Audio, so picture and sound follow one clock and the same
   audio graph renders the export offline.
5. **Export with WebCodecs and our own containers.** Frames are rendered with exactly seeked sources and encoded
   with `VideoEncoder` / `AudioEncoder`; `scene/mux.js` writes MP4 (H.264 + AAC or Opus) and WebM (VP9 / VP8 +
   Opus) from the specifications. GIF, PNG sequences, WAV and a still frame need no codec support at all.
6. **Storage in the existing project container.** A scene document is an OpenFini document whose project
   (`doc.office`, `core/office.js`) has kind `"scene"`: the model goes into `document.json`, media bytes into
   `office/scene/media/`. This reuses undo and redo (`commitOffice`), autosave, the session, the file format's
   version rule (version 2 already means "a project of another kind") and collaboration by copy. The Office Suite
   never mounts a scene; the Scene Studio has its own host (`scene/host.js`).
7. **A tool group for the assistant** (`vibe/tools/scene.js`, `scene-understand.js`): inspect, edit, animate,
   render a frame to look at it, export, and understand footage (transcript, shots, silence, loudness, beats,
   sampled frames, a searchable index).

## Alternatives considered

- **Bundle ffmpeg (WebAssembly).** It would read and write almost every format, but adds about 25 MB to the
  download, needs cross-origin isolation for threads (which breaks other features), is slow without threads, and
  carries codec licensing questions. Rejected for the core path. See "Desktop path" below for where ffmpeg may
  still earn its place.
- **A user-installed ffmpeg through the desktop app's allow-listed command runner.** Useful for formats the web
  view cannot decode (ProRes, HEVC on some systems, MKV with unusual codecs) and for faster exports. Not built in
  this step: it only helps desktop users, it must not become a requirement, and it needs its own argument
  allow-list and progress protocol. Recorded as the planned desktop extension; the engine registry of the platform
  can host it as an optional "transcode" engine without changing the model.
- **A WebCodecs decode pipeline with our own demuxers.** Faster export and frame-accurate playback, but needs MP4,
  WebM and MOV demuxers and index handling before the first frame shows. The seek-and-capture approach is correct
  today; the decoder pipeline can replace `MediaStore.frameAt` later without touching the model or the compositor.
- **A second document type outside `doc.office`.** Cleaner naming, but it would duplicate undo, autosave, session
  restore, migration and collaboration plumbing that the generic container already provides. Rejected.
- **WebGL or WebGPU for the whole compositor.** Needed for 3D layers and heavy effect stacks, not for the feature
  set of this step, and it would make text and vector layers harder. The compositor interface (`render(ctx, model,
  t)`) hides the choice, so a GPU compositor can replace it.

## Consequences

- Preview equals export by construction; tests can check pictures as data (layer lists, pixel math, container
  structure) without a browser.
- What a platform can import and export depends on its browser engine. The export dialog asks the engine
  (`exportSupport`) and only offers what works; the documentation states the differences.
- Export speed is bounded by seeking the sources (about real time for HD material).
- Media is embedded in the `.ofini` file, so scenes are self-contained and large. Referenced media (a path on
  disk) is a planned addition for the desktop app.
- Changing a clip's speed changes the pitch of its sound; time-remapped compositions are silent.
- Live collaboration shares a scene as a copy (no record-level adapter yet).

## Addendum: scene format 2 (graph editor, nested compositions)

- **Keyframe tangents use After Effects' model** (speed in value units per second plus influence as a fraction of
  the neighboring segment) rather than absolute handle offsets (DaVinci) or one normalized cubic-bezier per
  segment (CSS). Speed and influence keep their meaning when keyframes move in time and when a clip is retimed
  (speeds are divided by the time scale), and a CSS easing maps onto them exactly, so format 1 easings and format 2
  tangents share one evaluator (`keyframes.js ▸ segmentValue`). Tangents are optional per keyframe side: files
  without them evaluate bit for bit as before, which is what makes the change additive.
- **Compositions nest by reference** (`comps` stays flat; a composition clip names its composition), with cycles
  refused on edit and repaired on load by a deterministic depth-first pass. Nesting through copies was rejected:
  "changes show wherever it is used" is the point of a composition.
- **The timeline edits one sequence at a time.** The workspace exposes `seqModel()` / `commitSeq()` for the
  sequence on the timeline and keeps `model()` / `commit()` for the whole scene, so code written against the root
  model (export, the assistant's tools) is unaffected by an open composition tab.
- **Composition sound is flattened** into voices (`evaluate.js ▸ flattenAudio`) instead of rendering nested audio
  graphs, so playback and the offline export keep one scheduling path. Time-remapped compositions stay silent until
  a time-stretch exists.

## Desktop path

The desktop app runs the same engine in the system web view (WebView2, WKWebView, WebKitGTK). WebKitGTK builds
often lack H.264 or AAC encoders: WebM, GIF, PNG frames and WAV still work there. If real-world use shows that
desktop users need more formats, the user-installed ffmpeg engine described above is the next step; bundling
ffmpeg with the installer is not planned (size, licensing).
