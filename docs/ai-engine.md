# AI engine

The AI runtime behind Vibe Studio lives in `app/src/ai/`. Like the other engines it is **pure**: no DOM, no
`localStorage`, no direct global `fetch` (every network function takes `fetch` through its options and defaults to
`globalThis.fetch` at call time), no dependencies. The same files run in browsers, Tauri WebViews and Node 20+.
Tests are in `tests/ai/` and use fake fetch implementations and scripted providers only.

```
app/src/ai/
  index.js            re-exports everything
  util.js             ProviderError, SSE parser, lenient JSON, base64, abort helpers
  agent.js            runAgent, compactMessages, estimateTokens, validateSchema
  providers/
    openai.js         OpenAI-compatible Chat Completions client
    anthropic.js      Anthropic Messages API client
    mock.js           deterministic offline "Demo" provider
    index.js          createProvider, PROVIDER_PRESETS, DEMO_PRESET
  mcp.js              Model Context Protocol client (Streamable HTTP) + agent tool adapter
  rag.js              chunking, BM25 + optional dense vectors, serialization
  skills.js           SKILL.md parser, catalog, buildSystemPrompt, BUILTIN_SKILLS
  skills-builtin.js   the eight built-in skills (markdown strings)
  vault.js            passphrase encryption, key masking, PKCE + OpenRouter OAuth helpers
```

## Message model

Provider-neutral, Anthropic-style blocks.

```js
Message = { role: 'user' | 'assistant', content: string | Block[] }
Block =
  | { type: 'text', text }
  | { type: 'image', mime, data /* base64 */ }
  | { type: 'tool_use', id, name, input /* object */ }
  | { type: 'tool_result', toolUseId, content: string | ({type:'text',text}|{type:'image',mime,data})[], isError? }
  | { type: 'thinking', text, signature? /* Anthropic round-tripping */, redacted?, data? }
ToolSpec = { name, description, inputSchema /* JSON Schema object */ }
```

Rules: a `tool_use` block is always answered by a `tool_result` block (same `id` / `toolUseId`) in the next user
message. `thinking` blocks are kept in history; Anthropic requires them (with signature) to be sent back during
tool loops, the OpenAI translation drops them.

## Providers

Every provider has the same shape:

```js
provider = {
  name, kind, baseUrl, capabilities: { embeddings, images },
  listModels({signal}?) -> Promise<{id, name?, contextWindow?, vision?, tools?, imageOutput?, pricing?:{promptPerM, completionPerM}}[]>,
  stream(request, {signal}?) -> AsyncIterable<Event>,
  embed(texts, {model}) -> Promise<number[][]>,
  generateImage({prompt, model, size?, n?, image?, mask?, background?, imageApi?}) -> Promise<{mime, data}[]>,
}
request = { model, system?, messages, tools?, maxTokens?, temperature?, reasoning?: {effort:'low'|'medium'|'high'},
            toolChoice?: 'auto'|'none'|{name} }
```

Stream events:

| Event | Meaning |
| --- | --- |
| `{type:'text', delta}` | answer text |
| `{type:'thinking', delta}` | reasoning text (`reasoning_content`, `reasoning`, Anthropic `thinking_delta`) |
| `{type:'tool_call', id, name, input, error?, rawArguments?, repaired?}` | emitted once, when complete. Truncated JSON is repaired (`repaired:true`); unrecoverable JSON yields `input:{}` plus `error` |
| `{type:'usage', input, output, cachedInput?}` | one event per call, right before `done` (`input` includes cached tokens) |
| `{type:'done', stopReason:'end'\|'tool_use'\|'max_tokens'\|'error', message}` | `message` is the complete assistant Message |

Errors are thrown as `ProviderError { status, code, message, retryable, retryAfterMs? }`. Retryable: 408, 409, 425,
429, 5xx (except 501/505), 529, network failures and truncated streams; never `insufficient_quota`, auth, billing and
invalid-request errors. OpenAI, OpenRouter (numeric `error.code`, `metadata.raw`), DeepSeek and Anthropic error
bodies are parsed. Providers never retry; the agent layer does. `AbortSignal` aborts the fetch and the body read
(AbortError is thrown).

