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
- Changing a clip's speed changes the pitch of its sound.
- Scene files contain their media, so they can be large.
- In collaboration a scene is shared as a copy.

## See also

- [[Studio Overview]]
- [[File Formats]]
- [[Export and Publish]]
- [[Keyboard Shortcuts]]
