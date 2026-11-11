# Scene Studio

Video editing and motion design on a timeline: cut video and sound, animate text, shapes and pictures with
keyframes, add effects and transitions, and export MP4, WebM, GIF, PNG frames or WAV. Everything runs on the
device; no helper program and no server. The design decision is recorded in
[ADR 0029](adr/0029-scene-studio.md).

This page is the user guide and the engineering guide. Code lives in `app/src/scene/`.

## Workspace

The layout follows what video editors share, so existing habits work:

| Area | What it does |
| --- | --- |
| **Media** (left) | The project's files. *Import media…* or drop files. Drag an item to the timeline, or double-click to add it at the playhead. Below: *Text*, *Shape*, *Solid*, *Adjustment* add a generated clip at the playhead. |
| **Viewer** (center) | The frame at the playhead. Click a layer to select it; drag to move, drag a corner to scale, drag the top handle to rotate (Shift = straight / 15° steps). Transport, time code and level meters below. |
| **Properties** (right) | The selected clip: transform, crop, mask, text, shape, transitions, sound, effects, keyframe easing. With nothing selected: the sequence format, frame rate, background and the markers. |
| **Timeline** (bottom) | Tracks with clips. Video tracks on top (the upper track is in front), audio tracks below. Track headers: hide / mute, lock, rename (double-click). |

### Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| J, K, L | Step back one second, stop, play (press L again for 2×, 4×, 8×) |
| Left, Right | One frame back / forward (Shift: half a second) |
| Up, Down | Previous / next edit point (clip edges, markers, In / Out) |
| Home, End | Start / end of the sequence |
| I, O, X | Set In, set Out, clear In and Out |
| ; and ' | Lift (remove the In to Out range) / extract (remove it and close the gap) |
| V, C, Y, H | Selection, razor, slip, hand tool |
| Ctrl+K | Split at the playhead (the selection, or every clip under the playhead) |
| Q, W | Ripple trim the start / the end to the playhead |
| Delete, Shift+Delete | Delete / ripple delete (close the gap) |
| Ctrl+D, Ctrl+A | Duplicate / select all clips |
| M, T, S | Add a marker / add text / toggle snapping |
| +, -, \ | Zoom the timeline in / out / fit the sequence |
| Shift+F3 | Graph editor on / off (its own keys: [Graph editor](#graph-editor)) |

Undo, redo, save and the other application shortcuts work as everywhere.

### Timeline gestures

- **Move:** drag a clip (the whole selection moves; other tracks of the same kind are allowed). What a clip lands on
  is overwritten, as in an overwrite edit.
- **Trim:** drag a clip edge. **Alt** = ripple trim (later clips follow). A media clip cannot grow past its source.
- **Razor (C):** click to cut; **Shift** cuts all tracks.
- **Slip (Y):** drag a clip to move its source under it.
- **Marquee:** drag empty space. **Shift / Ctrl-click** adds to the selection.
- **Scrub:** drag in the ruler. **Wheel** scrolls, **Ctrl / Alt + wheel** zooms around the pointer.
- **Snapping (S):** clip edges, markers, In / Out and the playhead attract; a line shows the snap.

## Animation

Position, scale, rotation, opacity, volume, pan and every numeric effect parameter can be animated.

- The **diamond** next to a property adds or removes a keyframe at the playhead. Once a property has keyframes,
  changing its value (in the panel or by dragging in the viewer) writes a keyframe at the playhead.
- Keyframes show as yellow diamonds on the clip. With the playhead on a keyframe, **Easing** sets how the value
  leaves it: linear, easy ease (in / out), ease, ease in, ease out, ease in and out, overshoot, bounce, elastic or
  hold. Curves and tangents are shaped in the **graph editor** (below).
- **Text animation** (*Animate in / out*): fade, slide, pop, typewriter, letter by letter, word by word, blur.
- **Transitions** at a clip's edges: fade, cross dissolve, dip to black / white, slide, wipe, zoom, blur. A cross
  dissolve keeps the previous clip of the same track visible underneath (it uses source frames past its end).
- **Pre-compose** (Clip menu) moves the selected clips into a composition that then behaves like one clip
  ([Compositions](#compositions)).
- **Adjustment layers** apply their effects to everything below them.

Animation is data: `{ kf: [{ t, v, e, i, o, b }] }` per property (`scene/keyframes.js`, [Data model](#data-model)).
The frame at a time is a pure function of the model (`scene/evaluate.js ▸ frameState`), which is why preview and
export are identical and why the assistant can describe motion declaratively.

### Graph editor

*View ▸ Graph Editor*, the curve button in the tool strip, the *Graph editor* button in Properties or **Shift+F3**
shows the animated properties of the selected clip as curves in place of the timeline (loaded on first use).

| | |
| --- | --- |
| Value graph / speed graph | The value of each property over time, or its rate of change (units per second). |
| Normalize | On: every curve uses the full height (0 to 100 % of its own range). Off: real units on one axis. |
| Properties list | One color per property; the check box shows or hides the curve, the name selects all its keyframes. |
| Keyframes | Click selects (Shift / Ctrl adds), drag moves in time and value (Shift = one axis), snapping to frames and, with snapping on (S), to the playhead, markers and other keyframes. Drag empty space for a box selection. Double-click a curve to add a keyframe. |
| Handles | Selected keyframes show their Bezier handles. Drag a handle to change speed (height) and influence (length); the other side follows (unified) unless the keyframe is **Broken** or you hold **Alt** while dragging. In the speed graph the handle's height is the speed and its length the influence. |
| Easing | *Linear*, *Easy ease* (F9), easy ease in (Shift+F9), easy ease out (Ctrl+Shift+F9), *Hold*, and in *Easing…* ease, ease in, ease out, ease in and out, overshoot, bounce, elastic or a custom cubic-bezier (`x1, y1, x2, y2`, as in CSS). |
| Numeric entry | Time, value, and speed and influence of both handles of the one selected keyframe. |
| Copy / paste | Ctrl+C copies the selected keyframes (several properties keep their timing), Ctrl+V pastes them at the playhead into the same properties of the selected clip (one copied property pastes into the one selected property). |
| View | F fits all curves, Shift+F the selection; wheel scrolls, Ctrl / Alt + wheel zooms time, Shift + wheel zooms values, middle button or Alt-drag pans; drag the ruler to scrub. Delete removes keyframes, arrows nudge them (one frame / 1 %; Shift ×10). |

Tangent model (After Effects'): each side of a keyframe has a **speed** (value units per second) and an
**influence** (0 to 100 % of the neighboring segment's length), so tangents keep their meaning when keyframes move in
time. A segment with a tangent on either side is a 2D cubic Bezier; when the two influences add up to more than
100 % both are shortened so time stays monotonic. Segments without tangents evaluate exactly as in format 1.

## Compositions

A composition is a sequence of its own (tracks, clips, markers, frame size) that is used as a clip.

- **Create**: *Pre-compose* (Clip menu) moves the selected clips, sound included, into a new composition and puts
  one composition clip in their place. It works inside compositions too (nesting). *Sequence ▸ New Composition* or
  the plus button under *Compositions* in the bin makes an empty one.
- **Open**: double-click a composition clip (or *Clip ▸ Open Composition*) or the composition in the bin. It opens
  in its own tab above the timeline; the breadcrumb shows the path you came from (Main › Intro › Logo) and each
  entry jumps back. The playhead maps into the composition's time. Tabs close with ×; the composition stays.
- **Use**: drag a composition from the bin onto the timeline (Shift+Enter places it at the playhead). A composition
  cannot contain itself, directly or through other compositions: such a drop is refused with a message, and a file
  with such a loop is repaired on load (the clip that closes the loop is dropped).
- **The composition clip** behaves like a video clip: move, trim (it shows the composition's frames from `in`),
  speed, transform, opacity, blend mode, crop, mask, transitions and effects, volume, pan and fades.
- **Time remapping** (Properties ▸ Composition, or *Clip ▸ Time Remapping*): the *Source time* property says which
  moment of the composition is shown. Turning it on adds keyframes that reproduce the current timing; keyframe it
  (with Bezier easing in the graph editor) for speed ramps, reverse play and freezes, or remove all keyframes for a
  freeze frame. A remapped clip can be made longer than its composition.
- **Collapse transformations** (off by default): the composition's layers are drawn straight into the parent at the
  parent's resolution: no clipping to the composition's frame and sharp vector content at any scale. The clip's own
  effects, mask, opacity and blend mode still apply to the collapsed result.
- **Sound** of a composition plays through its clips, with the composition clip's speed, trim, volume, fades and
  pan applied on top, at any depth.
- **Bin**: *Compositions* lists every composition with its length; rename (pencil) and delete (×; also deletes the
  clips that use it, after a question).
- A composition has no background (it is transparent); frame rate and background belong to the main sequence, and
  In / Out points too.

## Effects

| Group | Effects |
| --- | --- |
| Color | Brightness and contrast, hue and saturation, black and white, sepia, invert, **color grade** (exposure, temperature, tint, contrast, saturation, vibrance, shadows, midtones, highlights), **look** (six presets) |
| Keying | **Chroma key** (key color, tolerance, softness, spill removal) |
| Blur | Gaussian blur |
| Stylize | Drop shadow, glow, duotone, vignette, posterize, film grain |
| Audio | Equalizer (low, mid, high), compressor, low cut, high cut, noise gate |

Masks (rectangle or ellipse, feather, invert), crop and 17 blend modes are clip properties.

Engineering: `scene/effects.js` is the registry. An effect has a `stage`: `filter` (CSS filter of the canvas),
`pixel` (WebGL shader in `scene/gl.js`, CPU fallback `applyPixel` with the same formulas), `glow`, or `audio`
(Web Audio nodes in `scene/audio.js`). `registerEffect(id, def)` adds a type. When you change a pixel formula,
change the JavaScript and the GLSL together; the tests check the JavaScript.

## Sound

Every audio clip has volume and pan (both animatable), fade in and out, and audio effects. A video with sound is
placed as a video clip plus an audio clip, so picture and sound can be cut separately. Sound is played from decoded
buffers through Web Audio; the `<video>` elements are muted and follow the audio clock. The export renders the same
graph offline.

## Captions

`.srt` and `.vtt` files import as caption clips on a *Captions* track; the export dialog saves the captions of the
sequence as `.srt` or `.vtt`. Caption clips are text clips with a flag, so they are burned into the exported
picture and can be styled like any text (`scene/captions.js`: four styles, words → cues).

## Formats

Import uses the browser's decoders, export uses WebCodecs. What works depends on the engine:

| | Chromium, desktop app on Windows (WebView2) | Safari, desktop app on macOS (WKWebView) | Firefox | Desktop app on Linux (WebKitGTK) |
| --- | --- | --- | --- | --- |
| Import video | MP4 / MOV (H.264, on most systems HEVC), WebM (VP8, VP9, AV1) | MP4 / MOV (H.264, HEVC), WebM (VP9 on recent versions) | MP4 (H.264), WebM | depends on the installed GStreamer plugins |
| Import audio | MP3, WAV, AAC / M4A, Ogg, Opus, FLAC | MP3, WAV, AAC / M4A, FLAC | MP3, WAV, AAC, Ogg, Opus, FLAC | depends on GStreamer |
| Import images | PNG, JPEG, GIF (first frame), WebP, AVIF, SVG | same | same | same |
| Export MP4 | H.264 + AAC | H.264; sound as AAC where the encoder exists, else none | H.264 where the system provides it; sound as Opus | often unavailable |
| Export WebM | VP9 / VP8 + Opus | VP9 on recent versions | VP9 / VP8 + Opus | VP8 / VP9 where built in |
| GIF, PNG frames, WAV, still PNG | yes | yes | yes | yes |

The export dialog asks the engine and disables what it cannot encode. When AAC is missing, MP4 gets Opus sound and
the dialog says which players read that.

Not supported: ProRes, DNxHD, image sequences as one clip, multi-channel audio beyond stereo, HDR, variable frame
rate preservation, files above 4 GB in MP4. A user-installed ffmpeg as an optional desktop engine is planned
(ADR 0029 ▸ Desktop path).

## Export

*Sequence ▸ Export Video…* (also File ▸ Export in this studio): format, size (100, 75, 50 or 25 %), frame rate,
quality, range (whole sequence or In to Out), sound. Each frame is rendered with exactly seeked sources, so the
file matches the preview frame for frame; expect about real time for HD material.

`scene/export.js ▸ exportScene(store, model, options)` is the programmatic entry; `scene/mux.js` writes the
containers (MP4: `ftyp`, `mdat`, `moov` with one sample per chunk; WebM: clusters at key frames plus cues).

## Data model

Stored as the document's project of kind `"scene"` ([file-format.md](file-format.md)): the model in
`document.json ▸ office`, media bytes in `office/scene/media/<id>.<ext>`.

```
{ version: 2, title, width, height, fps, background,
  tracks:  [{ id, kind: "video" | "audio", name, muted, hidden, locked }],   // top first
  clips:   { <id>: Clip },
  markers: [{ id, t, name, color }],
  range:   { in, out } | null,
  comps:   { <id>: { id, name, width, height, tracks, clips, markers } },    // clips may use other comps
  media:   { <id>: { id, kind, mime, name, duration, w, h, hasAudio, bytes } },
  analysis: { <mediaId>: { transcript, shots, silence, beats, loudness, notes } } }   // source seconds; see Assistant

Clip { id, track, type: video | audio | image | text | shape | solid | adjustment | comp, name,
       start, dur,                 // seconds on the timeline, on the frame grid
       in, speed, media | comp,    // source offset, rate and source of media / composition clips
       x, y, sx, sy, rot, opacity, // animatable; x, y = center in sequence pixels
       volume, pan,                // animatable (audio and composition clips)
       remap?, collapse?,          // composition clips: time remap (animatable, seconds), collapse transformations
       crop, blend, mask, effects: [{ id, type, on, p }], tin, tout, fadeIn, fadeOut, muted,
       text: { … }, caption, shape: { … }, color }

Animatable value: a constant, or { kf: [Keyframe] } with
Keyframe { t, v,                   // seconds from the clip start, value
           e?,                     // easing of the leaving segment: "hold" | "ease" | "easeIn" | "easeOut" |
                                   //   "easeInOut" | "back" | "bounce" | "elastic" | [x1, y1, x2, y2]
           i?, o?,                 // format 2, numbers only: [speed, influence] of the entering / leaving handle
           b? }                    // format 2: true = broken tangents
```

Invariants (checked by `normalizeScene` and kept by every operation): clips of one track never overlap; `start`
and `dur` are multiples of `1 / fps`; a media clip never reads past its source; no composition reaches itself
through its clips; compositions carry no media or composition definitions of their own (both live in the model).

**Format history and migration.** Version 1 was the first release. Version 2 adds, all optional: keyframe
tangents `i`, `o`, `b`; the `bounce` and `elastic` easings; nested compositions; `remap` and `collapse` on
composition clips; composition sound. `normalizeScene` migrates: a version 1 file loads unchanged and renders the
same frames (tested), cycles in foreign files are broken deterministically, and the model is saved as version 2.
An older OpenFini opening a version 2 file drops what it does not know (tangents become the plain easing of the
keyframe, nested composition clips stay) and keeps working.

### Operations (`scene/model.js`, all pure)

`addClip`, `placeMedia`, `updateClip`, `moveClip`, `moveClips`, `trimClip` (ripple), `splitClip`, `splitAll`,
`deleteClips` (ripple), `cutRanges`, `keepRanges`, `insertGap`, `closeGaps`, `slipClip`, `setSpeed`,
`duplicateClips`, `setKeyframe`, `removeKeyframe`, `setProp`, `addEffect`, `updateEffect`, `removeEffect`,
`setTransition`, `addTrack`, `removeTrack`, `updateTrack`, `moveTrack`, `addMarker`, `removeMarker`, `setRange`,
`addMedia`, `removeMedia`, `setAnalysis`, `precompose`, `describeScene`.

A sequence is the root ("main") or a composition: `sequence(model, seqId)` returns it with the shared `fps`, `media`
and `comps`; every operation above works on it; `commitSequence(model, seqId, next)` (or `inSequence(model, seqId,
fn)`) writes it back, keeping media and compositions the operation added.

#### Curves (graph editor and assistant)

| Function | What it does |
| --- | --- |
| `animatedPaths(clip)` | The animated property paths of a clip (`x`, …, `remap`, `fx:<effect id>:<param>`). |
| `keyframesOf(m, id, path)` | `[{ t (timeline seconds), v, e?, in: [speed, influence], out, broken? }]`: the effective tangents, also where they come from an easing. |
| `setEasing(m, id, path, preset, { at })` | Preset on the keyframes at timeline time(s) `at` (null = all): `linear`, `easyEase`, `easyEaseIn`, `easyEaseOut`, `hold`, `ease`, `easeIn`, `easeOut`, `easeInOut`, `back`, `bounce`, `elastic` or `[x1, y1, x2, y2]`. |
| `setKeyframeTangents(m, id, path, t, { in, out, broken })` | Bezier tangents of the keyframe at `t`; unified keyframes mirror the speed. |
| `moveKeyframes(m, id, path, at, dt, dv)` | Moves keyframes in time (frame-snapped) and value. |
| `pasteKeyframes(m, id, path, keys, t)` | Pastes keyframes (times relative to the first) at `t`. |
| `editKeyframes(m, id, path, fn)` | Low level: `fn(track, clip) → track` with the pure helpers of `scene/keyframes.js` (`applyEasing`, `setTangents`, `tangentsOf`, `moveKeys`, `removeKeys`, `copyKeys`, `pasteKeys`, `speedAt`). |

#### Compositions

| Function | What it does |
| --- | --- |
| `precompose(seq, ids, name)` | Moves clips (sound included) into a new composition; works in any sequence. Returns `{ model, id, comp }`. |
| `addComp(m, { name, width, height })`, `updateComp(m, id, patch)`, `removeComp(m, id)` | Create, rename / resize, delete (with the clips that use it). |
| `placeComp(seq, compId, { start, track })` | A composition clip of the composition's length; refused when it would make a cycle. |
| `setTimeRemap(seq, id, on)` | Time remapping of a composition clip on (keyframes reproduce the timing) or off; then animate `remap` like any property. |
| `updateClip(seq, id, { collapse })` | Collapse transformations on / off. |
| `compRefs(comp)`, `compReaches(comps, a, b)`, `wouldCycle(m, seqId, compId)`, `compUsage(m, compId)` | Nesting queries and cycle detection. |
| `evaluate.js ▸ sourceTime(clip, local)`, `flattenAudio(m, { seq })` | Source time of a clip (speed or remap); the sound of a sequence with compositions resolved. |

Example for a tool: "ease the opacity animation of the title":
`setEasing(seq, titleId, "opacity", "easyEase")`, then `ui.commitSeq(…)` in the workspace (or `ui.commit(…)` with
`commitSequence` when editing a composition that is not on the timeline).

`cutRanges(model, [[t0, t1], …])` removes time ranges from every unlocked track and closes the gaps. It is the
primitive behind "remove the silences" and "cut by transcript".

## Render pipeline

```
model ──frameState(model, t)──▶ layers ──compositor.render(ctx, …)──▶ canvas
                                              ▲
                              provider.source(mediaId, time, clip)
                viewer: playing <video> elements        export, tools: exactly seeked frames
```

- `scene/render.js` draws the layers. Layers that need only canvas features go straight to the target; layers with
  pixel effects, glow, a mask or a wipe go through a scratch canvas.
- `scene/media.js` is the media store: object URLs, one `<video>` per clip for playback, one per media item for
  exact frames (requests are serialized), decoded audio buffers, waveform peaks, thumbnails.
- `scene/frames.js ▸ renderExact` captures every source as a bitmap first, so two clips of the same file at
  different times each get their own frame.
- Compositions render recursively (up to `MAX_NESTING` = 16 levels, a guard: cycles cannot exist): into a canvas of
  the composition's size, drawn like a picture; with *collapse* straight into the parent with the clip's transform.
  Frames of compositions without video (also through nesting) are cached per compositor (4 frames, keyed by
  composition, source time, size and frame; dropped when the compositions or the media change). Exact frames
  (`frames.js`) key sources by clip and source time, so a composition used twice at different times is right.
- `scene/view.js` owns the frame loop: one `requestAnimationFrame` loop while playing, one frame per change
  otherwise. While playing, the audio context's time is the clock.

## Assistant

The Vibe assistant edits scenes natively: 44 tools in three groups, each write call one undo step named
"Vibe: …", every result readable data (ids, times, one line per clip). In the Scene Studio the compact tool list shows
these groups; the studio guide `studio-guide-scene` explains the model to the assistant and to `plan_work` sub-agents
(studio `scene`).

| Group | Tools | What they do |
| --- | --- | --- |
| Scene | `scene_describe`, `scene_catalog`, `scene_new`, `scene_set_format`, `scene_track`, `scene_import_media`, `scene_place_media`, `scene_add_layer`, `scene_move_clips`, `scene_trim_clip`, `scene_split`, `scene_delete_clips`, `scene_set_speed`, `scene_update_clips`, `scene_transition`, `scene_keyframes`, `scene_effect`, `scene_audio`, `scene_markers`, `scene_cut_ranges`, `scene_captions`, `scene_captions_export`, `scene_render_frame`, `scene_show`, `scene_export` | Inspect (compact summary, full detail of chosen clips), edit tracks and clips, keyframes with easing, effects, masks and blend modes, sound (dB, pan, fades, EQ, loudness normalization), markers, captions (create, import SRT/VTT, edit, style, export), look at frames (one frame or a numbered contact sheet), export (asks first) |
| Scene understanding | `scene_transcribe`, `scene_set_transcript`, `scene_transcript`, `scene_detect_shots`, `scene_analyze_audio`, `scene_sample_frames`, `scene_index_note`, `scene_search` | Transcript with word times, shots, silences, loudness, tempo and beats, sampled frames for the vision model, the searchable index |
| Scene automation | `scene_cut_transcript`, `scene_remove_silences`, `scene_remove_fillers`, `scene_auto_captions`, `scene_highlight_reel`, `scene_reframe`, `scene_animate_clip`, `scene_title`, `scene_lower_third`, `scene_slideshow`, `scene_beat_cuts` | Edits driven by the analysis and motion presets; everything they create is ordinary clips and keyframes the user can edit |

Skills: `rough-cut-from-transcript`, `video-captions`, `social-cutdowns`, `title-animation`, `lower-third`,
`photo-slideshow`, `beat-synced-edit`, `video-summary`. Right-click on the viewer or the timeline ▸ **AI**: describe
this moment, animate the selection, add captions, remove silences and filler words, make a vertical version,
summarize the video (and a custom instruction).

### Understanding footage

Analysis results live in `model.analysis[<mediaId>]` in **source seconds** of that media item, so they stay valid
after any edit: the tools map them through the clips that use the item (`ai-auto.js ▸ timelineWords`,
`sourceRangesToTimeline`).

| Analysis | How | Stored as |
| --- | --- | --- |
| Transcript | The sound is decoded, mixed to 16 kHz mono, cut into chunks of at most 28 s at pauses and sent to a **batch** speech engine (`stt` kind with `transcribe`, [engines.md](engines.md)); a local engine is preferred, an online one asks first. Word times come from the engine; a text-only result gets estimated word times (flagged `estimated`). Without a batch engine the tool says so: the built-in system recognizer only listens to the microphone. `scene_set_transcript` stores a transcript or subtitle file the user has. | `transcript { engine, lang, estimated, words [{ t0, t1, w }], segments [{ t0, t1, text }] }` |
| Shots | Frames sampled at 2 to 4 per second (64 × 36 px, the media element seeks), compared in the worker pool (job `scene.shots`): 70 % RGB histogram chi-square distance, 30 % mean luma difference; a cut where the distance is a local maximum above median + 6 × MAD (at least 0.18) and at least 0.6 s after the previous one | `shots [{ t0, t1, score }]` |
| Sound | Worker job `scene.audio` on 16 kHz channels: RMS levels per 20 ms, silences below an automatic threshold (30 % from the 15th to the 85th percentile, -60 to -20 dBFS); integrated loudness per ITU-R BS.1770 (K-weighting, 400 ms blocks, absolute and relative gates) and sample peak; spectral-flux onsets, tempo from the onset autocorrelation with a prior around 120 BPM, beats by dynamic programming | `silence [[t0, t1]]`, `loudness { integrated, peak, threshold }`, `beats { bpm, confidence, times, onsets }` |
| Frames | `scene_sample_frames` hands the vision model a numbered contact sheet (source or timeline seconds, evenly spread or one per shot); the model writes what it sees back with `scene_index_note` | `notes [{ t0, t1, text }]` |

**Search.** `scene_search` ranks transcript segments, visual notes, markers and captions (folded tokens, stop words
for English and German, prefix matches, a bonus for the whole phrase) and returns source and timeline ranges for each
hit; a hit that was cut out of the edit has an empty timeline list.

**Timeline silences.** `scene_remove_silences` cuts only where every audible clip is silent: each audio clip with a
silence analysis contributes its sound ranges, a clip without one counts as sound (unless `ignoreUnanalysed`, for
music beds), muted clips and tracks are ignored.

### Engineering

`scene/ai-ops.js` (editing), `scene/ai-auto.js` (transcript, silences, fillers, captions, index) and
`scene/motion.js` (presets, slideshow, beat cuts, reframe, highlight reel) are pure: `(model, args) → { model,
result }`, unit-tested without a browser. `scene/analysis.js` holds the algorithms (also pure; the worker jobs call
it). `scene/ai-runtime.js` is the browser side: the active scene and its media store (the workspace's, or its own
when the scene is not mounted), exact frames and contact sheets, decoding, frame sampling, the speech engines, import
and export. The tool definitions (`vibe/tools/scene.js`, `vibe/tools/scene-understand.js`) load with Vibe and import
the logic on the first call.

## Files

| File | Role |
| --- | --- |
| `studios/scene.js`, `commands/scene.js` | Registration, menus, commands (the only start-up code is the registration) |
| `scene/host.js` | Mounts the workspace per document, start screen, `newScene` |
| `scene/view.js` | Workspace: bin, viewer, transport, keyboard, the instance API |
| `scene/timeline.js`, `scene/inspector.js` | Timeline canvas and gestures; properties panel |
| `scene/graph.js` | Graph editor (loaded on first use) |
| `scene/model.js`, `scene/keyframes.js`, `scene/evaluate.js` | Pure model, animation and frame evaluation |
| `scene/render.js`, `scene/gl.js`, `scene/effects.js` | Compositor, WebGL pass, effect registry |
| `scene/media.js`, `scene/audio.js`, `scene/frames.js` | Media store, audio engine, exact frames |
| `scene/export.js`, `scene/mux.js`, `scene/gif.js`, `scene/export-dialog.js` | Export, containers, GIF, dialog |
| `scene/captions.js` | SRT / VTT, captions |
| `scene/analysis.js`, `scene/ai-ops.js`, `scene/ai-auto.js`, `scene/motion.js` | Assistant: analysis algorithms, editing operations, transcript-driven edits, motion presets (pure) |
| `scene/ai-runtime.js`, `scene/ai-menu.js` | Assistant: browser side of the tools; right-click ▸ AI |
| `vibe/tools/scene.js`, `vibe/tools/scene-understand.js`, `ai/skills-scene.js` | Tool definitions (three groups) and skills |
| `tests/scene/` | Model, keyframes, evaluation, effect math, containers, GIF, WAV, captions, analysis, every assistant tool's logic; `curves.test.js`: Bezier evaluation, tangent serialization and migration, graph operations, nesting, cycles, time remap, composition sound |

## Limits

- Export speed is about real time (sources are seeked frame by frame).
- Changing a clip's speed changes the pitch of its sound. Reverse playback is not supported (J steps back).
- Time-remapped compositions are silent (their sound would need resampling); compositions at normal or changed
  speed play their sound (pitch follows the speed).
- The graph editor shows the properties of one clip (the first selected). Color keyframes are listed but edited in
  Properties; tangents apply to number properties only.
- In the viewer, a composition used twice at the same moment shares one video player per clip during playback (the
  export is exact); with *collapse transformations* the nested layers' blend modes apply inside the composition's
  result, not against the layers below it.
- Media is embedded in the `.ofini` file (large files); referenced media is planned for the desktop app.
- Scenes are shared in collaboration as a copy, not edited live.
- Not verified on real hardware: Safari, Firefox, the desktop app on all three systems, long sequences (above ten
  minutes), 4K export.
- Assistant: transcription needs a batch speech engine (an extension such as a Whisper WebAssembly build); OpenFini
  ships none, and the system recognizer cannot read files. Shot detection seeks the source (about one to two minutes
  for ten minutes of video) and finds hard cuts, not slow dissolves. Beat tracking assumes a steady tempo. Reframing
  uses a focus point or keyframed focus track the assistant chooses from sampled frames; there is no automatic face
  or object tracking. The assistant tools are unit-tested on the model; in the browser only a short smoke test was
  run (frames, analysis jobs and export are not verified end to end on real footage).
