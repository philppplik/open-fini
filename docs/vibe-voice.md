# Vibe voice: spoken replies, speech input and voice chat

What works today, what is designed but not built, and where audio and text go. Settings: *Settings ▸ Artificial
intelligence ▸ Voice*. User guide: [vibe-studio.md](vibe-studio.md).

## Status at a glance

| Part | Status | Runs where |
| --- | --- | --- |
| Spoken replies (text-to-speech) | Built | The operating system's speech engine through the Web Speech API; on-device voices only by default. |
| Expressive reading | Built | Sentence plan with prosody, see below. |
| Speech input with the system recognizer | Built (as before, now switchable) | Browser or OS. **Chromium-based browsers (Chrome, Edge, the Windows desktop app's WebView2) send the audio to the vendor's online service.** Safari and some systems recognize on the device. |
| Voice chat mode | Built | Composer button: listen, send when you stop talking, read the answer, listen again. |
| Local model manager | Built | Download with approval, streaming SHA-256 check, storage in the origin-private file system, delete. |
| Local speech-to-text runtime | **Not built** | Designed: whisper.cpp compiled to WebAssembly in a worker. Choosing *Local model* says so and dictation stays unavailable. |
| Local neural text-to-speech | Not built | The system voices are used; a Piper/ONNX voice runtime is a possible later addition. |

## Spoken replies and expressive reading

When *Read Vibe's replies aloud* is on (or voice chat is active), the newest answer is read after each run. The text
is prepared by `speakableText` (code blocks become "code omitted", links keep their label, markdown symbols are
dropped) and split by `planSpeech` into sentences:

| Sentence | Pitch | Rate | Pause after |
| --- | --- | --- | --- |
| Statement | 1.0 | 1.0 | 150 ms, 450 ms at a paragraph end |
| Question (`?`) | 1.12 | 0.98 | same |
| Exclamation (`!`) | 1.15 | 1.06 | same |
| Trailing ellipsis | 0.97 | 0.9 | +250 ms |
| "Note", "Warning", "Important" | 0.95 | 0.94 | same |
| Longer than 160 characters | 1.0 | 1.04 | same |

The values multiply the user's speed and pitch. *Expressive reading* off reads everything flat. The voice is the one
you chose, else an on-device voice for the interface language (`pickVoice`); *Only voices that run on this device*
(default on) hides online voices, which would send the text to the browser vendor. Typing, sending, the voice chat
button or *Stop* end a reading.

## Speech input and voice chat

The microphone button and voice chat use the engine chosen in *Speech input*: **System speech recognition** (the
default, the same engine the microphone used before), **Off** (hides the microphone) or **Local model**. Switching to
the system engine shows the online-service disclosure first. The recognition language follows the interface language.

Voice chat (switch *Voice chat in the composer*, then the speaker button next to the microphone): Vibe listens for one
utterance, sends it, reads the answer and listens again, until you press the button again, type, or nothing was said.

## Local models

The catalog (`SPEECH_MODELS` in `app/src/vibe/speech.js`) lists four whisper.cpp GGML models (tiny multilingual,
tiny English, base, small; quantized q5_1, 31 to 181 MB, MIT license). URLs are pinned to one commit of
`huggingface.co/ggerganov/whisper.cpp`; size and SHA-256 come from the repository's LFS metadata.

**Download.** *Download…* shows the model, size, host and license and asks for approval. Offline mode blocks it. The
file is streamed: every chunk updates an incremental SHA-256 (`Sha256`, constant memory) and is written to the
origin-private file system (`speech-models/`). A larger, smaller or differently hashed file is deleted and the error
says why. A small JSON marker with size, hash and time is written only after a successful check; only marked models
count as installed. Models never leave the device and are not part of exports or profiles.

**Runtime (designed, not built).** The intended runtime is whisper.cpp built with Emscripten (SIMD, single thread
first), run in a dedicated worker that receives the model from the private file system and 16 kHz mono PCM from an
`AudioWorklet`, and returns text segments. It is not bundled because the WebAssembly build (about 1 MB gzip) needs a
reproducible build step and a size-budget decision, and real-time factors on low-end hardware still need measuring.
`localRuntimeAvailable()` returns `false` and `transcribeLocal()` throws a clear message until then.

## Privacy

| Data | Goes to |
| --- | --- |
| Replies read aloud | The OS speech engine; online voices only when you allow them. |
| Your voice (system recognizer) | The browser or OS recognizer; online for Chromium-based browsers. |
| Recognized text | The composer, then the model you chose, like typed text. |
| Downloaded models | huggingface.co once, then this device only. |

## Code

| Part | Location |
| --- | --- |
| Settings defaults, model catalog, speech plan, voice choice, streaming SHA-256, verified streaming (pure) | `app/src/vibe/speech.js`, tests `tests/vibe/speech.test.js` |
| Playback, recognizer, model storage | `app/src/vibe/speech-runtime.js` (lazy) |
| Settings panel | `app/src/ui/vibe/panel-voice.js` (lazy) |
| Composer microphone, voice chat, reading after a run | `app/src/ui/vibe/chat.js` |