### Matrix

| Preset id | Kind | Base URL | Key | Notes |
| --- | --- | --- | --- | --- |
| `openrouter` | openai | `https://openrouter.ai/api/v1` | yes | rich `/models` metadata; reasoning as `reasoning:{effort}`; image output via `imageApi:'chat'`; OAuth PKCE |
| `openai` | openai | `https://api.openai.com/v1` | yes | `max_completion_tokens`, `reasoning_effort`, `gpt-image-1` via `/images/*` |
| `anthropic` | anthropic | `https://api.anthropic.com` | yes | native tool use, thinking, prompt caching |
| `deepseek` | openai | `https://api.deepseek.com` | yes | no image input |
| `xai` | openai | `https://api.x.ai/v1` | yes | |
| `groq` | openai | `https://api.groq.com/openai/v1` | yes | |
| `together` | openai | `https://api.together.xyz/v1` | yes | |
| `mistral` | openai | `https://api.mistral.ai/v1` | yes | |
| `google-gemini` | openai | `https://generativelanguage.googleapis.com/v1beta/openai` | yes | `models/` id prefix is stripped |
| `ollama` | openai | `http://localhost:11434/v1` | no | browsers need `OLLAMA_ORIGINS` |
| `lmstudio` | openai | `http://localhost:1234/v1` | no | enable CORS for the web build |
| `custom` | openai | user supplied | optional | vLLM, LiteLLM, llama.cpp, ... |

`createProvider({kind:'openai'|'anthropic'|'mock', ...})` or `createProvider({preset:'groq', apiKey})`.
`DEMO_PRESET` (kind `mock`) is exported separately from `PROVIDER_PRESETS`.

OpenAI translation details: `tool_use` becomes `assistant.tool_calls`, `tool_result` becomes `role:'tool'` messages
(errors are prefixed with `Error:`), images become `image_url` data URLs. Tool messages cannot carry images, so
images inside a `tool_result` are appended as a following user message. `toWireMessages` / `fromWireMessages` are
exported and round-trip. Image generation: `imageApi:'images'` (default; `/images/generations`, or `/images/edits`
as multipart when `image` is given; `url` results are fetched without the API key) or `'chat'` (chat completions
with `modalities:['image','text']`, images arrive as data URLs).

Anthropic translation details: `system` is top level; `cache:true` (provider option or per request) adds
`cache_control` to the system prompt and the last tool; `reasoning.effort` maps to
`thinking:{type:'enabled', budget_tokens}` (low 2048, medium 8192, high 24576, clamped below `max_tokens - 1024`;
disabled when under 1024; temperature and forced `toolChoice` are dropped while thinking). Default `max_tokens` is
8192. `embed` and `generateImage` throw `ProviderError` with code `unsupported`.

### Demo provider

`createMockProvider({script?, delayMs?})` is offline and deterministic. The default script reacts to keywords in the
last real user message and walks a plan, one step per model call, reading ids from earlier tool results (JSON in
`tool_result` content):

| Prompt contains | Tool calls (one step each) |
| --- | --- |
| `poster`, `flyer`, `logo` | `new_document` -> `add_shape` (gradient background) -> `add_text` (headline) -> `screenshot` -> closing text |
| `website`, `landing`, `portfolio`, `blog` | `create_website{template}` -> `write_file` x2 -> `screenshot` |
| `rectangle`, `circle`, `headline`/`title` | `add_shape` / `add_text` in one step (+ `set_style{ids}` for outline/border/shadow, then `screenshot`) |
| `brighter`, `contrast`, `saturation`, `blur` | `list_layers` (when no ids known) -> `apply_adjustment{kind,id,params}` / `apply_filter{filter,id,params}` -> `screenshot` |
| `agents` with `brand kit` / `three` / `parallel` | `new_document` -> three `spawn_agent{role,task,tools:['design']}` in one step -> `wait_agent{}` -> `screenshot` (each child is answered by the same script from its task: rectangle, circle, headline) |
| `batch`, `run_plan`, `run a plan` | one `run_plan` with five steps and a `{"$ref":"card.id"}` reference -> `screenshot` |
| `query` / `find all` + rect/shapes/layers/text | `query_layers{type}` -> `apply_to_many{query,style}` -> `describe_page` |
| `Use the “name” skill [with args {...}].` | `use_skill{name,args}` first, then the plan for the rest of the prompt |

