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
`/clear`, `/<skill>`), choose the approval mode and the thinking effort. The assistant always knows which layers you
have selected, so "make this bigger" works.

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
| Custom | Any OpenAI-compatible `/v1` server (llama.cpp, vLLM, a company gateway …). |

Keys are stored **on this device only** and are sent only to the base URL you entered. You can protect them with a
passphrase (*Models ▸ Key protection*): they are then encrypted with AES-GCM (key derived with PBKDF2, 250 000
iterations) and must be unlocked once per session.

**Honest limits.** OpenFini cannot log in with a ChatGPT or Claude.ai *subscription*: those products do not offer a
login for third-party apps, only API keys (billed separately). Tool calling and image input depend on the model; the
model list shows what each model reports. Real providers could not be exercised in CI without keys: the engine is
tested against recorded protocol fixtures and fake servers.

## What the assistant can do (100 tools)

*Tools* ▸ lists them all; you can switch off any single tool.

- **Documents**: new document, document info, studio switch, undo and redo, pages.
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
- **Appearance and help**: `list_themes`, `set_theme` (theme, mode and accent of the interface), `start_tour` and
  `list_commands` (every command that can run now, with its shortcut; the assistant can tell you where things are but
  cannot run commands itself). The built-in skill `help-me-use-openfini` ties them together.
- **Diagnostics and security**: `get_app_logs` (redacted, filterable), `get_diagnostics` (environment and grouped problems) and
  `get_security_status`, all read-only; the assistant should call them only when you ask about errors or your setup
  (see [troubleshooting](troubleshooting.md), [security](security.md)). Offline mode blocks provider and MCP requests.
- **Imported documents**: `get_import_report` (what an import kept, flattened or dropped), `list_pdf_pages`, `describe_document_pages` and `extract_pdf_text` (page text in reading order, for summarizing or translating a PDF). The assistant has no file access: attach a PDF, AI, PSD, IDML or Sketch file in the composer and click *Open as document* on the chip first. See [pdf-import.md](pdf-import.md).
- **Tables and charts**: `add_table`, `edit_table`, `read_table`, `list_tables`, `import_csv_to_table`, `add_chart`, `edit_chart`, `read_chart` build and edit real table / chart objects (formulas, merges, number formats, sorting, charts linked to a table). The built-in skill `report-with-charts` assembles a report page. See [layout-tables-charts.md](layout-tables-charts.md).
- **Office documents**: `office_new_document`, `office_read_document`, `office_find` (read-only), `office_insert_blocks` (Markdown or typed blocks), `office_replace_text`, `office_set_style`, `office_apply_format`, `office_insert_table`, `office_set_page_setup` and `office_export` (asks first; a save dialog opens) write and format Word-style documents in the Office Studio, one undo step per call. The built-in skill `write-business-document` covers letters, reports, proposals, memos and resumes. See [office-studio.md](office-studio.md).
- **Extensions**: list installed extensions, run an extension command, install an extension from a URL (you confirm its permissions), and write a small local extension from a description (`create_extension`). Tools that extensions add appear as `ext_<id>_<tool>`, always ask for approval and show their origin; see [extensions.md](extensions.md).
- **Assistant**: knowledge search (RAG), remember, use a skill, ask you a question, update the visible plan, create a
  tool.

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

## Skills

A skill is a Markdown file (`SKILL.md` style): a name, a description, optional `allowed-tools`, and instructions. The
assistant sees only the catalog and loads a skill when a task matches (the `use_skill` tool), so skills cost almost
no context. Nine are built in (`help-me-use-openfini` and `logo-design`, `social-post`, `photo-retouch`, `landing-page`, `poster-layout`, `brand-kit`,
`accessibility-audit`, `copywriting`). Create your own under *Skills ▸ New* or import a `.md` file.

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
| OpenFini tools (100) | `app/src/vibe/tools/` |
| Session, store, custom tools, quick actions, OAuth return | `app/src/vibe/` |
| Studio UI | `app/src/ui/vibe/`, `app/styles/vibe.css` |
| MCP gateway | `scripts/mcp-gateway.mjs` |

Tests: `tests/ai/` (runtime, gateway, and a contract test that checks the demo assistant, the skills and the tool
groups against the real tool registry).
