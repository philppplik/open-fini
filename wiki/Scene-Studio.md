# Scene Studio

The Scene Studio is OpenFini's video editor and motion design tool. Cut video and sound on a timeline, animate text,
shapes and pictures with keyframes, add effects and transitions, and export MP4, WebM, GIF, PNG frames or WAV.
Everything runs on your device.

## Getting started

- **Open the studio:** the header's *More* menu, *Studio ▸ Scene*, or the command palette. Add it to the header in
  *Settings ▸ Studios* to get an `Alt` shortcut.
- **New scene:** the start screen offers a blank sequence (Full HD), vertical and square formats, an animated title
  and a lower third. *File ▸ New…* in the studio creates a blank sequence.
- **Add media:** *Import media…* in the Media panel, or drop video, audio and image files. Drag an item to the
  timeline, or double-click it to add it at the playhead. A video with sound becomes a video clip and an audio clip.
- **Save:** *File ▸ Save* writes an `.ofini` file that contains the scene and its media.

## The workspace

| Area | Use |
| --- | --- |
| Media (left) | Imported files; buttons for Text, Shape, Solid and Adjustment layer |
| Viewer (center) | The picture at the playhead; drag a layer to move it, a corner to scale, the top handle to rotate |
| Properties (right) | Everything about the selected clip, or the sequence format when nothing is selected |
| Timeline (bottom) | Video tracks on top (upper = in front), audio tracks below |

## Editing

| Task | How |
| --- | --- |
| Play and stop | `Space`, or `J` `K` `L` |
| Step one frame | `Left` / `Right` |
| Cut | `C` for the razor, or `Ctrl+K` to split at the playhead |
| Trim | Drag a clip edge; hold `Alt` to pull the later clips along |
| Delete and close the gap | `Shift+Delete` |
| Mark a range | `I` and `O`; `'` removes the range and closes the gap |
| Marker | `M` |
| Snapping | `S` |

The full list is in `docs/scene-studio.md` in the repository.

## Animation

Click the diamond next to a property (position, scale, rotation, opacity, volume, effect values) to add a keyframe
at the playhead. Move the playhead, change the value, and OpenFini animates between the two. With the playhead on a
keyframe, *Easing* chooses how the motion starts and ends. Text clips have ready-made animations (*Animate in* and
*Animate out*), clips have transitions at both edges.

### Graph editor

`Shift+F3` (or *View ▸ Graph Editor*, or the curve button above the timeline) shows the selected clip's animation as
curves, as in After Effects or DaVinci Resolve:

- Switch between the **value graph** and the **speed graph**; *Normalize* gives every curve the full height.
- Click a keyframe to select it, drag it in time and value (`Shift` = one direction), drag empty space to select
  several. Double-click a curve to add a keyframe.
- Drag the **handles** of a selected keyframe to shape the curve; hold `Alt` (or tick *Broken*) to move the two
  sides independently.
- **Easing:** *Linear*, *Easy ease* (`F9`, `Shift+F9` for in, `Ctrl+Shift+F9` for out), *Hold*, and ease, overshoot,
  bounce, elastic or your own cubic-bezier under *Easing…*.
- Type exact times, values, speeds and influences in the fields; `Ctrl+C` / `Ctrl+V` copy keyframes to the playhead;
  `F` fits the view.

## Compositions

A composition is a small sequence used as one clip: an animated logo, a lower third, a group of clips with one
effect on top.

- **Pre-compose** (*Clip* menu) turns the selected clips into a composition; *New Composition* (*Sequence* menu, or
  the plus under *Compositions* in the Media panel) starts an empty one.
- **Double-click** a composition clip (or the composition in the Media panel) to open it in its own tab. The path
  above the timeline (Main › Intro › Logo) leads back.
- Drag a composition from the Media panel to the timeline to use it again; changes show everywhere it is used.
  Compositions can contain compositions, but never themselves.
- On a composition clip: move, trim, speed, transform, effects, masks and blend modes like any clip; its sound plays
  along. *Time remapping* lets you keyframe which moment is shown (speed ramps, reverse, freeze frames).
  *Collapse transformations* draws its content sharp at any size and without cutting it off at its frame.

## Effects

Color grade, looks, chroma key (green screen), blur, glow, drop shadow, duotone, vignette, posterize, film grain,
masks and blend modes for pictures; equalizer, compressor, low cut, high cut and noise gate for sound.

## Captions

Import `.srt` or `.vtt` subtitles to get caption clips on a *Captions* track. The export dialog saves the captions
as `.srt` or `.vtt`; they are also part of the exported picture.

## Export

*Sequence ▸ Export Video…*: MP4 (H.264), WebM (VP9), animated GIF, a PNG image sequence, the sound as WAV, or the
current frame as PNG. The dialog only offers what your browser can encode. Chromium-based browsers and the desktop
app on Windows export every format; other browsers may lack MP4 or sound in MP4.

## Limits

- Export takes about as long as the video plays.
- Changing a clip's speed changes the pitch of its sound; time-remapped compositions are silent.
- The graph editor shows one clip at a time; colors are animated in Properties.
- Scene files contain their media, so they can be large.
- In collaboration a scene is shared as a copy.

## See also

- [[Studio Overview]]
- [[File Formats]]
- [[Export and Publish]]
- [[Keyboard Shortcuts]]
