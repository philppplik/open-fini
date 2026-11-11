// Built-in skills of the Scene Studio (docs/scene-studio.md ▸ Assistant): workflows for common video jobs. SKILL.md
// strings parsed by parseSkill(); tests/scene/tools.test.js checks that every tool they name exists. No backticks
// inside the markdown.

const ROUGH_CUT = `---
name: scene-rough-cut
description: Turn raw talking footage into a tight rough cut - transcribe, remove silences and filler words, cut the parts that do not belong, check the result.
allowed-tools: scene_describe, scene_import_media, scene_add_clip, scene_analyze, scene_transcribe, scene_set_transcript, scene_get_transcript, scene_search, scene_remove_silence, scene_cut_transcript, scene_cut_ranges, scene_render_frame, scene_markers, ask_user
tags: [scene, video, edit, rough cut, interview, podcast]
when-to-use: rough cut, cut the video, remove pauses, remove silence, remove ums, tighten, shorten the interview, edit my talk, cut by transcript, highlight reel
---
# Rough cut from the transcript

## Workflow
1. scene_describe. If the footage is not on the timeline yet: scene_add_clip with type media.
2. scene_analyze the footage (silence, loudness, shots).
3. Get a transcript: scene_transcribe (runs in real time and asks the user), or scene_set_transcript when the user gives subtitles or text.
4. scene_get_transcript and read it. Decide what stays: note segment indices of false starts, repeats, off-topic parts.
5. Cut in this order, each as one step: scene_cut_transcript mode segments (content), then mode fillers, then scene_remove_silence (preview first to see how much goes).
6. scene_render_frame with from, to and count over the result to see that the picture still makes sense at the cuts.
7. Report the old and the new duration and what was removed.

## Watch out
- Cuts close their gaps on all tracks, so sound and picture stay in sync; locked tracks do not move.
- After a cut, timeline times change. Read positions again (scene_get_transcript gives the timeline place of every segment) instead of reusing old numbers.
- Keep 0.1 to 0.2 seconds of each pause; speech without any pause sounds unnatural.
- For a highlight reel use scene_cut_transcript mode keep_segments with the few best segments.
- Do not remove a filler word inside a sentence when it carries meaning; use aggressive only when the user asks.

## Verify
scene_describe for the duration, scene_get_transcript to confirm the kept text reads well, and a screenshot series (scene_render_frame with from, to, count) to see that no cut lands inside a gesture or a word.`;

const CAPTIONS = `---
name: scene-captions
description: Add accurate, readable captions to a video from its transcript, style them for the platform and export subtitle files.
allowed-tools: scene_describe, scene_analyze, scene_transcribe, scene_set_transcript, scene_get_transcript, scene_captions, scene_update_clips, scene_render_frame, ask_user
tags: [scene, video, captions, subtitles, accessibility]
when-to-use: captions, subtitles, add subtitles, burn in captions, srt, vtt, make it accessible, TikTok captions, word by word captions
---
# Captions

## Workflow
1. scene_describe: note the frame size (vertical video needs shorter lines).
2. Transcript: scene_transcribe, or scene_set_transcript from subtitles the user provides. Read it with scene_get_transcript and fix obvious recognition errors by setting it again.
3. scene_captions action create. Horizontal video: maxChars 42, style classic or outline. Vertical video: maxChars 18, lines 2, style bold, y 0.72 so the platform's buttons do not cover the text.
4. scene_render_frame at two or three caption times: text inside the frame, readable over the picture, not over a face.
5. Restyle everything at once with scene_captions action style (textStyle for size, color, font). Single captions are text clips: scene_update_clips changes one.
6. If the user wants a file: scene_captions action export (srt or vtt) and show or save the text.

## Watch out
- Create captions AFTER the cut is final; they follow the timeline at the moment they are created. After more cuts, create them again (create replaces the old ones).
- Two lines at most; a caption should stay on screen at least one second.
- Contrast: white text needs an outline, a box or a shadow.
- Captions are part of the exported picture. For a clean picture plus a subtitle file, export the file, then scene_captions action clear.

## Verify
Take a screenshot with scene_render_frame at the first, a middle and the last caption: every line fits the frame and reads against the picture. scene_describe: the Captions track has one clip per phrase and no gaps where someone speaks.`;

