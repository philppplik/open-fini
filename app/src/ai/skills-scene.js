// Built-in Scene Studio skills (tool groups "Scene", "Scene understanding", "Scene automation"). SKILL.md strings parsed
// by parseSkill() in skills.js; format reference: docs/vibe-skills.md. No backticks or template placeholders inside
// the markdown. The studio guide (studio-guide-scene) explains the model; these are task workflows.

const ROUGH_CUT = `---
name: rough-cut-from-transcript
description: Make a rough cut of interviews, talks or vlogs from the transcript in the Scene Studio: transcribe, pick the best parts, cut by transcript, remove filler words and long pauses, check the cuts.
version: 1.0.0
tags: [scene, video, editing]
allowed-tools: scene_describe, scene_transcribe, scene_set_transcript, scene_transcript, scene_analyze_audio, scene_cut_transcript, scene_remove_fillers, scene_remove_silences, scene_render_frame, scene_markers, scene_search, ask_user
params:
  - "goal: What the cut is for and how long it should be"
when-to-use: rough cut, cut the interview, remove the boring parts, Rohschnitt, Interview schneiden, edit my talk, make it shorter
---
# Rough cut from the transcript

1. scene_describe. If no media with speech is on the timeline, ask the user to import and place it.
2. scene_transcribe. If no engine is available, ask for a transcript or subtitle file and store it with scene_set_transcript.
3. scene_transcript: read all segments. Decide what to keep for the goal (story order: hook, context, key points, ending). Prefer whole sentences.
4. scene_cut_transcript mode keep with the chosen segment numbers (one call). For a few unwanted sentences use mode cut instead.
5. scene_remove_fillers with dryRun, then without when the list looks right (soft fillers only on request).
6. scene_analyze_audio, then scene_remove_silences (minDur 0.6, pad 0.12) to tighten pauses.
7. Add markers at the main sections with scene_markers.

## Rules
- Never cut inside a word; keep a breath of air (the tools pad into pauses).
- Jump cuts inside one shot are normal for talking heads; for a smoother result add scene_transition dissolve 0.2 at the cuts only when the user asks.
- If the transcript says word times are estimated, tell the user and check every cut with scene_render_frame.

## Verify
scene_render_frame is your screenshot of the edit. scene_transcript reads as a coherent text; scene_describe shows the new duration; scene_render_frame at three or four cuts shows no jump in mid-gesture you did not intend.
`;

const CAPTIONS = `---
name: video-captions
description: Add readable, well-timed captions to a video in the Scene Studio from the transcript, style them for the platform and export SRT or VTT.
version: 1.0.0
tags: [scene, video, captions, accessibility]
allowed-tools: scene_describe, scene_transcribe, scene_set_transcript, scene_transcript, scene_auto_captions, scene_captions, scene_captions_export, scene_render_frame
params:
  - "style: classic, outline, bold or minimal (default classic; bold for social)"
when-to-use: captions, subtitles, Untertitel, add subtitles, burn in captions, SRT, VTT, closed captions
---
# Captions

1. scene_describe; scene_transcribe if there is no transcript (or scene_set_transcript from a file the user has).
2. scene_auto_captions with the style; vertical video gets 24 characters per line automatically, landscape 42. Use lines 2 for long-form, 1 for social. Social: style bold, anim pop, uppercase only on request.
3. Fix names and terms the recognizer got wrong with scene_captions action edit (read them in scene_describe or scene_captions_export first).
4. If a lower third or title sits at the bottom, move captions with scene_captions action style and y (for example 0.7).
5. When the user wants a file: scene_captions_export format srt or vtt and give the text.

## Rules
- At most two lines, at least about one second on screen, no caption over important on-screen text.

- Captions follow the edit: run scene_auto_captions again after cutting (it replaces the old ones).
- Read the captions aloud in your head: line breaks at natural phrase boundaries, no orphaned single words.
- Keep brand names and spelling the user gave; never invent words the speaker did not say.

## Verify
scene_render_frame (a screenshot of the frame) at three caption times: readable size, contrast, inside the safe area; scene_captions_export shows sensible cue times.
`;

