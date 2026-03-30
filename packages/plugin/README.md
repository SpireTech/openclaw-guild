# openclaw-guild

Multi-user business platform plugin for [OpenClaw](https://openclaw.ai). Adds Supabase-backed memory, skills, and role-based access control for agent teams.

## Install

```bash
openclaw plugins install openclaw-guild
openclaw guild setup
openclaw guild provision-agent --all
```

## What it does

- Replaces file-based memory with Supabase-backed tiered memory (agent, user, role, company)
- Injects skill catalog and memory context into every agent session
- Auto-captures user facts from conversations (with per-user opt-out)
- Saves working context before compaction so it survives context compression
- Per-agent data isolation via Supabase Row-Level Security

## What it accesses

This plugin runs inside the OpenClaw gateway process and accesses:

| Resource | Purpose | Details |
|---|---|---|
| **Supabase API** | All memory and skill operations | Configured via `supabaseUrl` + `supabaseAnonKey` in plugin config |
| **Gateway env vars** | Credential resolution | `$ENV_VAR` references in agent email/password/jwt config fields |
| **Session transcripts** | Pre-compaction context extraction | Reads JSONL session files (read-only) via `before_compaction` hook |
| **User messages** | Auto-capture of user facts | `agent_end` hook scans messages for role, team, preferences. Per-user opt-out available. |

The plugin does **not** make network requests to any service other than your configured Supabase instance. Agent credentials are stored in plugin config (not in sandbox containers) and support `$ENV_VAR` references to keep secrets out of JSON.

## Requirements

- OpenClaw >= 2026.3.24
- Supabase (local or hosted)

## Documentation

- [Full README](https://github.com/SpireTech/openclaw-guild)
- [Installation Runbook](https://github.com/SpireTech/openclaw-guild/blob/main/packages/plugin/INSTALL.md)
- [Migration Guide](https://github.com/SpireTech/openclaw-guild/blob/main/docs/MIGRATION-GUIDE.md)
- [Admin UI](https://github.com/SpireTech/openclaw-guild-admin)

## License

AGPL-3.0-or-later

Built by [SpireTech](https://www.spiretech.com)