const SOCIAL = `---
name: scene-social-cutdowns
description: Make platform versions of a video - vertical 9:16, square 1:1 or 4:5 - with re-framed pictures, safe margins, captions and a hook in the first seconds.
allowed-tools: scene_describe, scene_reframe, scene_update_clips, scene_cut_ranges, scene_cut_transcript, scene_get_transcript, scene_search, scene_captions, scene_add_clip, scene_animate, scene_render_frame, scene_export, ask_user
tags: [scene, video, social, vertical, reels, shorts, tiktok]
when-to-use: vertical version, reel, short, TikTok, Instagram, square video, 9:16, cutdown, teaser, social clip, repurpose the video
---
# Social cutdowns

## Workflow
1. Ask which platform and length if unknown (Reels, Shorts, TikTok: 9:16, 15 to 60 seconds; feed: 1:1 or 4:5).
2. Work on a copy: tell the user to duplicate the document first, or accept that the original scene changes (undo restores it).
3. Shorten first: pick the strongest part with scene_get_transcript or scene_search, then scene_cut_transcript mode keep_segments or scene_cut_ranges mode keep.
4. scene_reframe to the preset (vertical, square, portrait), mode fill.
5. scene_render_frame contact sheet: where a subject is cut off, move that clip with scene_update_clips x (or keyframe x to follow the subject).
6. Hook: a text clip in the first two seconds (scene_add_clip type text, large, upper third) with scene_animate pop-in.
7. scene_captions create with maxChars 18, lines 2, style bold, y 0.72.
8. Final contact sheet, then scene_export when the user agrees.

## Watch out
- Keep text inside the middle 80 percent of the width and away from the bottom 20 percent (platform interface).
- Filling a 16:9 picture into 9:16 shows about a third of it: check every shot.
- One idea per clip; cut hard, start in the middle of the action.

## Verify
Take a screenshot per shot (scene_render_frame with from, to, count): no subject cut off, text inside the safe area. scene_describe: the duration fits the platform and the frame size is the new format.`;

const TITLES = `---
name: scene-title-animation
description: Design animated titles and lower thirds - text, shapes, timing, easing - that look deliberate and stay readable.
allowed-tools: scene_describe, scene_list_options, scene_add_clip, scene_update_clips, scene_set_keyframes, scene_animate, scene_effects, scene_set_transition, scene_precompose, scene_arrange, scene_render_frame
tags: [scene, motion, title, lower third, animation, intro]
when-to-use: title animation, intro, opener, lower third, name tag, animated text, kinetic typography, end card, call to action
---
# Titles and lower thirds

## Workflow
1. scene_describe for the frame size and where the title goes on the timeline.
2. Build from few parts: a text clip (headline), optionally a second smaller text clip, one shape (bar, box or line) as an anchor, a solid or the footage behind.
3. Place with a grid: margins of 5 percent of the frame; lower thirds sit in the bottom left, baseline about 15 percent above the bottom edge.
4. Animate in 0.4 to 0.8 seconds, hold, animate out faster than in. Text: style.anim (in: chars, words, slide-up, pop) or scene_animate. Shapes: scene_set_keyframes on x, sx or opacity.
5. Stagger: the shape starts first, the headline 0.1 to 0.2 seconds later, the subline after that (start times of the clips).
6. Easing: easeOut for things that arrive, easeIn for things that leave, back for a playful pop, never linear for position.
7. scene_render_frame with from, to and count 8 across the animation and look at the in-between frames.
8. scene_precompose the parts when the title should move or fade as one.

## Watch out
- Two typefaces at most, two sizes, one accent color taken from the footage or the brand.
- Readability over footage: add a shadow, an outline, a box or a darkened adjustment layer (scene_add_clip type adjustment with scene_effects brightness).
- Keep text on screen long enough to read twice.
- A line growing from sx 0 scales from its center; move x at the same time for a line that grows from the left.

## Verify
Take a screenshot series with scene_render_frame (from, to, count 8) over the in and the out animation: nothing jumps, overlaps or leaves the frame, and the resting frame is readable at a glance.`;

const SLIDESHOW = `---
name: scene-slideshow
description: Build a photo or clip slideshow with gentle motion, transitions, titles and music that ducks under speech.
allowed-tools: scene_describe, scene_import_media, scene_slideshow, scene_add_clip, scene_update_clips, scene_set_transition, scene_animate, scene_analyze, scene_duck_music, scene_arrange, scene_render_frame, ask_user
tags: [scene, video, slideshow, photos, montage]
when-to-use: slideshow, photo video, montage, memories video, picture story, product showcase from images
---
# Slideshow

## Workflow
1. scene_describe: the images must be in the media list (the user drops them into the Media panel, or scene_import_media from chat attachments).
2. Order them to tell a story: establishing picture, details, people, closing picture. Ask when the order matters.
3. scene_slideshow with seconds 3 to 5, transition dissolve, kenBurns true.
4. Title at the start and an end card: scene_add_clip type text over the first and last picture, with a fade.
5. Music: scene_add_clip with the music's media id on an audio track, trim it to the length with scene_arrange, fadeOut 2 seconds. With a voice-over: scene_analyze the voice, then scene_duck_music.
6. scene_render_frame contact sheet across the whole show.

## Watch out
- Portrait pictures in a landscape frame: fill crops heads. Use fit for those, over a blurred copy of the same picture on the track below (scene_effects blur 40, scale it up).
- Do not mix many transition types; one kind, plus hard cuts.
- The Ken Burns move alternates direction by itself; do not add zooms on top.

## Verify
Take a screenshot series with scene_render_frame across the show: every picture fills or fits as intended and titles are readable. scene_describe: no gaps between the clips, the music ends with the last picture.`;

