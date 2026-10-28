# Vibe Studio

Vibe Studio is OpenFini's AI studio (`Alt+5`). You describe what you want; an assistant uses OpenFini's own tools to
make it: shapes and text in the Vector studio, adjustments in the Pixel studio, pages in the Layout studio, whole
websites in the Code studio. There is no separate "AI document": everything the assistant makes is a normal OpenFini
document you can keep editing, and every run can be undone in one click.

> **Off by default.** AI features are a master switch under *Settings ▸ Artificial intelligence*. While it is off,
> nothing leaves your device and no AI menu items appear. The offline **Demo** assistant works without it.

## Quick tour

1. Open Vibe Studio (`Alt+5` or the Vibe button in the header).
2. Pick a model in the composer, or add your own connection under **Settings ▸ Artificial intelligence ▸ Models and
   connections** (the composer's model menu has *Manage connections…*). The built-in **Demo
   (offline)** assistant needs no key and shows how the studio works: it follows a small script of real tool calls.
3. Type what you want and press `Enter`: *"Make a 1080×1350 poster for a jazz night on Friday with a bold headline."*
4. Watch the **Canvas** panel update as tool cards appear in the chat. Open the result in any studio with one click.
5. Not right? **Undo last AI run** (Activity panel, chat footer or the bar that appears after a quick action) restores
   the document as it was before the request.

Composer extras: attach images and text files (paperclip), attach a picture of the current page (camera), dictate
(microphone, where the browser supports speech input), the prompt library (recent prompts, saved prompts, templates per
studio), the per-chat **Tools** menu (switch tool groups off for this chat only), the model pill, the approval mode and
the thinking effort. The assistant always knows which layers you have selected, so "make this bigger" works.

## Layout

* **Left**: chats. **Center**: the conversation and the composer. **Right**: only two panels, **Canvas** and
  **Activity**.
* **Models and connections, Tools and MCP, Skills, Knowledge and memory** moved to **Settings ▸ Artificial intelligence**
  (sub-tabs under *Vibe Studio*). Deep link for scripts and extensions:
  `app.run("settings.open", { section: "ai", tab: "models" })` (`tab`: `models`, `tools`, `skills`, `knowledge`). The
  old commands *Show Models and Connections* etc. open the same place.

## Mentions: `@`, `/` and `!`

Type a trigger at the start of the message or after a space; a list opens at the caret (fuzzy search, grouped,
`↑`/`↓`, `Enter`/`Tab` to pick, `Esc` to close, mouse works too). No list opens while an input method (IME) is composing.

| Trigger | Offers | Becomes |
| --- | --- | --- |
| `@` | `@selection`, layers of the active document (by name), project files of the open website / text project, open documents, attachments of this chat, room members | a chip; sent as `[@layer: id name type bounds]`, `[@file: path]` plus an excerpt (up to 8 KB per file, 40 KB per message), `[@document: …]`, `[@attachment: …]`, `[@member: …]` |
| `/` | built-in commands (`/new`, `/undo`, `/clear`, `/stop-all`, `/create-skill`, `/skills`, `/tools`), skills (a form asks for their parameters), recent prompts | commands run at once; a skill becomes a `/skill` chip sent as `[/skill: name args {…}]` |
| `!` | every tool with its description and parameter hint (`!add_shape`, `!query_layers`, …) | a `!tool` chip; sent as `[!tool: name] You MUST call the tool … first` |

Chips sit above the text and are atomic: `Backspace` at the start of the text removes the last one, each chip has a
remove button. Drag a layer from the Canvas outline onto the composer to add it as a chip; dropped files stay
attachments and pasted images keep working. The chips travel in a `[Vibe context]` section at the end of the message
(`app/src/ui/vibe/mentions.js`); the transcript shows them as chips again.

## Reviewing what the AI changed (diffs)

Every mutating tool call is recorded as a change set (before/after snapshots taken under the write lock):

* Tool cards that changed something show **View changes** with a compact badge (`+12 −3` for text, `2 layers` for
  designs).
* At the end of a run a **Changed in this run** card lists the files and layers; **Review changes** opens the diff
  drawer: one tab per file (unified or side-by-side, unchanged stretches folded, **Revert this file** and per change block
  revert), a **Layers** tab with the property changes in words (*Rectangle “Hero”: fill #ffffff → #0a84ff, x 40 → 80*),
  before/after thumbnails, *Select* and *Revert* per layer, and a **Document text** tab with a paragraph diff for Office
  documents. Every revert is one undo step; **Undo this run** is the same as in the Activity panel.
* **Before / after** compares the page before the run with the current page on the Canvas (slider).

Limits: change sets live in memory only (chats loaded later have no diffs); files above 400 KB are listed as too large
(they can still be reverted); pixel layers and binary files show thumbnails or a note only and are reverted with *Undo
this run*; reordering inside a group is reported only as "moved"; documents with more than 5000 layers are compared on
the first 5000.

## Canvas panel

A live preview of the active document: zoom (Fit, 50, 100, 200 %, wheel, `+`/`−`/`0`), pan by dragging or the arrow
keys, a page switcher, a **layers outline** (click to select, eye and lock toggles, `H`/`L` keys, `A` adds the layer to
the composer, drag onto the composer), rings around the layers the AI touched in the last run plus **Touched by AI**
chips, the before/after slider, **Open in …** (split button: Vector, Pixel, Layout, Code, Office), **Export…** and the
document size, pages and layer count. Website projects show the live preview with Desktop / Tablet / Phone widths. The
preview renders only while the panel is visible, debounced and at most 1800 px on the long side.

## Message toolbars

Answers: copy, retry (newest answer), helpful / not helpful (stored on this device only), and **⋯** with copy as
Markdown, retry with another model, read aloud (where the browser has speech synthesis), pin (pinned turns appear in a
strip at the top), save to knowledge (adds the answer to the RAG index), share to the room chat (while in a room),
collapse, branch chat from here and delete. Your messages: copy, edit and resend (continues from that turn), **⋯** with
pin, branch and delete.

## Several chats at once

Chats keep running when you switch to another one or start a new one (pencil button, `/new`, `Ctrl+Alt+N`). The chat
list shows each chat's state: a spinner while it works, a shield with a count when it **waits for your approval** or
answer, a check when it finished in the background, a warning sign when it failed. The header says "2 running · 1
waiting" and offers **Stop all** (the global kill switch; also the command *Stop All AI Tasks* and the Stop button of
the AI pill). Right-click a chat to stop only that chat, pin the current model to it, or give it its own approval mode
(the composer pills then say "(this chat)").

- **Approvals never steal focus.** A background chat that needs approval waits; open it from the list and the approval
  card is there. Other chats keep going meanwhile.
- **Limit**: at most 4 chats run at the same time (Models ▸ Engine). Right-click AI actions count as hidden chats.
- **Same document, several chats**: edits are serialized one tool call at a time with a fair queue, so two chats never
  interleave inside one step; `run_plan` keeps a whole plan together. The canvas follows the chat that is editing.
- **Undo this run** works per chat while that chat's edits are the newest ones in the document. If another chat (or
  you) edited the document afterwards, Vibe explains why it cannot undo and you undo the newer work first (or use
  `Ctrl+Z` step by step). Details: [ADR 0008](adr/0008-vibe-hub.md).
