# Migration Guide — Moving Existing Agents to Guild

If you have existing OpenClaw agents using file-based memory (`MEMORY.md`, `memory/*.md`), this guide covers how to migrate them to Guild's Supabase-backed memory.

---

## What gets migrated

The `openclaw guild migrate` command reads an agent's existing file-based memory and imports it into Supabase:

| Source | What happens |
|---|---|
| `MEMORY.md` in workspace root | Parsed into namespace/key/value entries and saved as agent memories |
| `MEMORY.md` in subdirectories | Same — subdirectory name becomes a key prefix |
| `memory/*.md` session transcripts | **Not migrated** — these are conversation logs, not structured memory. They continue to be saved by OpenClaw's session hooks. |
| Empty or stub `MEMORY.md` files | Skipped (files containing "Memory has moved" or "Do NOT write to this file") |

### How MEMORY.md is parsed

- `## Section` headers become memory **namespaces** (e.g., `## Todo` → namespace `todo`, `## Lessons Learned` → namespace `lessons`)
- Bullet items under sections become individual **key/value** entries
- Common section names are mapped automatically: "todo/tasks" → `todo`, "lesson/learned" → `lessons`, "decision" → `decisions`, "note" → `notes`, "observation" → `observations`
- Anything else becomes namespace `context`
- All migrated entries are tagged with `["migrated"]` and `source: "migrated"` for easy identification

### What doesn't get migrated

- Session transcripts (`memory/*.md`) — these are raw conversation logs, not structured memory
- OpenClaw's built-in memory index (`.memory-index.json`) — replaced by Supabase queries
- Any file outside the agent's workspace directory

---

## Prerequisites

Before migrating, complete the Guild setup:

1. Guild plugin installed and configured (`openclaw guild setup`)
2. Agents provisioned (`openclaw guild provision-agent --all`)
3. Gateway restarted
4. `openclaw guild doctor` passes

---

## Step 1: Preview (dry run)

Always preview first to see what will be migrated:

```bash
# Preview all agents
openclaw guild migrate dummy --all --dry-run

# Preview a specific agent
openclaw guild migrate marketing-lead --dry-run
```

The dry run shows:
- How many `MEMORY.md` files were found
- How many entries were parsed from each file
- Which entries would be saved (namespace/key + character count)
- Which entries already exist in Supabase (skipped)

## Step 2: Migrate

```bash
# Migrate all configured agents
openclaw guild migrate dummy --all

# Migrate a specific agent
openclaw guild migrate marketing-lead
```

The command:
1. Authenticates as the agent (using credentials from plugin config)
2. Checks for existing memories in Supabase (avoids duplicates)
3. Reads and parses `MEMORY.md` files from the agent's workspace
4. Saves each entry to the `agent_memories` table via the Supabase REST API
5. Reports results: imported count, skipped count

## Step 3: Verify

```bash
# Check the agent's memories are in Supabase
openclaw guild doctor

# Or test directly
cd ~/.openclaw/gateway-docker
docker compose exec openclaw-gateway openclaw agent --agent <agent-id> \
  -m "Read your memories and tell me what you know"
```

You can also verify in the Admin UI → Data → Agent Memories tab, filtering by the agent.

## Step 4: Clean up old files (optional)

After verifying the migration, you can remove the old file-based memory:

```bash
# The migrate command does NOT delete source files
# Remove manually after verification:
rm ~/.openclaw/workspace-<agent-name>/MEMORY.md
rm -rf ~/.openclaw/workspace-<agent-name>/memory/
```

Or leave them — Guild agents ignore `MEMORY.md` files. The `before_prompt_build` hook tells agents to use `guild_memory_*` tools instead of files.

---

## Re-running migration

Migration is **idempotent** — running it again skips entries that already exist in Supabase (matched by namespace + key). It's safe to re-run after adding new content to `MEMORY.md`.

---

## Rollback

If you need to revert to file-based memory:

1. Change the memory slot back: set `plugins.slots.memory` to `"memory-core"` in `openclaw.json`
2. Restart the gateway

Your data in Supabase is preserved. The old `MEMORY.md` files (if not deleted) will be picked up by `memory-core` again.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Agent not configured" | Run `openclaw guild provision-agent <agent-id>` first |
| "Auth failed" | Check agent credentials in `plugins.entries.guild.config.agents` |
| Entries show as skipped | They already exist in Supabase — this is expected on re-run |
| Parsed 0 entries | `MEMORY.md` may be empty, a stub, or in an unrecognized format |
| Agent can't find migrated memories | Restart the gateway after migration |
