# openclaw-guild-mcp

MCP server for [OpenClaw Guild](https://github.com/SpireTech/openclaw-guild) — 29 tools for memory, skills, and knowledge search. For use with Claude Desktop, MCP-compatible clients, and custom integrations.

> **Note:** OpenClaw agents do NOT use this server. They access Guild through the plugin's registered tools which run inside the gateway. This MCP server is for external clients only.

## Quick start

```bash
# Install
npm install openclaw-guild-mcp

# Run (all tool groups)
SUPABASE_URL=... SUPABASE_ANON_KEY=... npx guild-mcp

# Run (memory + skills only, no embeddings needed)
GUILD_TOOLS=memory,skills npx guild-mcp
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GUILD_TOOLS` | `memory,skills,knowledge` | Tool groups to enable |
| `SUPABASE_URL` | *required* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *required* | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key (admin operations) |
| `OLLAMA_URL` | `http://localhost:11434` | Embedding service (knowledge tools) |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |

## Tool groups

- **memory** (17 tools) — agent, user, role, company memories + promotions + search + introspection
- **skills** (8 tools) — discovery, authoring, assignments with hierarchy resolution
- **knowledge** (4 tools) — semantic search over embedded knowledge chunks

## Authentication

Callers pass a JWT via `request.params._meta.jwt` on each tool call. The server creates a per-request Supabase client with that JWT, so RLS enforces data access. The server itself has no auth layer — security comes from the stdio transport (only the spawning process can communicate) and Supabase RLS.

## License

AGPL-3.0-or-later
