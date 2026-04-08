# openclaw-guild

Multi-user business platform plugin for [OpenClaw](https://openclaw.ai).

## The problem

OpenClaw is great for a single user, but if you run a business and want your team to use AI agents, you're stuck. Everyone shares the same memory, the same context, the same access. You can't give an employee access to a marketing agent without exposing your private projects, financials, or other work.

## What Guild does

Guild turns single-user OpenClaw into a multi-user business platform. Each person gets their own agents with isolated memory, shared team knowledge flows through role-based access control, and an admin dashboard lets you manage it all — who can see what, what agents remember, and what they're allowed to do.

- **Tiered memory** — agent-private, per-user, role-shared, and company-wide knowledge, all in Supabase with row-level security
- **Skills** — versioned instruction sets assigned by scope (company, role, agent) with a visual assignment matrix
- **Data isolation** — agents only see their own data, enforced at the database level. No agent can read another agent's memories.
- **Auto-recall** — injects relevant user, company, and role context into every agent session automatically
- **Auto-capture** — detects and saves user facts from conversations (with per-user opt-out)
- **Memory persistence** — saves important context before compaction so it survives context window compression
- **Admin UI** — [web dashboard](https://github.com/SpireTech/openclaw-guild-admin) for managing agents, users, roles, memory, skills, network policies, and audit logs
- **Agentic Management** — use Claude Code or your favorite command-line AI tool to administer users and configuration

## Install

```bash
openclaw plugins install openclaw-guild
openclaw guild setup
openclaw guild provision-agent --all
```

Or via npm:
```bash
npm install openclaw-guild
```

## What it accesses

This plugin runs inside the OpenClaw gateway process and accesses:

| Resource | Purpose |
|---|---|
| **Supabase API** | All memory and skill operations (configured via plugin config) |
| **Gateway env vars** | Credential resolution (`$ENV_VAR` references in agent config) |
| **Session transcripts** | Pre-compaction context extraction (read-only) |
| **User messages** | Auto-capture of user facts (opt-out available per user) |

The plugin does **not** contact any service other than your configured Supabase instance.

## Documentation

- **[Full documentation & source](https://github.com/SpireTech/openclaw-guild)** — architecture, config reference, migration guide, contributing
- **[Admin UI](https://github.com/SpireTech/openclaw-guild-admin)** — web dashboard ([Docker image](https://ghcr.io/spiretech/openclaw-guild-admin))
- **[Installation Runbook](https://github.com/SpireTech/openclaw-guild/blob/main/packages/plugin/INSTALL.md)** — manual setup steps
- **[Migration Guide](https://github.com/SpireTech/openclaw-guild/blob/main/docs/MIGRATION-GUIDE.md)** — importing existing file-based memory

## Requirements

- OpenClaw >= 2026.3.24
- Supabase (local or hosted)

## Built by

[SpireTech](https://www.spiretech.com) — a 30+ year Managed IT Service Provider (MSP) in Portland, OR, USA. We provide IT and AI consulting, security, and support services to small and medium businesses locally and internationally.

If you are an MSP with clients concerned about privacy or token costs, this is for you — enable a local AI server for your clients in their office.

## License

AGPL-3.0-or-later
