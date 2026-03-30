# OpenClaw Guild

Multi-user business platform plugin for [OpenClaw](https://openclaw.ai).

## The problem

OpenClaw is great for a single user, but if you run a business and want your team to use AI agents on your OpenClaw, you're stuck. Everyone shares the same memory, the same context, the same access. You can't give an employee access to a marketing agent without exposing your private projects, financials, or other work.

## What Guild does

Guild turns single-user OpenClaw into a multi-user business platform. Each person gets their own agents with isolated memory, shared team knowledge flows through role-based access control, and an admin dashboard lets you manage it all — who can see what, what agents remember, and what they're allowed to do.

- **Tiered memory** — agent-private, per-user, role-shared, and company-wide knowledge, all in Supabase with row-level security
- **Skills** — versioned instruction sets assigned by scope (company, role, individual) with a visual assignment matrix
- **Data isolation** — agents only see their own data, enforced at the database level. No agent can read another agent's memories.
- **Auto-recall** — injects relevant user, company, and role context into every agent session automatically
- **Auto-capture** — detects and saves user facts from conversations (with per-user opt-out)
- **Memory persistence** — saves important context before compaction so it survives context window compression
- **[Admin UI](https://github.com/SpireTech/openclaw-guild-admin)** — web dashboard for managing agents, users, roles, memory, skills, network policies, and audit logs
- **Agentic Management** - Use claude code or your favorite command-line ai tool to administer users and configuration for you

## How agents access memory and skills

The **Guild plugin** registers tools directly into the OpenClaw gateway. When an agent calls `guild_memory_read()` or `guild_skill_read()`, the gateway executes the tool in-process — no external server needed. The plugin also injects a skill catalog, memory summary, and onboarding instructions into every agent's system prompt automatically via the `before_prompt_build` hook.

The **MCP server** (`guild-mcp`) is a separate component for non-OpenClaw clients — Claude Desktop, custom integrations, or the admin UI. It exposes the same data over the MCP protocol but is not used by OpenClaw agents.

## Packages

| Package | Description |
|---|---|
| `packages/plugin` | OpenClaw plugin — tools, hooks, and CLI that run inside the gateway |
| `packages/mcp/guild-mcp` | MCP server for external clients (Claude Desktop, integrations) — 29 tools |
| `packages/shared` | Shared Supabase client, types, and embedding helpers |
| `migrations/` | Supabase schema SQL files |

## Quick start

### With OpenClaw

```bash
# 1. Install the plugin
openclaw plugins install openclaw-guild

# 2. Run setup (detects Supabase, runs migrations, configures plugin)
openclaw guild setup

# 3. Provision agents
openclaw guild provision-agent --all

# 4. Verify
openclaw guild doctor

# 5. Restart gateway
openclaw gateway restart
```

### With npm (manual install)

```bash
npm install openclaw-guild
```

Then follow the [Installation Runbook](packages/plugin/INSTALL.md) to configure the plugin in your `openclaw.json` and provision agents.

### MCP server (for Claude Desktop or other MCP clients)

```bash
cd packages/mcp/guild-mcp
npm install
SUPABASE_URL=... SUPABASE_ANON_KEY=... node dist/index.js
```

See the [MCP server README](packages/mcp/guild-mcp/README.md) for configuration options.

## Requirements

- OpenClaw >= 2026.3.24
- Supabase (local via `npx supabase start` or hosted)
- Node.js >= 22
- **For knowledge search:** An embedding model accessible via Ollama (default: `nomic-embed-text` on `localhost:11434`). Knowledge tools use vector embeddings for semantic search. Memory and skill tools do not require embeddings.

## Configuration reference

### Plugin config (`openclaw.json`)

The plugin is configured in `plugins.entries.guild.config`:

```jsonc
{
  "plugins": {
    "slots": {
      "memory": "guild"  // Guild owns the memory slot
    },
    "entries": {
      "guild": {
        "enabled": true,
        "config": {
          "supabaseUrl": "http://127.0.0.1:54321",  // or your hosted Supabase URL
          "supabaseAnonKey": "eyJ...",
          "features": {
            "memory": true,   // Enable memory tools + hooks
            "skills": true    // Enable skill injection
          },
          "agents": {
            "my-agent": {
              "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
              "email": "agent-my-agent@platform.local",  // Auto-generated — see note below
              "password": "...",
              "jwt": "..."    // Alternative: static JWT (fallback)
            }
          }
        }
      }
    }
  }
}
```

### Config fields

| Field | Type | Default | Description |
|---|---|---|---|
| `supabaseUrl` | string | *required* | Supabase project URL |
| `supabaseAnonKey` | string | *required* | Supabase anon/public key |
| `features.memory` | boolean | `true` | Enable memory tools and lifecycle hooks |
| `features.skills` | boolean | `true` | Enable skill catalog injection at bootstrap |
| `agents.<id>.uuid` | string | *required* | Agent's UUID in the `agents` table |
| `agents.<id>.email` | string | — | Auto-generated Supabase Auth email (e.g., `agent-my-agent@platform.local`) |
| `agents.<id>.password` | string | — | Auto-generated password (supports `$ENV_VAR` references) |
| `agents.<id>.jwt` | string | — | Static JWT (fallback auth, supports `$ENV_VAR` references) |

> **Why do agents have email addresses?** Supabase Auth requires email/password for authentication — there's no service account type. Agent emails like `agent-my-agent@platform.local` are auto-generated fake addresses used only as Supabase Auth credentials. They never receive mail. The agent provisioning process (CLI or Admin UI) creates these automatically.

### Consolidated MCP server

The `guild-mcp` server supports config-driven tool group activation via environment variables:

```bash
# Enable all tool groups (default)
GUILD_TOOLS=memory,skills,knowledge node packages/mcp/guild-mcp/dist/index.js

# Memory + skills only (no knowledge/embeddings required)
GUILD_TOOLS=memory,skills node packages/mcp/guild-mcp/dist/index.js

# Memory only
GUILD_TOOLS=memory node packages/mcp/guild-mcp/dist/index.js
```

| Env var | Default | Description |
|---|---|---|
| `GUILD_TOOLS` | `memory,skills,knowledge` | Comma-separated tool groups to enable |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key (for admin operations) |
| `OAUTH_CLIENT_ID` | — | OAuth client ID for RLS headers |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama embedding service (knowledge tools) |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |

### Admin UI

```bash
docker run -p 3100:3100 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_ANON_KEY=eyJ... \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  -e ORG_NAME="Acme Corp" \
  ghcr.io/spiretech/openclaw-guild-admin:latest
```

| Env var | Default | Description |
|---|---|---|
| `ORG_NAME` | `Organization` | Organization name shown in sidebar and title |
| `SUPABASE_URL` | — | Supabase URL |
| `SUPABASE_ANON_KEY` | — | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key for admin operations |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                     │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │              Guild Plugin                     │       │
│  │                                               │       │
│  │  Hooks:                                       │       │
│  │   • before_prompt_build → inject skills+memory │       │
│  │   • before_compaction → flush to Supabase     │       │
│  │   • agent_end        → auto-capture facts     │       │
│  │   • before_dispatch  → cache sender ID        │       │
│  │                                               │       │
│  │  Tools (10):                                  │       │
│  │   guild_memory_{read,save,archive,search,     │       │
│  │                  team,company}                 │       │
│  │   guild_skill_read                            │       │
│  │   guild_user_{read,save}                      │       │
│  └──────────────────────┬───────────────────────┘       │
│                         │ HTTP (PostgREST)               │
│                         ▼                                │
│  ┌──────────────────────────────────────────────┐       │
│  │              Supabase                         │       │
│  │                                               │       │
│  │  Tables:                                      │       │
│  │   agents, users, external_identities          │       │
│  │   agent_memories, user_memories               │       │
│  │   role_memories, company_memories              │       │
│  │   skills, skill_versions, skill_assignments    │       │
│  │   memory_promotions, memory_audit              │       │
│  │   user_agent_grants                           │       │
│  │   knowledge_chunks, clients                    │       │
│  │                                               │       │
│  │  RLS: per-agent auth, data isolation          │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘

┌───────────────────────┐    ┌───────────────────────┐
│   Guild MCP Server    │    │    Guild Admin UI      │
│   (external clients)  │    │                        │
│                       │    │  Next.js dashboard     │
│  For Claude Desktop,  │    │  • Memory management   │
│  custom integrations  │    │  • Skill catalog        │
│  NOT used by OpenClaw │    │  • Role & access ctrl   │
│  agents               │    │  • Network policies     │
│                       │    │  • Audit logging         │
└───────────┬───────────┘    └───────────┬────────────┘
            │ HTTP (PostgREST)           │ HTTP
            └────────────┬───────────────┘
                         ▼
                    Supabase
```

### Memory tiers

1. **Agent** — private to each agent, managed via `guild_memory_*` tools
2. **User** — per-user facts, written by agents or users, shared across agents
3. **Role** — shared by all agents/users in the same role
4. **Company** — organization-wide, visible to everyone

Memories can be **promoted** up tiers (agent → role → company) via the promotion workflow.

### Lifecycle hooks

| Hook | Phase | Purpose |
|---|---|---|
| `before_prompt_build` | Every agent turn | Inject skill catalog + memory reference + onboarding |
| `before_compaction` | Before context compression | Save working context to Supabase |
| `agent_end` | Session end | Auto-capture user facts from conversation |
| `before_dispatch` | Message routing | Cache sender ID for user resolution |

## CLI commands

```bash
openclaw guild setup            # Interactive setup wizard
openclaw guild doctor           # Verify configuration and connectivity
openclaw guild status           # Show plugin status and agent count
openclaw guild provision-agent  # Create/update agent auth in Supabase
openclaw guild migrate          # Run pending database migrations
openclaw guild link-user        # Link external identity to platform user
```

## Contributing

### Development setup

```bash
git clone https://github.com/SpireTech/openclaw-guild.git
cd openclaw-guild
npm install

# Build all packages
npm run build

# Build individual packages
cd packages/plugin && npx tsc
cd packages/mcp/guild-mcp && npx tsc
```

### Project structure

```
openclaw-guild/
├── packages/
│   ├── plugin/         # OpenClaw plugin (memory slot)
│   │   └── src/
│   │       ├── hooks/  # Lifecycle hooks (bootstrap, compaction, auto-capture)
│   │       ├── tools/  # Tool implementations (memory, skill, user)
│   │       ├── lib/    # Agent resolver, skill resolver, user resolver
│   │       └── cli/    # CLI commands (setup, doctor, provision, etc.)
│   ├── mcp/
│   │   ├── guild-mcp/  # Consolidated MCP server (recommended)
│   │   ├── memory-mcp/ # Legacy: memory tools only
│   │   ├── skills-mcp/ # Legacy: skill tools only
│   │   └── knowledge-mcp/ # Legacy: knowledge tools only
│   └── shared/         # Shared types, Supabase client, embeddings
├── migrations/         # Supabase SQL migrations
└── package.json        # Workspace root
```

### Testing

```bash
# Verify plugin loads
openclaw guild doctor

# Test agent memory
openclaw agent --agent test-qwen -m "Save a test memory" --json

# Test MCP server
cd packages/mcp/guild-mcp
GUILD_TOOLS=memory node dist/index.js  # starts on stdio
```

### Conventions

- Tool names use `guild_` prefix (branding)
- Plugin config edited via `python3 -c 'import json; ...'` on `openclaw.json` — never search/replace
- Agent credentials stored in plugin config, not sandbox env vars
- Memory slot plugin (`kind: "memory"`) — deactivates OpenClaw's built-in memory-core

## Migrating existing agents

If you have agents already using OpenClaw's file-based memory (`MEMORY.md`), see the **[Migration Guide](docs/MIGRATION-GUIDE.md)** for how to import their data into Guild.

```bash
openclaw guild migrate dummy --all --dry-run  # preview what will be migrated
openclaw guild migrate dummy --all            # run the migration
```

## Related

- **[Guild Admin UI](https://github.com/SpireTech/openclaw-guild-admin)** — Next.js dashboard for managing agents, users, roles, memory, skills, and audit
- **[Migration Guide](docs/MIGRATION-GUIDE.md)** — importing file-based memory into Guild
- **[Agent Setup Runbook](docs/AGENT-SETUP-RUNBOOK.md)** — end-to-end new agent creation
- **[Installation Runbook](packages/plugin/INSTALL.md)** — manual plugin installation steps

## Security

- Per-agent RLS data isolation at the database level
- Credentials support `$ENV_VAR` references to keep secrets out of JSON config
- Auto-capture opt-out per user (`auto_capture_enabled` flag)
- User memory transparency — agents are told about stored user memories
- See [TODO.md](TODO.md) for the full audit and remaining items

## Built by a Managed Service Provider

[SpireTech](https://www.spiretech.com) — a 30+ year Managed IT Service Provider (MSP) in Portland, OR, USA. We provide IT and AI consulting, security, and support services to small and medium businesses locally and internationally.

If you are an MSP and have clients concerned about privacy or token costs, this is for you - enable a local AI server for your clients in their office. 

## License

AGPL-3.0-or-later
