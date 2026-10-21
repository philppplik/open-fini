# Vibe Studio

Vibe Studio is OpenFini's AI studio (`Alt+5`). You describe what you want; an assistant uses OpenFini's own tools to
make it: shapes and text in the Vector studio, adjustments in the Pixel studio, pages in the Layout studio, whole
websites in the Code studio. There is no separate "AI document": everything the assistant makes is a normal OpenFini
document you can keep editing, and every run can be undone in one click.

> **Off by default.** AI features are a master switch under *Settings ▸ Artificial intelligence*. While it is off,
> nothing leaves your device and no AI menu items appear. The offline **Demo** assistant works without it.

## Quick tour

1. Open Vibe Studio (`Alt+5` or the Vibe button in the header).
2. Pick a model in the composer, or add your own connection under **Models** (see below). The built-in **Demo
   (offline)** assistant needs no key and shows how the studio works: it follows a small script of real tool calls.
3. Type what you want and press `Enter`: *"Make a 1080×1350 poster for a jazz night on Friday with a bold headline."*
4. Watch the **Canvas** panel update as tool cards appear in the chat. Open the result in any studio with one click.
5. Not right? **Undo last AI run** (Activity panel, chat footer or the bar that appears after a quick action) restores
   the document as it was before the request.

Composer extras: attach images and text files (paperclip), start a skill or command with `/` (`/new`, `/undo`,
`/stop-all`, `/create-skill`, `/<skill>`), choose the approval mode and the thinking effort. The assistant always knows which layers you
have selected, so "make this bigger" works.

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
| OpenAI | API key. Image generation and editing via the Images API. |
| Anthropic (Claude) | API key; native Messages API with tool use and extended thinking. |
| DeepSeek, xAI (Grok), Mistral, Groq, Together AI, Google Gemini (OpenAI-compatible endpoint) | API key, OpenAI-compatible. |
| Ollama, LM Studio (local) | No key; runs on your machine. The server must allow the app's origin (for Ollama: `OLLAMA_ORIGINS`). |
| Custom | Any OpenAI-compatible `/v1` server (llama.cpp, vLLM, a company gateway …), or an Anthropic-compatible one: choose the *API type* and add extra headers (one `Name: value` per line) in the connection form. If the server has no model list, type the model id in the model picker. |

Keys are stored **on this device only** and are sent only to the base URL you entered. You can protect them with a
passphrase (*Models ▸ Key protection*): they are then encrypted with AES-GCM (key derived with PBKDF2, 250 000
iterations) and must be unlocked once per session.

**Honest limits.** OpenFini cannot log in with a ChatGPT or Claude.ai *subscription*: those products do not offer a
login for third-party apps, only API keys (billed separately). Tool calling and image input depend on the model; the
model list shows what each model reports. Real providers could not be exercised in CI without keys: the engine is
tested against recorded protocol fixtures and fake servers.

## What the assistant can do (100 tools)

*Tools* ▸ lists them all; you can switch off any single tool.

- **Documents**: new document, document info, `get_save_target` (which file type Save would write and why), studio switch, undo and redo, pages.
- **Layers and vector**: list layers, selection, screenshots, shapes, text, paths, SVG import, styles, transforms,
  grouping, ordering, alignment, boolean operations, duplicate, delete.
- **Pixel**: effect catalog, pixel layers, adjustment and live filter layers, selections, image generation and image
  editing with the image model you configure, plus the read-only `get_histogram` (statistics, 64-bin data and a
  plain-language assessment) and `auto_correct_suggestion` (ready-made Levels / Curves / Exposure parameters); see the
  [Histogram guide](pixel-histogram.md).
- **Git and publishing**: `git_init`, `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`, `git_restore`,
  `git_push`, `git_pull`, `list_publish_targets`, `add_publish_target`, `preflight_site`, `publish_site` (pushes and publishing ask for
  approval; tokens are never shared with the assistant; see [git-and-publishing.md](git-and-publishing.md)).
- **Frameworks, libraries and documents**: `list_templates`, `list_libraries`, `search_packages` and `add_library` (network, ask first), `render_markdown`, `convert_latex_preview`, `create_markdown_document`.
- **Code and websites**: create a website from a template, read, write, edit, rename and delete files, page outline,
  element inspection and insertion, class-based style edits with breakpoints, page meta, problem check.
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
- **Office documents**: `office_new_document`, `office_read_document`, `office_find` (read-only), `office_insert_blocks` (Markdown or typed blocks), `office_replace_text`, `office_set_style`, `office_apply_format`, `office_insert_table`, `office_set_page_setup` and `office_export` (asks first; a save dialog opens) write and format Word-style documents in the Office Studio, one undo step per call. The built-in skill `write-business-document` covers letters, reports, proposals, memos and resumes. See [office-studio.md](office-studio.md).
- **Extensions**: list installed extensions, run an extension command, install an extension from a URL (you confirm its permissions), and write a small local extension from a description (`create_extension`). Tools that extensions add appear as `ext_<id>_<tool>`, always ask for approval and show their origin; see [extensions.md](extensions.md).
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
  `mcp_` prefix and always ask first in Balanced mode. Only bearer-token headers are supported for authentication.
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
| Studio UI | `app/src/ui/vibe/` (chat list `chat-list.js`, skills `panel-skills.js`), `app/styles/vibe.css`, `app/styles/vibe-engine.css` |
| AI progress pill | `app/src/ui/ai-pill.js`, wording in `app/src/ui/vibe/activity-label.js` |
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

**Testing.** `tests/ai/` (runtime, gateway, skills v2, and a contract test that checks the demo assistant, the skills
and the tool groups against the real tool registry) and `tests/vibe/` (write lock fairness, tag-based undo, queries,
run_plan refs, scene text, sub-agent budgets/depth/tool restriction, and engine tests that run the real hub with the
Demo provider against real documents: concurrent chats, background approvals, limits, kill switch, three-agent brand
kit, skill arguments and enforcement, attachments).