const SOCIAL = `---
name: social-cutdowns
description: Turn a long video into short social clips (Reels, Shorts, TikTok, feed) in the Scene Studio: find strong moments, build a highlight per clip, reframe to 9:16 or 1:1 around the subject, add captions and a hook title.
version: 1.0.0
tags: [scene, video, social]
allowed-tools: scene_describe, scene_transcribe, scene_transcript, scene_search, scene_detect_shots, scene_sample_frames, scene_index_note, scene_highlight_reel, scene_reframe, scene_auto_captions, scene_title, scene_audio, scene_analyze_audio, scene_render_frame
params:
  - "count: How many clips (default 3)"
  - "length: Target length in seconds (default 30)"
when-to-use: social clips, reels, shorts, tiktok, cutdown, vertical version, Hochformat, short clips from my video
---
# Social cutdowns

1. scene_describe; scene_transcribe; scene_detect_shots for the main video.
2. Find moments: scene_transcript for quotable lines with a clear point in under the target length; scene_search for topics the user named.
3. For each clip: scene_highlight_reel with newDocument true and the ranges (timeline seconds), title like the hook.
4. In the new scene: scene_sample_frames perShot to see where the subject is, then scene_reframe aspect 9:16 (or 1:1 for feeds) with focus at the subject (fractions of the frame), or a track of focus points when the subject moves.
5. scene_auto_captions style bold, then scene_title with a short hook (3 to 6 words) at the top in the first 2 seconds.
6. scene_analyze_audio and scene_audio normalize -14 on the speech.

## Rules
- The first two seconds decide: start on the strongest sentence, not on a greeting.
- Keep faces and text inside the middle 80 % of a vertical frame.
- One idea per clip; 15 to 45 seconds; end on a complete sentence, never mid-thought.
- Name the new scenes after their hook so the user can find them.

## Verify
scene_render_frame (your screenshot of the clip) at 0.5 s, the middle and the end of every clip: subject in frame, captions readable, title not covering the face.
`;

const TITLE = `---
name: title-animation
description: Create an animated title or title card in the Scene Studio with a motion preset, a subtitle and colors that match the video, then check it frame by frame.
version: 1.0.0
tags: [scene, motion, typography]
allowed-tools: scene_describe, scene_catalog, scene_title, scene_animate_clip, scene_keyframes, scene_update_clips, scene_effect, scene_render_frame, scene_new
params:
  - "text: The title"
when-to-use: animated title, title card, intro title, Titel animieren, Vorspann, opening title, kinetic text
---
# Title animation

1. scene_describe (scene_new template title if the user wants a standalone title card).
2. scene_title with text, subtitle and a preset: fade-up (calm), pop or boxed (energetic), typewriter (tech), letters or words (expressive), underline (corporate), zoom-through (cinematic), blur-in (soft). Background only for a standalone card.
3. Refine: scene_update_clips for font, size and color; scene_keyframes for exact timing; scene_effect shadow or glow for contrast over footage.

## Rules
- At most two type sizes, high contrast, on screen at least as long as it takes to read it twice.
- Match the mood: calm footage gets slow fades and light weights, sport and music get pop, boxed and short durations.
- Over footage add contrast: a shadow effect on the text or a dark solid at 40 % opacity behind it (scene_add_layer solid, opacity 0.4).
- Colors: take the accent from the brand or from a strong color in the footage; white or near-white text over dark images.

## Pitfalls
- Titles that start before the picture is ready (place them after the first cut) or end exactly on a cut.

## Verify
scene_render_frame (a contact sheet works as a screenshot of the motion) at start + 0.2 s, the middle and the end - 0.2 s: the animation moves, the title is fully visible at rest and inside the safe area.
`;

const LOWER_THIRD = `---
name: lower-third
description: Add name and role lower thirds for the people in a video in the Scene Studio, timed to when they first speak, consistent in style.
version: 1.0.0
tags: [scene, motion, graphics]
allowed-tools: scene_describe, scene_transcript, scene_search, scene_lower_third, scene_update_clips, scene_render_frame, ask_user
params:
  - "people: Names and roles"
when-to-use: lower third, name tag, Bauchbinde, Namenseinblendung, show the speaker name, name and title on screen
---
# Lower thirds

1. scene_describe; if names or roles are missing ask_user once.
2. Find when each person first speaks: scene_transcript or scene_search with their topic or name.
3. scene_lower_third per person at that time + 1 s, dur 5, the same style and color for everybody (bar or box for business, line or minimal for documentary).
4. If captions exist, keep them apart: move captions up with scene_captions or put the lower third on the other side.

## Rules
- Same style, color, side and duration for every person; repeat a lower third only after a long absence.
- Names exactly as the user spelled them; roles short (at most five words).
- Not in the first second of a shot and never across a cut: start and end inside one shot (scene_describe shows the clip edges).
- On vertical video use a larger size and the box style, and keep it above the bottom fifth where apps place their buttons.

## Pitfalls
- A lower third over a lower-third-like graphic in the footage, or over burned-in captions; move it or shorten it.
- Several speakers in one shot: one lower third at a time, each while that person speaks.

## Verify
scene_render_frame (your screenshot) at each lower third + 1 s: text fully inside the frame, readable over the background, not covering the face.
`;

