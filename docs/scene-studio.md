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
  leaves it: linear, ease, ease in, ease out, ease in and out, overshoot, hold, or a custom cubic bezier
  (`[x1, y1, x2, y2]`, as in CSS).
- **Text animation** (*Animate in / out*): fade, slide, pop, typewriter, letter by letter, word by word, blur.
- **Transitions** at a clip's edges: fade, cross dissolve, dip to black / white, slide, wipe, zoom, blur. A cross
  dissolve keeps the previous clip of the same track visible underneath (it uses source frames past its end).
- **Pre-compose** (Clip menu) moves the selected clips into a composition that then behaves like one clip.
- **Adjustment layers** apply their effects to everything below them.

Animation is data: `{ kf: [{ t, v, e }] }` per property (`scene/keyframes.js`). The frame at a time is a pure
function of the model (`scene/evaluate.js ▸ frameState`), which is why preview and export are identical and why the
assistant can describe motion declaratively.

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
{ version: 1, title, width, height, fps, background,
  tracks:  [{ id, kind: "video" | "audio", name, muted, hidden, locked }],   // top first
  clips:   { <id>: Clip },
  markers: [{ id, t, name, color }],
  range:   { in, out } | null,
  comps:   { <id>: { id, name, width, height, tracks, clips, markers } },
  media:   { <id>: { id, kind, mime, name, duration, w, h, hasAudio, bytes } },
  analysis: { <mediaId>: { transcript, shots, silence, beats, loudness } } }

Clip { id, track, type: video | audio | image | text | shape | solid | adjustment | comp, name,
       start, dur,                 // seconds on the timeline, on the frame grid
       in, speed, media | comp,    // source offset, rate and source of media / composition clips
       x, y, sx, sy, rot, opacity, // animatable; x, y = center in sequence pixels
       volume, pan,                // animatable (audio and composition clips)
       crop, blend, mask, effects: [{ id, type, on, p }], tin, tout, fadeIn, fadeOut, muted,
       text: { … }, caption, shape: { … }, color }
```

Invariants (checked by `normalizeScene` and kept by every operation): clips of one track never overlap; `start`
and `dur` are multiples of `1 / fps`; a media clip never reads past its source; pre-compositions do not nest media
or other compositions' definitions.

### Operations (`scene/model.js`, all pure)

`addClip`, `placeMedia`, `updateClip`, `moveClip`, `moveClips`, `trimClip` (ripple), `splitClip`, `splitAll`,
`deleteClips` (ripple), `cutRanges`, `keepRanges`, `insertGap`, `closeGaps`, `slipClip`, `setSpeed`,
`duplicateClips`, `setKeyframe`, `removeKeyframe`, `setProp`, `addEffect`, `updateEffect`, `removeEffect`,
`setTransition`, `addTrack`, `removeTrack`, `updateTrack`, `moveTrack`, `addMarker`, `removeMarker`, `setRange`,
`addMedia`, `removeMedia`, `setAnalysis`, `precompose`, `describeScene`.

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
- `scene/view.js` owns the frame loop: one `requestAnimationFrame` loop while playing, one frame per change
  otherwise. While playing, the audio context's time is the clock.

## Files

| File | Role |
| --- | --- |
| `studios/scene.js`, `commands/scene.js` | Registration, menus, commands (the only start-up code is the registration) |
| `scene/host.js` | Mounts the workspace per document, start screen, `newScene` |
| `scene/view.js` | Workspace: bin, viewer, transport, keyboard, the instance API |
| `scene/timeline.js`, `scene/inspector.js` | Timeline canvas and gestures; properties panel |
| `scene/model.js`, `scene/keyframes.js`, `scene/evaluate.js` | Pure model, animation and frame evaluation |
| `scene/render.js`, `scene/gl.js`, `scene/effects.js` | Compositor, WebGL pass, effect registry |
| `scene/media.js`, `scene/audio.js`, `scene/frames.js` | Media store, audio engine, exact frames |
| `scene/export.js`, `scene/mux.js`, `scene/gif.js`, `scene/export-dialog.js` | Export, containers, GIF, dialog |
| `scene/captions.js` | SRT / VTT, captions |
| `tests/scene/` | Model, keyframes, evaluation, effect math, containers, GIF, WAV, captions |

## Limits

- Export speed is about real time (sources are seeked frame by frame).
- Changing a clip's speed changes the pitch of its sound. Reverse playback is not supported (J steps back).
- Pre-compositions are silent. Their content cannot be opened in the timeline yet; the model operations take a
  sequence id, so tools can edit them.
- No graph editor yet: easing is chosen per keyframe; custom bezier values are set through the assistant or the
  file.
- Media is embedded in the `.ofini` file (large files); referenced media is planned for the desktop app.
- Scenes are shared in collaboration as a copy, not edited live.
- Not verified on real hardware: Safari, Firefox, the desktop app on all three systems, long sequences (above ten
  minutes), 4K export.