Calls are only made for tools present in `request.tools`. The demo tool arguments (illustrative; the real tools
define the contract): `add_shape{type:'rect'|'ellipse',x,y,w,h,fill,radius,name}` where `fill` may be a gradient
object `{type:'linear',angle,stops:[{offset,color}]}`, `add_text{text,x,y,fontSize,color,fontWeight}`,
`set_style{ids,...}`, `apply_adjustment{kind,id,params}`, `create_website{template}`, `write_file{path,content}`.
`embed` returns hashed bag-of-words vectors, `generateImage` returns a small valid gradient PNG. A custom
`script(request, {signal})` async generator may yield provider events; a missing `done` is synthesized.

## Agent loop

```js
const result = await runAgent({
  provider, model, system, messages, tools,
  maxSteps = 24, maxTokens, temperature, reasoning, signal, onEvent, approve,
  retries = 2, contextBudget, maxResultChars = 60000, sleep, toolContext, toolChoice,
});
// -> { messages /* new messages only */, stopReason: 'end'|'max_steps'|'aborted'|'error', usage:{input,output,cachedInput?}, steps, error?, truncated? }
```

`ToolDef = { name, description, inputSchema, run(input, ctx), needsApproval?(input) -> boolean|string, readOnly? }`.
`ctx = { ...toolContext, id, name, signal, step, report(text) }`. `run` may return a string, an object (JSON
stringified), a `Block[]` (text/image) or nothing (`"OK"`). Throwing produces an error result.

Semantics:

- Each step streams the model, forwards deltas, collects tool calls and executes them. Consecutive `readOnly` tools of
  one step run in parallel (`Promise.all`); all others run one at a time in call order. Results keep call order.
- Per call, in order: unknown tool, unparseable arguments (provider `error` flag), schema validation, approval,
  `run`. Every failure becomes a `tool_result` with `isError:true` and a message that helps the model fix the call
  (valid tool names, the failing JSON paths, the expected schema). The loop never throws because of a tool.
- Approval: when `needsApproval(input)` is truthy, `approve({id,name,input,reason})` is awaited (`reason` is the
  returned string or `Run <name>`). A falsy answer yields `The user declined this action.`. Without an `approve`
  callback such tools are declined.
- Retry: retryable `ProviderError`s are retried up to `retries` times with `retryAfterMs` or exponential backoff
  (1 s, 2 s, ... max 30 s) through the injectable `sleep(ms, signal)`; a `retry` event is emitted. Partial output of
  a failed attempt may already have been streamed to `onEvent`; UIs should reset the current bubble on `retry`.
- Abort: `signal` is honored while streaming (the partial assistant message is discarded), while a tool runs
  (the call is answered `Aborted by the user.`, remaining calls are answered the same way, so the transcript stays
  valid) and while waiting for approval. Result: `stopReason:'aborted'`.
- Tool calls arriving with a `max_tokens` stop are executed normally; calls whose arguments were cut off get an
  error telling the model to shorten or split. A plain `max_tokens` end returns `stopReason:'end', truncated:true`.
- Results longer than `maxResultChars` keep head (70 percent) and tail with an omission marker.
- Loop guard: the same failing call (name and input) three times in a row gets a hint appended to the result.
- `contextBudget` (estimated tokens): above it the request uses `compactMessages(history, {maxChars: budget*4})`; the
  returned `messages` are never compacted.
- `onEvent` exceptions are swallowed.

