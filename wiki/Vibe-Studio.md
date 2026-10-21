# Vibe Studio

Vibe Studio is OpenFini's AI studio (`Alt+5`). You describe what you want and an assistant uses OpenFini's own tools to make it: shapes and text in the Vector studio, adjustments in the Pixel studio, pages in the Layout studio, websites in the Code studio. Everything it makes is a normal document you can keep editing, and each run can be undone in one click. AI features are **off by default**; while the master switch is off nothing leaves your device.

## Turn it on

1. *Settings ▸ Artificial intelligence*: switch AI features on.
2. Open Vibe (`Alt+5`). The built-in **Demo (offline)** assistant needs no key and follows a small script of real tool calls, so you can try the studio first.
3. To use a real model, add a connection under **Models** ([[Vibe Providers and Permissions]]).

## A first request

Type "Make a 1080x1350 poster for a jazz night on Friday with a bold headline." and press `Enter`. Tool cards appear in the chat while the **Canvas** panel updates. Not right? **Undo last AI run** (Activity panel, chat footer or the bar after a quick action) restores the document as it was before the request.

Composer extras: attach images and text files (paperclip), start a skill or command with `/` (`/new`, `/undo`, `/stop-all`, `/create-skill`, `/<skill>`), choose the approval mode and thinking effort. The assistant knows which layers you have selected, so "make this bigger" works.

## Panels

| Panel | Purpose |
| --- | --- |
| Chat and Canvas | The conversation and a live view of the document |
| Activity | Log of runs: plan, tool calls, approvals, errors, token use; filter All, Changes or Errors; undo per run |
| Models | Connections, key protection, engine settings (parallel chats, sub-agents) |
| Tools | Every tool, with per-tool switches; MCP servers; custom tools |
| Skills | Built-in, your own, extension and draft skills ([[Skills Authoring]]) |
| Knowledge | Documents indexed for retrieval ([[MCP and Knowledge]]) |

## Several chats and sub-agents

Chats keep running when you switch away. The chat list shows a spinner (working), a shield with a count (waiting for approval or an answer), a check (finished in the background) or a warning sign (failed). At most four chats run at once. **Stop all** is the global kill switch (also the command *Stop All AI Tasks*). Edits to one document are serialized one tool call at a time with a fair queue; **Undo this run** works per chat while that chat's edits are the newest in the document.

For bigger jobs the assistant can start **sub-agents** (`spawn_agent`): parallel child runs with their own context and only the tools they were given. Limits: three at a time per chat, 12 steps each, 80 steps per request, depth 2. Stopping the chat stops its agents.

An *AI is ...* **progress pill** in every other studio shows what the AI is doing, with Stop and a click to open the chat.

## Right-click AI

With AI on, context menus get an **AI** submenu: on the canvas (describe, restyle, variations, tidy layout, name layers, rewrite, fix spelling, translate, generate an image, auto-enhance, check contrast), in the code editor (explain, fix, refactor, comment, generate) and on website elements (improve copy, make responsive, restyle, add states). Quick actions run the same agent with the same tools and permissions.

## Privacy

Nothing is sent unless AI is on and you chose a non-Demo model. Your prompt, attachments, screenshots of your pages (switchable in Tools settings), memory notes and tool results go to the provider you chose. Chats, memory, skills, knowledge and keys are stored locally; *Settings ▸ Artificial intelligence ▸ Delete all AI data* removes them. Text from outside (web pages, MCP replies, attached files, text on a canvas) is treated as data, not instructions, but no model is immune to prompt injection: keep Balanced or Careful mode with untrusted content ([[Security and Privacy]]).

## Honest limits

OpenFini cannot sign in with a ChatGPT or Claude.ai subscription; only API keys work. The engine is tested against recorded protocol fixtures and fake servers, not live providers in CI. No voice input, no web browsing tool, and OpenFini is not yet an MCP server for external agents.

## See also

- [[Vibe Providers and Permissions]]
- [[Vibe Tools Reference]]
- [[Skills Authoring]]
- [[MCP and Knowledge]]
- [[Security and Privacy]]