- **AI progress pill**: in every studio a small pill at the bottom says what the AI is doing ("AI is adding shapes…",
  "2 AI tasks running", "AI needs your approval"), with a progress bar, Stop and a click that opens the chat. It is
  hidden while you are in Vibe Studio and only the open chat works.
- Token usage per chat is shown under each answer and in Models ▸ Engine when the provider reports it.

## Sub-agents

For bigger jobs the assistant can delegate focused parts to **sub-agents** (`spawn_agent`): each runs in parallel with
its own context window, only the tools it was given (never more than the chat has), and returns a structured result
(summary, ids of layers and files it touched). They appear nested under the "Spawn agent" card with live status, a
mini transcript of their tool calls and a cancel button, and as "↳ role: tool" entries in the Activity tab. Their
approvals show inside their box in the chat. Limits (Models ▸ Engine): 3 running at once per chat (more queue), 12
steps each, 80 steps per request in total, no agents of agents of agents (depth 2), and an optional cheaper
**Sub-agent model**. Stopping the chat stops its agents. Try it offline: "build a brand kit with three agents" with
the Demo model.

## Chat behavior

- **Tool cards** are one line: icon, title, a one-line summary of the arguments, duration and status (running,
  done, failed, declined, stopped, waiting for approval). Click a card for formatted, collapsible arguments and
  result with copy buttons; image results (for example `screenshot`) show clickable thumbnails. Consecutive calls
  collapse into one group ("Using 3 tools…" while they run, "Used 4 tools" afterwards); a group opens by itself when a
  call needs approval or fails. Approvals appear inside the card of the call.
