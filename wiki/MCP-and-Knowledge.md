# MCP and Knowledge

Vibe can use outside tools through MCP servers and search your own documents through a local knowledge index (RAG). Both are opt-in and live under the Tools and Knowledge panels of Vibe Studio. This page explains how to connect them, the gateway for stdio servers, and the limits.

## MCP servers

Add the URL of a server that speaks **Streamable HTTP** under *Tools ▸ MCP servers*. Its tools appear with an `mcp_` prefix and always ask first in Balanced mode. Only bearer-token headers are supported for authentication; there is no OAuth for MCP servers, and only tools are used (no resources or prompts yet). Offline mode blocks MCP requests to anything but this computer.

### stdio servers through the gateway

Most community servers are programs, not URLs. The bundled gateway exposes one on `127.0.0.1`:

```sh
npm run mcp:gateway -- --port 3939 -- npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

Then add `http://127.0.0.1:3939/mcp`. The gateway listens on localhost only, accepts browser requests only from localhost, the hosted app and the desktop app (more with `--origin`), and can require `--token`. Remember that a server you expose this way can act with your user's permissions.

## Knowledge (RAG)

Add brand guides, copy decks, specs or notes under *Knowledge*. Files are chunked and indexed on this device with BM25; if you select an embedding model, dense vectors are added and results are blended. Your open website project is indexed automatically. The assistant searches with `search_knowledge`; you can test a query yourself in the panel. *Settings ▸ Artificial intelligence ▸ Delete all AI data* removes the index.

## Memory

The assistant can remember notes (`remember`). They are stored locally and sent to your provider as part of requests. Delete them with the AI data tools.

## Safety

- Text from MCP responses, attached files and retrieved documents is treated as data, not instructions, but no model is immune to prompt injection.
- MCP tools and custom tools ask before each run in Balanced mode; keep Careful mode for content you do not trust.
- Anything an MCP server returns goes to your model provider.

## See also

- [[Vibe Studio]]
- [[Vibe Providers and Permissions]]
- [[Security and Privacy]]
- [[Vibe Tools Reference]]