`onEvent` events: `{type:'step', n}`, `{type:'text', delta}`, `{type:'thinking', delta}`,
`{type:'tool_start', id, name, input}`, `{type:'tool_progress', id, name, text}` (from `ctx.report`),
`{type:'tool_end', id, name, result, isError, ms}`, `{type:'usage', input, output, cachedInput?, total}`,
`{type:'retry', attempt, error, status?, delayMs}`, `{type:'done', stopReason, usage, steps, error?}`.

Parallel tools: consecutive `readOnly` calls of one step run concurrently; mutating calls keep their order. The Vibe
session additionally serializes mutating calls across chats with a FIFO write lock (`app/src/vibe/locks.js`, ADR 0007).

**Sub-agents** (`app/src/vibe/agents.js`, pure): `new AgentManager({runAgent, provider, model, parentTools, depth,
settings:{maxConcurrent, maxSteps, budgetSteps, budgetTokens}, signal, onEvent, approve, toolsFor})` runs child loops
with `runAgent`: `spawn({role, task, tools, constraints, maxSteps})` (queued FIFO beyond `maxConcurrent`), `wait(ids?)`
-> `[{id, role, status, summary, artifacts:{layers, files}, steps, usage, ms, note?, error?}]`, `list()`,
`cancel(id)`, `cancelAll()`. `resolveToolset(spec, parentTools, {depth})` maps tool-set names (`design`, `pixel`,
`web`, `layout`, `knowledge`, `read-only`) and tool names to a subset of the parent's tools (never more; no
`ask_user`/`create_tool`/`remember`; no `spawn_agent` at `MAX_DEPTH` = 2). Children share one step/token budget,
abort with the parent and emit `{type:'agent_status', agent}` and `{type:'agent_event', agentId, role, parentToolId,
ev}` (child tool ids are prefixed `a1:`). Child approvals call `approve` with `agent:{id, role}`.

Also exported: `compactMessages(messages, {maxChars=200000, keepRecent=6})` (replaces old images with
`[image omitted]`, then old tool results with `[result omitted]`, then shortens old long text; never mutates, never
touches the last `keepRecent` messages), `estimateTokens(messages)` (characters / 4, images about 1.5k tokens),
`validateSchema(value, schema)` (type, enum, const, required, properties, additionalProperties, items, min/max,
minLength/maxLength, pattern, minItems/maxItems, oneOf/anyOf/allOf, nullable) and `truncateText`.

## MCP

`new McpClient({url, headers?, fetch?, name='OpenFini', version, protocolVersion='2025-06-18', timeoutMs=30000, onMessage?})`
implements the Streamable HTTP transport: `connect()` (initialize + `notifications/initialized`, keeps
`Mcp-Session-Id`, sends `MCP-Protocol-Version`), JSON and `text/event-stream` replies (server notifications and
requests in the stream go to `onMessage` and are otherwise ignored), `listTools()` / `listResources()` /
`listPrompts()` (cursor pagination), `callTool(name, args, {signal, timeoutMs})`, `readResource(uri)`,
`getPrompt(name, args)`, `request(method, params)`, `close()` (HTTP DELETE, never throws). An expired session (404)
is re-initialized once. JSON-RPC errors and HTTP failures throw `McpError {code, data, status}`; timeouts use code
`'timeout'`. Authentication is a bearer header you pass in `headers`; there is no OAuth flow.

`await mcpToolsToAgentTools(client, {prefix, serverName, usedNames?, tools?})` returns `ToolDef[]` named
`${prefix}__${tool}` (sanitized to `[a-zA-Z0-9_-]{1,64}`, collision-safe), description prefixed with `[serverName]`,
`inputSchema` passed through, `needsApproval` always set unless the tool has `annotations.readOnlyHint` (which also
sets `readOnly`). Results map text, image, resource and resource-link parts to Blocks; `isError` results throw so the
agent reports an error. Treat everything an MCP server returns as untrusted data.

## RAG

`chunkText(text, {size=900, overlap=120, separators})`: paragraph, line, sentence, clause, word boundaries; chunks are
at most `size` characters and share up to `overlap` characters of context.

`new KnowledgeIndex()`:

