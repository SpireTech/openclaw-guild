# Guild Plugin — Installation Runbook

**Plugin source:** `<your-clone>/packages/plugin/`
**Installed location:** `~/.openclaw/plugins/guild/`
**Requires:** OpenClaw >= 2026.3.24
**Plugin ID:** `guild`
**Kind:** `memory` (owns the memory slot, replaces `memory-core`)

---

## Step 1: Build the Plugin

```bash
cd <your-clone>/packages/plugin
npm install
npx tsc
ls dist/index.js  # verify build succeeded
```

## Step 2: Copy Plugin into Gateway-Accessible Path

The gateway container only mounts `~/.openclaw/`. Copy the built plugin:

```bash
mkdir -p ~/.openclaw/plugins/guild
cp -R <your-clone>/packages/plugin/{dist,node_modules,openclaw.plugin.json,package.json} \
      ~/.openclaw/plugins/guild/
```

The copy must include `dist/`, `node_modules/` (`@sinclair/typebox` needed at runtime), `openclaw.plugin.json`, and `package.json`.

## Step 3: Configure Plugin in openclaw.json

Add the following to your `openclaw.json`:

```jsonc
{
  "plugins": {
    "slots": {
      "memory": "guild"  // Take the memory slot, deactivate memory-core
    },
    "load": {
      "paths": ["<home-dir>/.openclaw/plugins/guild"]
    },
    "entries": {
      "guild": {
        "enabled": true,
        "config": {
          "supabaseUrl": "<your-supabase-url>",
          "supabaseAnonKey": "<anon-key>",
          "features": {
            "memory": true,
            "skills": true
          },
          "agents": {}  // Populated by provision-agent CLI or admin UI
        }
      }
    }
  }
}
```

> **AI agents editing this file:** Use `python3 -c 'import json; ...'` to modify `openclaw.json`. Never use sed or regex — the file is complex JSON that's easy to corrupt.

**Key details:**
- `plugins.slots.memory: "guild"` — activates the Guild plugin as the memory provider
- `supabaseUrl` — your Supabase REST API URL (e.g., `http://localhost:54321` for local, or `https://your-project.supabase.co` for hosted). If the gateway runs in Docker, use `http://host.docker.internal:54321` to reach a local Supabase.
- Credentials support `$ENV_VAR` references (e.g., `"password": "$GUILD_AGENT_MARKETING_LEAD_PASSWORD"`)

## Step 4: Restart Gateway

```bash
cd ~/.openclaw/gateway-docker
docker compose restart openclaw-gateway
```

## Step 5: Provision Agents

```bash
# Check plugin status
openclaw guild doctor

# Provision a single agent
openclaw guild provision-agent <agent-id>

# Or provision all unconfigured agents
openclaw guild provision-agent --all

# Migrate existing MEMORY.md data (if any)
openclaw guild migrate --all --dry-run  # preview
openclaw guild migrate --all            # execute
```

## Step 6: Restart Gateway (after provisioning)

```bash
docker compose restart openclaw-gateway
```

## Step 7: Verify

```bash
# Check plugin list — Guild should be loaded, memory-core disabled
openclaw plugins list

# Check agent connectivity
openclaw guild doctor

# Test an agent (via gateway container for Supabase access)
cd ~/.openclaw/gateway-docker
docker compose exec openclaw-gateway openclaw agent --agent <agent-id> \
  -m "What skills and memories do you have access to?"
```

---

## How Auth Works

Agent credentials are stored in `plugins.entries.guild.config.agents`, keyed by OpenClaw agent ID:

```jsonc
{
  "agents": {
    "marketing-lead": {
      "uuid": "9b4dd229-...",       // Supabase agent UUID (required)
      "email": "agent-marketing-lead@platform.local",  // Auto-generated for Supabase Auth (not a real email)
      "password": "..."             // Auto-generated, or use "$ENV_VAR" reference
    },
    "coding": {
      "uuid": "485dd603-...",
      "jwt": "eyJ..."               // Static JWT (fallback)
    }
  }
}
```

> **Why do agents have email addresses?** Supabase Auth requires email/password for authentication — there's no service account type. Agent emails like `agent-marketing-lead@platform.local` are auto-generated fake addresses used only as Supabase credentials. They never receive mail. The provisioning process creates these automatically.

The plugin authenticates to Supabase per-agent via `signInWithPassword()`, caches JWTs in-process, and auto-refreshes. RLS enforces data isolation.

Agents without credentials are silently skipped — the tools throw a clear error message directing the user to run `openclaw guild provision-agent`.

---

## CLI Commands

After installation, the following commands are available:

| Command | Description |
|---|---|
| `openclaw guild doctor` | Check connectivity, config, slot status |
| `openclaw guild status` | Show plugin status and configured agents |
| `openclaw guild provision-agent <id>` | Provision one agent (Supabase + config) |
| `openclaw guild provision-agent --all` | Provision all unconfigured agents |
| `openclaw guild migrate <id>` | Migrate agent's MEMORY.md to platform |
| `openclaw guild migrate --all --dry-run` | Preview migration for all agents |
| `openclaw guild link-user` | Link external identity to platform user |

---

## Updating the Plugin

After making changes to the source:

```bash
cd <your-clone>/packages/plugin
npx tsc
cp -R dist/* ~/.openclaw/plugins/guild/dist/
cd ~/.openclaw/gateway-docker
docker compose restart openclaw-gateway
```

## Rollback

To revert to file-based memory:

```jsonc
{
  "plugins": {
    "slots": {
      "memory": "memory-core"  // Switch back to built-in
    }
  }
}
```

Then restart the gateway. Agent data in Supabase is preserved.
