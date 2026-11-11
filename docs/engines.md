# Engines: pluggable speech, search, knowledge-base loaders and OCR

OpenFini asks one registry (`app/src/platform/engines.js`) for the engine behind speech input, spoken replies, web
search, knowledge-base loading and text recognition. Built-in engines, extensions and MCP adapters register there, so
a new engine needs no change to the core.

## Kinds

| Kind | Method | Used by | Built in |
| --- | --- | --- | --- |
| `stt` | `listen(opts)` (streaming) or `transcribe(pcm, opts)` (batch) | Microphone and voice chat with *Speech input ▸ Local model* (first engine with `local: true`); Scene Studio transcription `scene_transcribe` (batch engines only, local first) | `system` (browser or OS recognizer; online in Chromium-based browsers, so `local: false`) |
| `tts` | `speak(text, opts)`, `stop()` | Registry only for now; spoken replies still use the system voices directly | `system` |
| `search` | `search(query, { limit, signal })` → `[{ title, url, snippet }]` | *Web access ▸ Search backend* lists registered engines next to the built-in backends | none (the built-in backends stay in `web-access.js`) |
| `rag-loader` | `load(bytes, { path, signal, ocr })` → `{ text, pages?, skipped? }` | `rag_add_source` (project and folder), *Knowledge ▸ Add files* | `pdf` (text layer, lazily loaded pdf.js) |
| `ocr` | `recognize({ width, height, data }, { lang, signal })` → `{ text }` | The PDF loader for pages without a text layer | none |

Every descriptor has `id` (unique per kind), `label` and `local`. `local: true` is a promise that nothing leaves the
device; the Voice settings name the local recognizer in use. Engines from extensions get the id
`ext:<extension id>:<id>`, MCP adapters `mcp:<server>:<tool>`. Built-ins always come first, so loading an extension
never changes a default silently; a user choice (search backend `engine:<id>`) or `local: true` selects others.

## Registering from an extension

Needs the `vibe` permission. Register from the background script (`main.js`); the engine is removed when the
extension stops, is disabled or is stopped by the watchdog. Calls run in the extension's worker with the usual RPC
limits (2-minute timeout, size caps); `AbortSignal`s and functions are not passed across.

```js
await openfini.engines.register({
  kind: "stt", id: "whisper", label: "Whisper (WebAssembly)", local: true,
  // pcm: Float32Array, 16 kHz mono, one utterance; model: { id, file: File } when the user downloaded one
  run: async (pcm, { lang, model }) => ({ text: await myWhisper.transcribe(pcm, { lang, model: model?.file }) }),
});
```

Batch `stt` engines get one utterance: OpenFini records from the microphone (`vibe/speech-capture.js`: mono, resampled
to 16 kHz, ends after 1.2 s of silence, 30 s at most, 8 s without speech ends with no text) and passes the samples and
the model chosen in *Settings ▸ Artificial intelligence ▸ Voice* (downloaded and SHA-256 checked there). Streaming
`listen` engines are possible only in the app itself, not from an extension.

The Scene Studio transcribes files with the same batch engines (`scene/ai-runtime.js ▸ transcribeMedia`): the
sound of a media item is cut into chunks of at most 28 s at pauses, and each chunk is one `transcribe` call (16 kHz
mono). An engine may return `{ words: [{ t0, t1, w }] }` or `{ segments: [{ t0, t1, text }] }` with times in seconds
from the chunk start; with only `{ text }` the word times are estimated and the transcript is marked as such. An
engine with `local: false` is used only after the user approves sending the sound. Details:
[scene-studio.md](scene-studio.md#understanding-footage).

## MCP adapters

`mcpEngine(kind, { server, tool, callTool, map, parse })` wraps one MCP tool as an engine (for example a search
server's `search` tool). `local` defaults to `false`. There is no settings UI to create such an adapter yet; code that
holds an MCP client registers it.

## Knowledge base PDFs

The `pdf` loader reads the text layer page by page (at most 1000 pages, 50 MiB per file; the extracted text counts
toward the 20 MiB per call). Results are cited as `[n] file.pdf p.3`. Pages with fewer than 16 characters of text are
rendered (browser only) and sent to the first registered `ocr` engine; without one they are listed as skipped with the
reason. Password-protected PDFs are refused with a hint. Folders read from disk keep the 2 MiB per-file read limit of
the folder reader, so larger PDFs there are skipped; add them through *Knowledge ▸ Add files* or a project.

## What is not here

- No OCR engine and no local speech recognizer are bundled (size and build reasons, see
  [limits-audit.md](limits-audit.md)).
- Export formats are not registry engines: extensions add exporters through `contributes.exporters`.
- Spoken replies do not yet switch to a registered `tts` engine.

## Code and tests

`app/src/platform/engines.js` (registry, `extensionEngine`, `mcpEngine`), `app/src/platform/builtin-engines.js`,
`app/src/vibe/rag-pdf.js`, `app/src/vibe/speech-capture.js`, `app/src/vibe/speech-runtime.js` (`listenLocal`),
`app/src/extensions/host.js` (`engines.register`); tests in `tests/platform/engines.test.js`.