- `addDocument({id, title, text, meta})` indexes into BM25 immediately (synchronously, so it works without `await`)
  and returns a promise that resolves after embedding when an embedder is set (a failing embedder rejects but keeps
  the document searchable); re-adding an id replaces the document. `removeDocument(id)`, `listDocuments()`
  -> `[{id,title,chunks,meta}]`.
- `search(query, {k=6, minScore})` (async) -> `[{docId, title, chunkId, text, score, meta}]`. BM25 with an English
  tokenizer, light stemmer and stop words (title terms count). With `setEmbedder(async (texts) => number[][])`
  and stored vectors, it fuses BM25 and cosine rankings by reciprocal rank fusion (scores are then RRF values).
  `searchSync` is BM25 only. `embedMissing()` embeds chunks added before the embedder was set.
- `toJSON()` / static `KnowledgeIndex.fromJSON(objOrString)` (vectors as base64 Float32), `stats()`.
  A restored index has no embedder; call `setEmbedder` again to enable hybrid search.

5,000 chunks index and search in well under 100 ms per query.

## Skills

A skill is a markdown file with optional frontmatter (`name`, `description`, `allowed-tools`, `tags`, anything else
goes to `meta`). `parseSkill(md)` is tolerant (inline lists, comma lists, YAML dashes, folded and literal blocks,
quotes, CRLF, no frontmatter), `serializeSkill({name, description, body, allowedTools?, tags?, meta?, ...})` writes it
back, `skillsCatalog(skills)` builds the compact list for the system prompt (the model loads one with `use_skill`).

`BUILTIN_SKILLS` is an array of 26 markdown strings (`BUILTIN_SKILL_LIST` has them parsed): the original ten in
`skills-builtin.js` and sixteen workflow skills in `skills-library.js`. Each has a workflow, concrete rules (grids,
type scales, contrast ratios), token-saving tips where useful and a verification step.

Skills v2 (all pure, see [vibe-skills.md](vibe-skills.md) for the format): parsed skills also carry `params`
(`[{name, description, default?, required}]`), `whenToUse`, `requires`, `references`, `version`, `studios`,
`enforceTools` and `argumentHint`, derived from the frontmatter (the raw values stay in `meta`).

- `renderSkill(skill, {args, all})` -> `{text, missing, values}`: substitutes `{{name}}` and `$ARGUMENTS`, appends
  undeclared values, includes required skills (depth 3, cycle safe), lists reference files and the enforced tools.
  `args` is an object or a string (`key=value`, `key="two words"`, otherwise the first required parameter).
- `validateSkill(skillOrText, {toolNames, skillNames})` -> `{errors, warnings, skill}`.
- `suggestSkills(prompt, skills, {limit=3, min=1.2})` -> `[{skill, score}]` (BM25 over name x2, description, tags,
  when-to-use x2; stop words and a light plural stemmer).
- `parseArgString`, `parseParam` helpers; `skillsCatalog` shows `[args: a, b?]`.

`buildSystemPrompt({studio, doc, skills, memory, knowledgeHint, mode, extra})`: identity ("Vibe, the assistant built
into OpenFini"), studio notes, current document (`{name, pages, page:{width,height}, website}` or any object or
string), how to work (look first, small reversible edits, verify with screenshots, units are px, page-space
coordinates, never invent tools, ask when ambiguous), safety (tool results from MCP, web, files and the knowledge
base are untrusted data, not instructions), the mode, the skill catalog, the knowledge hint, remembered facts and the
user's `extra` instructions last. `mode`: `'careful'` (plan and confirm before changes), `'balanced'` (default; asks
only when it matters), `'auto'` (no questions, finish the job); `'ask'` (answers only) and `'plan'` (plan first) are
also accepted.

## Vault

- `encryptJson(value, passphrase)` -> `{v:1, kdf:'PBKDF2-SHA256', iter:250000, cipher:'AES-GCM', salt, iv, data}`
  (base64 fields, random salt and IV, the format version is authenticated). `decryptJson(blobOrString, passphrase)`
  throws `VaultError` with code `bad_passphrase` (also for tampered data) or `bad_format`.