const SLIDESHOW = `---
name: photo-slideshow
description: Build a photo slideshow video in the Scene Studio with Ken Burns moves, transitions, music and changes on the beat, plus an opening title.
version: 1.0.0
tags: [scene, video, photos, music]
allowed-tools: scene_describe, scene_new, scene_import_media, scene_slideshow, scene_analyze_audio, scene_title, scene_audio, scene_render_frame, list_attachments
params:
  - "seconds: Seconds per photo (default 3)"
when-to-use: slideshow, photo video, Diashow, Fotoshow, pictures to video, memories video, ken burns
---
# Photo slideshow

1. scene_describe; scene_new if needed (vertical for phones). Import attached photos and music with scene_import_media (one call per file).
2. With music: scene_analyze_audio for it, then scene_slideshow with media in story order, music and beats 4 (or 2 for fast songs above 140 BPM). Without music: dur 3, transition dissolve.
3. scene_title at the start (preset fade-up or boxed) and, if wanted, a closing title.
4. scene_audio on the music: fadeOut 2, normalize -16.

## Rules
- Order photos as a story (chronological, or establishing shot first, close-ups after); group similar photos.
- Portrait photos in a landscape video: fit instead of fill, or the Ken Burns move cuts heads off; check them.
- 2 to 4 seconds per photo; slower for calm music, faster on the beat for energetic songs.
- Keep the Ken Burns strength low (0.6 to 1) for faces and text in photos.

## Pitfalls
- Music longer than the photos: the tool trims it to the slideshow and fades it out; check the fade.

## Verify
scene_render_frame every few seconds (one contact sheet as your screenshot): faces not cut off by the Ken Burns move, transitions where expected; scene_describe shows the music ending with the last photo.
`;

const BEAT_EDIT = `---
name: beat-synced-edit
description: Cut a montage to the beat of a song in the Scene Studio: analyse the music, pick the cut rate, fill the cuts with the best shots, add an energetic title.
version: 1.0.0
tags: [scene, video, music, montage]
allowed-tools: scene_describe, scene_analyze_audio, scene_detect_shots, scene_sample_frames, scene_beat_cuts, scene_transition, scene_title, scene_audio, scene_render_frame
when-to-use: cut to the beat, beat sync, music video, montage, Schnitt im Takt, auf den Beat schneiden, highlight montage
---
# Beat-synced edit

1. scene_describe: note the music id and the footage ids.
2. scene_analyze_audio for the music (tempo and beat grid). Cut rate: every 2 beats for 90 to 130 BPM, every 4 above 130, every beat only for short bursts.
3. Optional: scene_detect_shots and scene_sample_frames to order the sources from calm to intense.
4. scene_beat_cuts with music, sources in that order and every; limit with from and to for a build-up section.
5. scene_title with preset pop on the first downbeat; scene_audio fadeOut on the music.

## Rules
- If the tempo confidence is low (below 0.2), the beat grid may be off: check two cuts by rendering frames around them and fall back to every 4 beats.
- Mix close-ups and wide shots; avoid the same source twice in a row (the tool alternates sources in order).
- Sound of the footage stays off (the cuts are picture only); keep the music at -14 LUFS for social, -16 otherwise.
- Hard cuts on the beat; transitions only at section changes (scene_transition dissolve).

## Pitfalls
- Sources shorter than the montage loop from their start; give more sources for long songs.

## Verify
scene_describe: the cut clips start on beat times; scene_render_frame contact sheet (your screenshot of the montage) over the montage shows variety and no black frames.
`;

const SUMMARY = `---
name: video-summary
description: Watch and summarize a video in the Scene Studio: transcript, shots and sampled frames become a written summary with chapters and time codes, and the scene index becomes searchable.
version: 1.0.0
tags: [scene, video, analysis]
allowed-tools: scene_describe, scene_transcribe, scene_transcript, scene_detect_shots, scene_sample_frames, scene_index_note, scene_search, scene_markers
when-to-use: summarize the video, what happens in this video, chapters, Zusammenfassung des Videos, Kapitel, video notes, find where
---
# Video summary

1. scene_describe; scene_transcribe the main item (skip silently if no engine and say the summary is visual only).
2. scene_detect_shots, then scene_sample_frames perShot (several sheets with from/to for long videos). Write one short note per shot with scene_index_note: who, what, where, on-screen text.
3. Read scene_transcript. Write the summary: one paragraph, then chapters as time code plus title (use timeline times), then key quotes with time codes.
4. If the user wants, add the chapters as markers with scene_markers.

## Rules
- Only state what the transcript or the frames show; mark guesses as such.
- Notes are for search: concrete nouns and visible text, one sentence each, no opinions.
- Long videos: sample per shot in windows of 10 minutes (from/to) so each sheet stays readable.
- Chapters at topic changes, not at every shot; 3 to 10 chapters for most videos.

## Pitfalls
- Time codes from the source instead of the timeline after edits: scene_transcript shows both; use the timeline ones.
- Summarizing only the transcript of a mostly visual video: sample frames first.

## Verify
Look at one sampled sheet again as a screenshot check of your notes. scene_search for two facts from your summary returns the matching times.
`;

export const SCENE_SKILLS = [ROUGH_CUT, CAPTIONS, SOCIAL, TITLE, LOWER_THIRD, SLIDESHOW, BEAT_EDIT, SUMMARY];
