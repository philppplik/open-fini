# Vibe memory, context window and sub-threads

How Vibe remembers you across chats, how you see and trim what a request sends, and how side conversations
(sub-threads) work. User guide: [vibe-studio.md](vibe-studio.md). Security notes: [security.md](security.md).

## Memory across chats

Vibe keeps short memories about you and your work: **preferences** ("metric units, calm tone"), **facts** ("works at a
coffee roaster called Ember & Oak"), **project context** ("the Acme logo must stay square") and plain **notes**.

**How memories are made.** The model calls `remember` when you state something lasting. By default every new memory
asks for approval and shows its exact text. *Save memories without asking* skips the approval; the chat then shows
the saved text with **Undo**. A memory that says nearly the same as an existing one (token overlap of 75 % or more)
updates that memory instead of adding a duplicate. You can also add memories by hand.

**How memories are used (retrieval).** Memories are not all pasted into every request. For each message Vibe ranks
the saved memories against the message and the last two things you wrote (BM25-style term weights, prefix matches for
simple inflections, a small boost for preferences and recent memories) and sends the best ones, by default eight,
within about 2,400 characters. **Pinned** memories are always sent. With eight or fewer memories all of them are
sent. A memory with a project scope (`project:<name>`) is only used while a document with that name is open. The
model can search further with `recall_memory` and delete a wrong memory with `forget_memory` (always asks).

**Where to manage them.** *Settings ▸ Artificial intelligence ▸ Memory*:

| Control | Effect |
| --- | --- |
| *Use memory across chats* | Global off switch. Off: no memory is sent and the three memory tools are removed from the tool list. Saved memories stay until you delete them. |
| Switch per memory | Off: the memory is kept but never sent. |
| Pin | Sent with every request. |
| Edit | Text, kind and project scope. |
| Delete, *Delete all memories…* | Removes them from this device. |
| *Export…* / *Import…* | Plain JSON (`{ "format": "openfini-memory", "version": 1, "memories": [...] }`); duplicates are skipped on import. |
| *Memories per request* | 1 to 40, default 8. |

Each row shows the kind, the scope, the chat that saved it, how often it was used and the last change.

**Privacy.** Memories are stored in IndexedDB on this device (`vibe.memory`), never in documents, profiles or
collaboration rooms, and never synced. The only place they leave the device is the system prompt of a request to the
model you chose (with the offline Demo model nothing leaves the device). *Settings ▸ Security ▸ Delete AI data* removes them with the
rest of the AI data. Memories saved before this version (`{ id, text, time }`) are migrated on first use; the old limit
of 60 notes is now 500 (the oldest unpinned memory is dropped first).

**Limits.** Retrieval is lexical: a memory about "colours" is not found for "palette" unless a word overlaps.
Embedding-based retrieval (the knowledge base's optional embedding model) is not used for memories yet. Memories are
written by the model and can be wrong; review them like any other AI output. The model is told memories are data, but
a memory saved from a prompt-injected page could still steer later chats: keep approvals on when you work with content
you do not trust.

## Context window

The **Context window** button in the composer opens an overview of what the next request sends:

- a meter with the estimated tokens against the model's context window (known families: Claude 200k, GPT-4o 128k,
  GPT-4.1 and Gemini 1M, GPT-5 400k; unknown models and the Demo model 128k);
- groups: instructions (system prompt with the skill catalog and document summary), tool definitions, the memories
  picked for the text in the composer, messages, files and images, tool calls and tool results, each with its size.

Estimates use about four characters per token and a flat 1,600 tokens per image; real counts depend on the provider's
tokenizer. Actions:

| Action | What changes |
| --- | --- |
| Remove a tool result or attachment | The block is replaced by `[Removed from the context by the user.]`; tool calls and results stay paired, so providers accept the transcript. |
| Remove a message | Removes the whole turn (your message and everything the assistant did for it). |
| *Drop older tool results* | Replaces every tool result before the newest turn by the marker. |
| Remove a memory | Excludes that memory from this chat (`chat.memoryExclude`); *Restore* brings them back. |
| *Use memory in this chat* | Switches memory off for this chat only (`chat.memoryOff`). |

Edits are saved with the chat and cannot be undone (the removed content is gone from the chat). The automatic
compaction of the agent loop (`compactMessages`) still shortens old tool results and images when a request exceeds
its budget.

## Sub-threads

Right-click a message ▸ **Start a sub-thread here** opens a new chat that starts with the conversation up to that turn
and links back to it (`chat.parent = { id, title, index }`). The chat list shows sub-threads indented under their main
thread; a sub-thread of a sub-thread hangs under the same main thread. The bar on top of a sub-thread offers **Back to
main thread** and **Use in main thread**, which opens the main thread with the sub-thread's last answer in the
composer, so you decide what goes back. Answers in a sub-thread never change the main thread. Deleting the main thread
keeps its sub-threads as normal chats. **Branch chat from here** still makes an independent copy.

## Code

| Part | Location |
| --- | --- |
| Records, ranking, duplicates, import (pure) | `app/src/vibe/memory.js`, tests `tests/vibe/memory.test.js` |
| Storage and settings (`memoryEnabled`, `memoryAutoSave`, `memoryPerRequest`) | `app/src/vibe/store.js` |
| Retrieval per request, `previewContext()`, memory tools context | `app/src/vibe/session.js` (`#memoryFor`, `#systemPrompt`) |
| Tools `remember`, `recall_memory`, `forget_memory` | `app/src/vibe/tools/meta.js` |
| Context items and drops (pure) | `app/src/vibe/context-items.js`, tests `tests/vibe/context-items.test.js` |
| Memory panel, context popover | `app/src/ui/vibe/panel-memory.js`, `app/src/ui/vibe/context-panel.js` (both lazy) |
| Sub-threads | `nestChats` in `app/src/vibe/chat-ops.js`, menu item in `app/src/ui/vibe/context.js`, bar in `chat.js` |