- **Thinking** blocks are collapsible and show the elapsed seconds; running titles and the "Thinking…" indicator use a
  text shimmer that is switched off by Settings ▸ Reduce motion.
- **Auto-scroll** follows the newest content while Vibe streams. Scroll up and it stops; a "Jump to latest" pill brings
  you back (sending a message also resumes following).
- Message **Copy** buttons, **Retry** (sends the last message again as a new message), a Stop button that shows the
  OpenFini mark while a run is active, and a composer that grows up to 40% of the panel height.

## Activity tab

A live log of the current chat, kept while you switch tabs (it is not saved with the chat and is cleared when you open
another chat). Each request is a run with its plan, tool calls (timing, result, files and layers touched), approvals
and your decision, errors and retries, token usage when the provider reports it, and the total duration. Filter with
**All / Changes / Errors**; click a file or layer chip to open the file in the Code studio or select the layer;
**Copy log** copies plain text; **Clear** empties the log (it does not undo anything).
**Undo this run** is offered where a run edited a document. Undo is a stack: only the newest run is undone directly,
older runs show **Undo back to here**, which undoes the newer runs first. Runs that changed nothing, or whose changes
were undone already, say so. "Changes" is a name heuristic (tools that only read are excluded).

## Connecting a model

You are never locked in. Under **Models**, *Add* a connection and pick a preset, or enter any OpenAI-compatible base
URL:

| Preset | Notes |
| --- | --- |
| OpenRouter | One key, hundreds of models. *Sign in with OpenRouter* (web build) creates a key through OAuth with PKCE. |
| OpenAI | API key (key page link, *Save and test*, optional `OpenAI-Organization` / `OpenAI-Project` headers in *Extra headers*). Image generation and editing via the Images API. |
| OpenAI account (ChatGPT plan, desktop) | *Sign in with OpenAI*: uses your ChatGPT plan instead of an API key through OpenAI's documented preview for open-source apps. Desktop app only; Responses API without images or embeddings. See [openai-account-auth.md](openai-account-auth.md). |
| Anthropic (Claude) | API key; native Messages API with tool use and extended thinking. |
| DeepSeek, xAI (Grok), Mistral, Groq, Together AI, Google Gemini (OpenAI-compatible endpoint) | API key, OpenAI-compatible. |
| Ollama, LM Studio (local) | No key; runs on your machine. The server must allow the app's origin (for Ollama: `OLLAMA_ORIGINS`). |
| OpenCode Zen | API key from opencode.ai/auth. OpenAI-compatible gateway, see [OpenCode](#opencode). |
| OpenCode (local server, experimental) | Your own `opencode serve`. See [OpenCode](#opencode). |
| Custom | Any OpenAI-compatible `/v1` server (llama.cpp, vLLM, a company gateway …), or an Anthropic-compatible one: choose the *API type* and add extra headers (one `Name: value` per line) in the connection form. If the server has no model list, type the model id in the model picker. |

Keys are stored **on this device only** and are sent only to the base URL you entered. You can protect them with a
passphrase (*Models ▸ Key protection*): they are then encrypted with AES-GCM (key derived with PBKDF2, 250 000
iterations) and must be unlocked once per session.

**Honest limits.** OpenFini can use a ChatGPT plan only through OpenAI's documented "plan usage" preview (desktop app, see the OpenAI account row above); it never reuses the Codex CLI's credentials or ChatGPT's private endpoints. Claude.ai offers no login for third-party apps, only API keys (billed separately). Tool calling and image input depend on the model; the
model list shows what each model reports. Real providers could not be exercised in CI without keys: the engine is
tested against recorded protocol fixtures and fake servers.

### Fallback chain (model routing)

*Settings ▸ Artificial intelligence ▸ Models ▸ Fallback chain.* The model you pick in the model menu is always the
**primary**. Add fallbacks below it (drag or use the arrows to reorder, switch single targets off, give a target its own
first-answer timeout) and turn the chain **On**. When the primary does not answer because of a rate limit, overload,
timeout (no first token within 45 s by default), network error, unavailable model or context-length limit, Vibe retries
it (default once, with growing pauses) and then moves to the next target. You see a small notice in the chat ("Switched
to Claude Haiku after a timeout."), an entry in the **Activity** log, and the progress pill says it is switching.

- **What is never hidden:** wrong or expired keys (authentication) and invalid requests are shown as errors, not routed
  around, unless you tick *Also fall back on authentication errors*.
- **Cut-off answers:** if text was already shown, the fallback continues from it; nothing is written twice.
- **Compatibility:** targets without tool support are skipped when tools are needed, targets without vision when
  images are attached, and context-length errors only move to a model with a larger known window.
- **Circuit breaker:** after 3 failures in a row a target rests for 60 s and is skipped.
- **Sub-agents, quick actions and background runs** use the chain too (switch off with *Use the fallback chain for
  sub-agents…*). **Per chat:** *Use fallback chain in this chat* in the model menu; a "↪" on the model pill marks an
  active chain.
- **Presets:** *Same provider, smaller model*, *Fast & cheap fallback* (another connection), *Local model as last resort
  (Ollama)*; a preset that needs a missing connection says so.
- **Test route** sends a tiny request to every target and shows latency or the error category. Each target shows its
  recent success rate (counts only, stored on this device; no prompts). After repeated failures with no fallback Vibe
  suggests adding one.
- **Health check:** every connection has a *Test* button (latency, model count, last error, green/red dot).
- The assistant can read and change the chain with `get_model_route` / `set_model_route` (the latter asks first).

### OpenCode

[OpenCode](https://opencode.ai) is an open-source AI coding agent with a terminal UI and a client/server design. Verified
against the official docs and live requests on 2026-10-27; what OpenFini does with it:

1. **OpenCode Zen** (real, recommended). Zen is OpenCode's pay-as-you-go model gateway. Preset *OpenCode Zen*: base URL
   `https://opencode.ai/zen/v1` (OpenAI-compatible Chat Completions; `GET /models` returns the public model list), key from
   <https://opencode.ai/auth>. Model ids have no vendor prefix (`claude-sonnet-5-5`, `gpt-5.4-mini`, `glm-5.3-flash` …).
   The docs also list `https://opencode.ai/inference/...` paths; the same `GET /models` answers on both. The `/models`
   response has no pricing or capability metadata (only id and `owned_by`), so those come from the preset. Free models
   "work only through OpenCode, not other clients": requests for them from other clients returned
   `429 FreeUsageLimitError` in our test. **Browser limit:** `GET /models` sends `Access-Control-Allow-Origin: *`, but the
   CORS preflight (`OPTIONS`) for `POST /zen/v1/chat/completions` returned 404 without CORS headers in our check, so a
   page-origin `fetch` for chat requests will probably be blocked in the PWA (and in any webview that enforces CORS).
   The *Test* button therefore may show a network error even though the key is valid; use a CORS-capable gateway
   (OpenRouter is one) if this applies to you. Not verified: a real chat request with a paid key.
2. **OpenCode (local server, experimental).** Start `opencode serve --port 4096 --cors <origin of this app>` (flags
   verified in the docs; default host `127.0.0.1`, port `4096`; if you set `OPENCODE_SERVER_PASSWORD`, put the password in
   the key field, user name `opencode`). OpenFini uses only documented endpoints: `GET /global/health`,
   `GET /config/providers`, `POST /session`, `POST /session/:id/message` (waits for the full answer), `POST
   /session/:id/abort`, `DELETE /session/:id`. Model ids are written `providerID/modelID`. **Honest limits:** the answer
   arrives as one message, not token by token, because the server-sent-event schema is not documented and the adapter
   does not guess it; OpenCode runs its own tools in its own project, **OpenFini's tools and screenshots are not
   available** to it; only the shape of the `POST /message` request and `{info, parts}` response is documented, the shape
   of `GET /config/providers` is not (parsed leniently; if no models are found, type the id). The adapter is tested
   against a fake server built from the docs, **not against a real OpenCode binary**. Not implemented: streaming via
   `GET /event`, permission prompts (`/session/:id/permissions/:id`), session reuse.
3. **Import `opencode.json`.** *Connections ▸ Import opencode.json* reads a file you choose (`opencode.json` / `.jsonc`,
   comments and trailing commas allowed) and offers to create connections from its `provider` entries (`options.baseURL`,
   model ids and `limit.context`, safe headers). Built-in provider ids (`anthropic`, `openai`, `openrouter`, `google`,
   `deepseek`, `xai`, `groq`, `mistral`, `togetherai`, `opencode`) map to the matching presets. **Keys are never read**:
   `apiKey`, `{env:VAR}` and `{file:path}` values and authorization headers are dropped, and `~/.local/share/opencode/auth.json`
   is never touched; you paste the key afterwards. Providers using other SDKs (for example Bedrock) are listed as skipped.

Sources: opencode.ai/docs/server, /docs/sdk, /docs/zen, /docs/providers.

## What the assistant can do (100 tools)

*Tools* ▸ lists them all; you can switch off any single tool.

- **Documents**: new document, document info, `get_save_target` (which file type Save would write and why), studio switch, undo and redo, pages.
- **Layers and vector**: list layers, selection, screenshots, shapes, text, paths, SVG import, styles, transforms,
  grouping, ordering, alignment, boolean operations, duplicate, delete.
- **Pixel**: effect catalog, pixel layers, adjustment and live filter layers, selections, image generation and image
  editing with the image model you configure, the image operations `crop_image` (rectangle or ratio, optional straighten angle), `resize_image` (with resampling), `rotate_image` and `trim_edges` (transparent or solid margins, crop to selection, reveal all), plus the read-only `get_histogram` (statistics, 64-bin data and a
  plain-language assessment) and `auto_correct_suggestion` (ready-made Levels / Curves / Exposure parameters); see the
  [Histogram guide](pixel-histogram.md).
- **Git and publishing**: `git_init`, `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`, `git_restore`,
  `git_push`, `git_pull`, `list_publish_targets`, `add_publish_target`, `preflight_site`, `publish_site` (pushes and publishing ask for
  approval; tokens are never shared with the assistant; see [git-and-publishing.md](git-and-publishing.md)).
- **Frameworks, libraries and documents**: `list_templates`, `list_libraries`, `search_packages` and `add_library` (network, ask first), `render_markdown`, `convert_latex_preview`, `create_markdown_document`.
- **Code and websites**: create a website from a template, read, write, edit, rename and delete files, page outline,
  element inspection and insertion, class-based style edits with breakpoints, page meta, problem check. View controls:
  `set_viewport` (pixel-exact width/height or a device preset), `get_viewport` (size, active breakpoint, markers; read-only),
  `measure_element` (box model in px, mm, cm, in, pt, rem, em or %; read-only) and `set_code_layout` (code left, right, above or below the preview).
  `format_file` formats a file (or a line range) with the built-in HTML, CSS, JavaScript, JSON and Markdown formatters without changing what renders; `get_viewport` also reports the layout width and scrollbar width.
- **System and files**: `get_platform_info` (OS, desktop or browser, version, which file types OpenFini opens and how to
  make it the default) and `list_recent_files`, both read-only.
- **Customization**: `get_settings`, `set_setting`, `list_shortcuts`, `set_shortcut` (approval), `export_profile` (settings and shortcuts only, never secrets; see [customization.md](customization.md)).
- **Appearance and help**: `list_themes`, `set_theme` (theme, mode and accent of the interface), `start_tour` and
  `list_commands` (every command that can run now, with its shortcut; the assistant can tell you where things are but
  cannot run commands itself). The built-in skill `help-me-use-openfini` ties them together.
- **Diagnostics and security**: `get_app_logs` (redacted, filterable), `get_diagnostics` (environment and grouped problems) and
  `get_security_status`, all read-only; the assistant should call them only when you ask about errors or your setup
  (see [troubleshooting](troubleshooting.md), [security](security.md)). Offline mode blocks provider and MCP requests.
- **File formats**: `list_supported_formats` (verdict and best conversion route per format, see [file-format-research.md](file-format-research.md)), `import_palette_from_text` (GPL text or hex colors into the swatches) and `export_palette` (swatches as GPL text).
- **Imported documents**: `get_import_report` (what an import kept, flattened or dropped), `list_pdf_pages`, `describe_document_pages` and `extract_pdf_text` (page text in reading order, for summarizing or translating a PDF). The assistant has no file access: attach a PDF, AI, PSD, IDML or Sketch file in the composer; the assistant opens it with `open_attachment` (or click *Open as document* on the chip). See [pdf-import.md](pdf-import.md).
- **Tables and charts**: `add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart` build and edit real table / chart objects (formulas, merges, number formats, sorting, charts linked to a table). The built-in skill `report-with-charts` assembles a report page. See [layout-tables-charts.md](layout-tables-charts.md).
- **Office suite**: `office_formats`, `office_list_documents`, `office_describe` (read-only, kind-aware) and `office_new` (any registered kind and template); `office_export` exports any kind. See [office-suite.md](office-suite.md#vibe).
- **Office documents**: `office_new_document`, `office_read_document`, `office_find` (read-only), `office_insert_blocks` (Markdown or typed blocks), `office_replace_text`, `office_set_style`, `office_apply_format`, `office_insert_table`, `office_set_page_setup` and `office_export` (asks first; a save dialog opens) write and format Word-style documents in the Office Studio, one undo step per call. The built-in skill `write-business-document` covers letters, reports, proposals, memos and resumes. See [office-studio.md](office-studio.md).
- **Extensions**: list installed extensions, run an extension command, install an extension from a URL (you confirm its permissions), and write a small local extension from a description (`create_extension`). Tools that extensions add appear as `ext_<id>_<tool>`, always ask for approval and show their origin; see [extensions.md](extensions.md).
- **VS Code extensions**: `search_vscode_extensions` (Open VSX, asks first), `install_vscode_extension` (you confirm in the install dialog, which shows its compatibility), `list_vscode_extensions` and `describe_vscode_extension` (read-only compatibility report); see [vscode-extensions.md](vscode-extensions.md).
- **Text and encoding**: `encode_text`, `decode_text` (pure transforms: HTML entities, JS, CSS, percent, code points) and `transform_file_text` (apply a named transform to project files; more than one file needs approval).
- **Assistant**: knowledge search (RAG), remember, use a skill (with arguments and reference files), save a skill
  draft (`create_skill`), ask you a question, update the visible plan, create a tool.
- **Power tools** (fewer round trips, more detail): `run_plan` (an ordered list of tool calls in one turn with
  `{"$ref": "step.path"}` references between steps, stop-on-error, one approval listing every step, one undo step),
  `query_layers` (selector such as `rect[name^="Card"][w>100]` or attributes: type, name glob, fill, text, within,
  intersects, parent; paged with limit/offset and `fields`), `describe_page` / `describe_selection` (plain-language
  summary plus a compact scene text, about 4-6x smaller than `list_layers` JSON; pass `since` to get "unchanged"),
  `apply_to_many` (set_style / transform for every match, one undo step), `evaluate` (sandboxed JavaScript for math,
  colors and grids; no network; may call read-only tools), `screenshot_layers` (isolated render, `lowRes`),
  `compare_screenshots` (save, then before/after), `grid_layout`, `distribute_layers`, `snap_layers`, `make_component`
  (group + copies with overrides by child name). Error messages include valid values and the nearest tool names.
- **Agents**: `spawn_agent`, `wait_agent`, `list_agents`, `cancel_agent` (see Sub-agents).
- **Attachments**: `list_attachments` and `open_attachment` open a file you attached in this chat as a new document
  through the same importers as File ▸ Open (images in Pixel, SVG in Vector, PDF and Illustrator in Layout with the
  default import options, PSD, IDML, Sketch, text and code files in Code). Opening asks for approval only in Careful
  mode. Attachments are kept in memory for the session; after a restart attach the file again.
- **Comments** (`tools/comments.js`, work without a room, saved in the document): `list_comments` and `get_comment_context` (read-only;
  every thread comes with the exact target: layer id/name/type/bounds, code file + lines + excerpt, website element + HTML, Office
  paragraph + quote; the context adds a cropped screenshot or surrounding lines), `add_comment`, `reply_comment`, `resolve_comment`.
  Replies are signed "Vibe (AI)". Add/reply ask only while the user is in a room; resolve asks in Careful mode like any write.
  The built-in skill `address-comments` goes through the open comments, makes the precise edit, replies and resolves. In the
  composer `@comments` adds the open comments as context; the thread popover and the Comments panel have **Resolve with AI**
  (`vibe/quick-actions.js`, needs AI enabled). The Demo provider replies honestly that it cannot decide the edit.
- **Collaboration**: `get_collab_status`, `read_chat`, `list_versions`, `get_sharing_status`, `list_shared_documents` (read-only),
  `save_version`, and, with approval because they reach other people, `post_chat_message` and `share_document`. Never exposes invite codes or keys. See
  [collaboration.md](collaboration.md).

Inside Vibe Studio the assistant does not switch studios behind your back; the Canvas panel shows the document and
offers buttons to open it in a studio. (Website editing builds the Code studio's editor in the background.)

## Permissions

| Mode | Behavior |
| --- | --- |
| **Careful** | Asks before every tool that changes something. |
| **Balanced** (default) | Reads and edits your document freely; asks before risky actions (deleting files, overwriting, running custom tools or MCP tools). |
| **Auto** | Runs everything except custom tools it just wrote and MCP tools, which still ask. |

Any tool can be set to *Always allow*. The approval card shows the exact arguments. Whatever the mode, the assistant
only touches OpenFini documents: it has no access to your files, shell or network except through the connections and
MCP servers you add.

## Language

Replies follow the interface language (Settings ▸ General ▸ Language) unless you write in another language. The built-in skills,
tool descriptions and system instructions stay English: they are instructions to the model, not UI text. See [i18n.md](i18n.md).

## Skills

A skill is a Markdown file (`SKILL.md` style): a name, a description, optional `allowed-tools`, parameters and
instructions. The assistant sees only the catalog and loads a skill when a task matches (the `use_skill` tool), so
skills cost almost no context. 26 are built in, including workflow skills for design systems, responsive sites from a
brief, photo compositing, icon sets, presentations, print brochures, social campaign kits, mobile UI mockups, data
reports, code refactoring, SEO, accessibility fixes, localization, brands from a logo, CSS animation and
`multi-agent-project-lead` (how to split work across sub-agents).

- `/skill-name` starts a skill; skills with parameters open a small form. A chip suggests a matching skill while you type.
- Skills can require other skills, load reference files on demand, be limited to studios, and (with
  `enforce-tools: true`) restrict the assistant to their tools while active.
- *Skills* panel: search, tag filters, source badges (built-in, yours, extension, draft), usage stats, an editor with
  live preview and validation, *Customize* for built-ins, import/export of `.skill.md` and `.skillpack` bundles,
  *Test* with the Demo model, and *Create from this chat* (`/create-skill`), which saves a draft for you to review.

Format reference and authoring guide with examples: [vibe-skills.md](vibe-skills.md).

## Knowledge (RAG)

Add brand guides, copy decks, specs or notes under *Knowledge*. Files are chunked and indexed on this device with
BM25; if you select an embedding model, dense vectors are added and results are blended. Your open website project is
indexed automatically. The assistant searches with `search_knowledge`; you can test a query yourself in the panel.

## MCP servers and your own tools

- **MCP**: add the URL of an MCP server that speaks *Streamable HTTP* (*Tools ▸ MCP servers*). Its tools appear with an
  `mcp_` prefix and always ask first in Balanced mode. Authentication: a bearer token you paste, or **Sign in** (OAuth per the MCP
  authorization spec: discovery, dynamic registration, PKCE, automatic refresh; desktop uses a one-shot loopback callback, the web
  build a redirect back to the app). **Sign out** revokes and removes the stored tokens. Servers that do not advertise PKCE S256 are refused.
- **stdio servers** (most community servers) are programs, not URLs. Use the bundled gateway to expose one on
  `127.0.0.1`:

  ```bash
  npm run mcp:gateway -- --port 3939 -- npx -y @modelcontextprotocol/server-filesystem ~/Documents
  ```

  then add `http://127.0.0.1:3939/mcp`. The gateway only listens on localhost, accepts browser requests only from
  localhost, the hosted app and the desktop app (add more with `--origin`), and can require `--token`.
- **Your own tools**: describe a function ("a tool that makes N social-media sizes from the selected layer") and the
  assistant can write it with `create_tool`, or write one yourself under *Tools ▸ New tool*. Custom tools are small
  JavaScript functions that run in a sandboxed frame without network or DOM access to the app; they call OpenFini only
  through `openfini.call(name, args)`, which passes through the same approvals. They ask before each run.

## Right-click AI

With AI enabled, context menus get an **AI** submenu:

- **Canvas** (selection aware): describe, restyle, create variations, tidy up layout, name layers, rewrite text, fix
  spelling and grammar, translate, generate an image here, edit with AI (Pixel), auto-enhance a photo, check contrast
  and accessibility.
- **Code editor** (selected code): explain, fix problems, refactor, add comments, generate code here.
- **Website elements**: improve copy, make responsive, restyle, add hover and focus states.

Quick actions run the same agent with the same tools and permissions. Changes can be undone with the bar that
appears afterwards, or with `Ctrl+Z`.

## Privacy and safety

- Nothing is sent anywhere unless AI features are on **and** you chose a non-Demo model. Your prompt, attached files,
  screenshots of your pages (switch off *Send screenshots* in Tools settings), memory notes and tool results go to
  the provider you chose, under that provider's terms.
- Chats, memory, skills, knowledge and keys are stored locally (IndexedDB / the app's storage). *Settings ▸ Artificial
  intelligence ▸ Delete all AI data* removes them.
- Text that comes from outside (web pages in tool results, MCP responses, attached files, text on a canvas) is
  **data, not instructions**. The system prompt says so, and risky actions need your approval, but no model is immune
  to prompt injection: keep Balanced or Careful mode when working with content you do not trust.
- The desktop app's Content-Security-Policy allows `connect-src` to `https:` (provider APIs) and localhost
  (local models and the MCP gateway). See [SECURITY.md](../SECURITY.md).

## Architecture

| Part | Location |
| --- | --- |
| Pure AI runtime (providers, agent loop, MCP, RAG, skills, vault) | `app/src/ai/` — see [ai-engine.md](ai-engine.md) |
| OpenFini tools (130) | `app/src/vibe/tools/` (power tools `power.js`, agents `agents.js`, attachments `attachments.js`) |
| Hub (many chats, shared services, write lock), chat session | `app/src/vibe/hub.js`, `app/src/vibe/session.js` |
| Write lock, run undo, sub-agent engine, query/ref/scene helpers (pure) | `app/src/vibe/locks.js`, `run-undo.js`, `agents.js`, `query.js` |
| Store, custom tools, quick actions, OAuth return | `app/src/vibe/` |
| Studio UI | `app/src/ui/vibe/` (chat list `chat-list.js`, skills `panel-skills.js`, settings host `settings-ai.js`), `app/styles/vibe.css`, `app/styles/vibe-engine.css`, `app/styles/vibe-ui.css` |
| Mentions and composer | pure `mentions.js` (trigger detection, fuzzy ranking, context blocks), UI `composer-mentions.js`, toolbars `message-actions.js` |
| Change sets and diffs | pure `changes.js` (snapshots, layer/file/paragraph diffs, per-hunk revert), recorder `change-recorder.js` (hooked via `hub.changeProbe` in `VibeSession#wrap`), drawer `diff-view.js` |
| Canvas panel | `panel-canvas.js` (preview, outline, rings, before/after) |
| AI progress pill | `app/src/ui/ai-pill.js`, wording in `app/src/ui/vibe/activity-label.js` |
| Model routing | pure `app/src/ai/routing.js`; glue `vibe/routing-glue.js`, presets `vibe/route-presets.js`, tools `vibe/tools/routing.js`, editor `ui/vibe/panel-routes.js` ([ADR 0014](adr/0014-model-routing-fallback.md)) |
| OpenCode | `app/src/ai/providers/opencode.js` (importer + experimental server adapter) |
| MCP gateway | `scripts/mcp-gateway.mjs` |

**How it fits together.** `getVibeHub(app)` creates the hub on first use. The workspace binds the UI to `hub.view`, a
`SessionView` that forwards the events of the active chat (`chat`, `message`, `event`, `approval`, `ask`, `plan`,
`notice`, `done`, `error`, `status`, `runs`) and replays a running chat when you switch to it. Each `VibeSession` builds
its tools per request and wraps them: skill restriction, then the write lock (mutating calls), document affinity and
the history tag `{ chat, run }`. `send()` runs `runAgent` with an `AgentManager` for sub-agents. Design decisions:
[ADR 0008](adr/0008-vibe-hub.md).

**How to extend.** New tools: a `(app, ctx) => Tool[]` module in `app/src/vibe/tools/`, registered in `tools/index.js`
and listed in `TOOL_GROUPS`; mark pure reads `readOnly: true` (they run in parallel and without the lock) and set
`exclusive: true` for reads that must not overlap writes. Session services for tools are on `ctx` (`lookup`, `policy`,
`allowed`, `agents`, `attachments`, `snapshots`, `useSkill`). New Demo scenarios: `planForPrompt` in
`app/src/ai/providers/mock.js`.

The UI's only hook into the engine is `hub.changeProbe` (optional): `VibeSession#wrap` calls
`changeProbe.before({ session, id, name, input, doc, run })` after taking the lock and `probe.after(app.doc)` when a
mutating call ends; failures there never fail a tool call.

**Testing.** `tests/ui/vibe-mentions.test.js` and `tests/ui/vibe-changes.test.js` cover the pure composer and diff
builders. `tests/ai/` (runtime, gateway, skills v2, and a contract test that checks the demo assistant, the skills
and the tool groups against the real tool registry) and `tests/vibe/` (write lock fairness, tag-based undo, queries,
run_plan refs, scene text, sub-agent budgets/depth/tool restriction, and engine tests that run the real hub with the
Demo provider against real documents: concurrent chats, background approvals, limits, kill switch, three-agent brand
kit, skill arguments and enforcement, attachments).
