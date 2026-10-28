# Vibe Providers and Permissions

Vibe never locks you into one provider. You connect your own accounts under Models, keys stay on your device, and a permission mode decides which tool calls need your approval. This page covers the presets, key protection, approval modes, per-tool settings and the engine limits.

## Connect a model

Open **Models** in Vibe Studio, choose *Add*, and pick a preset or enter any OpenAI-compatible base URL.

| Preset | Notes |
| --- | --- |
| OpenRouter | One key for many models. *Sign in with OpenRouter* (web build) creates a key through OAuth with PKCE |
| OpenAI | API key; image generation and editing through the Images API |
| Anthropic | API key; native Messages API with tool use and extended thinking |
| DeepSeek, xAI (Grok), Mistral, Groq, Together AI, Google Gemini | API key; OpenAI-compatible endpoints (Gemini through its OpenAI-compatible endpoint) |
| Ollama, LM Studio | Local, no key. The server must allow the app's origin (for Ollama set `OLLAMA_ORIGINS`) |
| Custom | Any OpenAI-compatible `/v1` server (llama.cpp, vLLM, a company gateway) or an Anthropic-compatible one: choose the *API type* and add extra headers (one `Name: value` per line). If the server has no model list, type the model id in the model picker |

The offline **Demo** model needs no key and follows a script of real tool calls.

## Keys

Keys are stored only on this device and sent only to the base URL you entered. *Models ▸ Key protection* encrypts them with a passphrase (AES-GCM, key derived with PBKDF2, 250,000 iterations); you unlock once per session. The app lock encrypts them too ([[Security and Privacy]]). Settings profiles never contain keys.

## Approval modes

| Mode | Behavior |
| --- | --- |
| Careful | Asks before every tool that changes something |
| Balanced (default) | Reads and edits the document freely; asks before risky actions (deleting files, overwriting, running custom tools or MCP tools) |
| Auto | Runs everything except custom tools it just wrote and MCP tools, which still ask |

Any tool can be set to *Always allow*. The approval card shows the exact arguments. Whatever the mode, the assistant only touches OpenFini documents: it has no access to your files, shell or network except through the connections and MCP servers you add. Pushes, pulls and publishing always show a dialog, even in Auto. A chat can have its own model and mode (right-click the chat).

## Engine settings (Models ▸ Engine)

Parallel chats (at most 4), sub-agent model (an optional cheaper model), sub-agents per chat (3), steps per sub-agent (12), steps per request (80), skill suggestion chip, enforcement of skill tool restrictions, and token usage display when the provider reports it.

## Language

Replies follow the interface language unless you write in another one. Built-in skills, tool descriptions and system instructions stay English because they are instructions to the model.

## Honest limits

- ChatGPT plan: only through OpenAI's documented preview for open-source apps (preset *OpenAI account*, desktop app only, no images or embeddings; usage counts against your ChatGPT plan). Claude.ai offers no login for third-party apps, only API keys, which are billed separately.
- MCP servers that need OAuth: use *Sign in* next to the server (Settings ▸ Artificial intelligence ▸ Tools).
- Tool calling and image input depend on the model; the model list shows what each reports.
- Providers could not be exercised in CI without keys: the engine is tested against recorded protocol fixtures and fake servers, and real providers may differ in details such as tool-call streaming, image APIs and model lists.
- In a browser, local model servers must permit cross-origin requests from the app.

## See also

- [[Vibe Studio]]
- [[Vibe Tools Reference]]
- [[MCP and Knowledge]]
- [[Security and Privacy]]