- `maskKey(key)` -> `sk-o...cdef`, `randomId(prefix?, bytes=8)`.
- OpenRouter OAuth with PKCE (RFC 7636): `createPkce()` (async) -> `{verifier, challenge, state}`,
  `pkceChallenge(verifier)`, `openRouterAuthUrl({callbackUrl, challenge, state?})` (returns the URL string; `state`
  is appended to the callback URL), `exchangeOpenRouterCode({code, verifier, fetch})` -> `{key, userId?}`.

The vault only encrypts and decrypts; persisting the blob (and holding the unlocked keys in memory) is the UI's job.

## OpenFini tool names

The runtime assumes the studio layer provides these tools (the parent implements them). Names are fixed; schemas
are owned by the implementation. Read-only tools are marked (R) and may run in parallel.

| Tool | Purpose |
| --- | --- |
| `get_document_info` (R) | name, page size, page count, units, active studio and layer counts |
| `list_layers` (R) | the layer tree with ids, names, kinds, bounds, visibility |
| `get_selection` (R) | the selected layers with their properties |
| `select_layers` | select layers by id, name pattern or kind |
| `screenshot` (R) | render the current page (or a region) as an image for visual verification |
| `add_shape` | add a rectangle, ellipse, polygon or line with fill, stroke and radius |
| `add_text` | add a text layer with font, size, color, weight and alignment |
| `add_path` | add a vector path from path data or points |
| `import_svg` | import SVG markup as editable layers |
| `set_style` | change fill, stroke, opacity, effects, font and other style properties of layers |
| `transform_layers` | move, resize, rotate, scale, flip layers |
| `group_layers` | group or ungroup layers |
| `delete_layers` | delete layers (needs approval) |
| `reorder_layers` | change stacking order |
| `align_layers` | align and distribute layers relative to each other or the page |
| `add_pixel_layer` | add a raster layer (blank, from an image, or filled) |
| `apply_adjustment` | add or edit a non-destructive adjustment (brightness/contrast, hue/saturation, curves, ...) |
| `apply_filter` | apply a filter (blur, sharpen, noise, ...) to a pixel layer |
| `generate_image` | generate an image with the configured image model and place it |
| `edit_image` | edit an existing image with the image model (inpaint, restyle, background) |
| `add_page` | add a page or artboard with a given size |
| `write_file` | create or overwrite a project file (Code studio; needs approval when overwriting) |
| `read_file` (R) | read a project file |
| `list_files` (R) | list project files |
| `edit_file` | replace a range or a string inside a file |
| `insert_element` | insert an HTML element at a selector position |
| `set_element_style` | set CSS properties on elements matching a selector |
| `set_page_meta` | set title, description, language and Open Graph metadata of the page |
| `search_knowledge` (R) | query the local knowledge base (`KnowledgeIndex.search`) |
| `remember` | store a durable user or project preference for the system prompt |
| `ask_user` | ask the user a short question and wait for the answer |
| `use_skill` (R) | load a skill's full instructions by name (with `args`; or a reference `file`) |
| `create_skill` | save a skill draft distilled from the chat (approval) |
| `run_plan` | ordered tool calls in one turn with `{"$ref":"step.path"}` references, one approval, one undo step |
| `query_layers` (R) | selector/attribute layer query, paged, `fields` projection |
| `describe_page`, `describe_selection` (R) | summary + compact scene text, revision cache (`since` -> `unchanged`) |
| `apply_to_many` | set_style / transform for every query match |
| `evaluate` (R) | sandboxed JavaScript (no network) that may call read-only tools |
| `screenshot_layers`, `compare_screenshots` (R) | isolated renders, before/after pairs, `lowRes` |
| `grid_layout`, `distribute_layers`, `snap_layers`, `make_component` | layout helpers, one undo step each |
| `spawn_agent`, `wait_agent`, `list_agents`, `cancel_agent` (R) | sub-agents (see Agent loop) |
| `list_attachments` (R), `open_attachment` | files attached in the chat; open one as a new document |

The Demo provider additionally emits `new_document` and `create_website`, so the studio layer should register them as
well.