const BEAT = `---
name: scene-beat-edit
description: Cut footage to the beat of a music track - analyze the tempo, place clips on beats, add accents on strong beats.
allowed-tools: scene_describe, scene_analyze, scene_add_clip, scene_beat_edit, scene_arrange, scene_set_transition, scene_animate, scene_effects, scene_markers, scene_render_frame
tags: [scene, video, music, beat, montage, edit]
when-to-use: cut to the beat, beat sync, music video, montage to music, sync cuts with music, rhythm edit
---
# Beat-synced edit

## Workflow
1. scene_describe. Put the music on an audio track (scene_add_clip type media) if it is not there.
2. scene_analyze the music: it returns the tempo (bpm) and beat times. If bpm is 0 the track has no clear beat: say so and cut by feel on loud moments instead.
3. Choose the pace: 4 beats per clip for calm, 2 for energetic, 1 for a fast finale.
4. scene_beat_edit with the music id and the media ids in order.
5. Accents: scene_animate zoom-in or pulse on clips that start on a downbeat, or a short flash (adjustment layer with brightness keyframes).
6. scene_markers add at section changes to plan pace changes, then repeat scene_beat_edit with another beats value from that point (start).
7. scene_render_frame contact sheet; ask the user to play it, since rhythm can only be judged by ear.

## Watch out
- Beat times come from the SOURCE of the music; if the music clip is trimmed or moved, scene_beat_edit accounts for it only through the clip's start and in-point.
- Hard cuts on the beat feel tighter than dissolves; keep transitions for section changes.
- Video clips shorter than the beat interval are trimmed to their length, leaving a gap: use longer source clips or fewer beats.

## Verify
Take a screenshot series with scene_render_frame to see that every clip shows a picture, then compare clip starts in scene_describe with the beat times from scene_analyze: they must match to the frame.`;

const EXPLAINER = `---
name: scene-motion-explainer
description: Build a short motion graphics explainer from scratch - scenes of text, shapes and pictures animated with keyframes - without any footage.
allowed-tools: scene_new, scene_describe, scene_list_options, scene_add_clip, scene_update_clips, scene_set_keyframes, scene_animate, scene_effects, scene_set_transition, scene_precompose, scene_tracks, scene_import_media, scene_render_frame, generate_asset, make_palette
tags: [scene, motion, explainer, animation, infographic]
when-to-use: explainer video, motion graphics, animated infographic, animate this idea, animated logo, animated chart, promo animation, storyboard to video
---
# Motion explainer

## Workflow
1. Write the storyboard first: 3 to 6 beats, one sentence each, 3 to 5 seconds per beat. Show it to the user when the brief is open.
2. scene_new (preset by platform). Background: a solid clip over the whole length; make_palette for 3 to 4 colors.
3. Per beat: one headline text clip, one supporting visual (shapes, an imported picture or a page of an open design document through scene_import_media with document), all starting at the beat's time.
4. Motion with intent: things enter from where the eye should travel next. scene_animate for standard moves, scene_set_keyframes for custom paths (x, y, scale, rot, opacity) with easeOut in and easeIn out.
5. Connect beats: let one element stay and move to its new place while the others change, or use one transition type between beats.
6. Depth: a slow drift on the background (scene_animate drift), a vignette on an adjustment layer.
7. scene_render_frame contact sheets per beat: check spacing, overlaps, readability in the in-between frames.

## Watch out
- Positions are the CENTER of a layer in sequence pixels; top left of the frame is 0, 0.
- Upper video tracks are in front. Add tracks with scene_tracks when layers must overlap in time.
- Keyframe times are seconds from the clip start, not timeline times.
- Less is more: at most three things move at the same time.

## Verify
Take a screenshot series with scene_render_frame for each beat, including the frames between keyframes. scene_describe: every beat's clips start together and nothing is left on screen by accident.`;

export const SCENE_SKILLS = [ROUGH_CUT, CAPTIONS, SOCIAL, TITLES, SLIDESHOW, BEAT, EXPLAINER];
