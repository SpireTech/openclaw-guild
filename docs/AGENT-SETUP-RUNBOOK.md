# Adding a New Agent — Runbook

**Audience:** Humans and coding agents setting up new agents on OpenClaw Guild.

This runbook covers end-to-end agent creation using the Guild plugin CLI and admin UI.

---

## Prerequisites

- OpenClaw gateway running with Guild plugin loaded and configured (see [README quickstart](../README.md#quick-start))
- Supabase accessible (local or hosted) — the `supabaseUrl` in your plugin config
- A messaging channel for the agent (Discord, Slack, Telegram, etc.) — get the channel ID
- Know which model the agent will use

## Option A: Register via Admin UI

The [Guild Admin UI](https://github.com/SpireTech/openclaw-guild-admin) handles the platform registration step (Supabase account, grants, roles, credentials). The remaining steps (OpenClaw gateway config, sandbox, channel binding, workspace) are done via CLI and config files.

1. Open the Admin UI → Roles & Access → Agents tab
2. Click "Detect Unregistered" to find sandbox containers not yet registered
3. Click "Register" on the agent, or click "+ Register Agent" for manual entry
4. Fill in name, display name, description, owner, and roles
5. Copy the generated credentials and env vars
6. Continue with Step 2 below for gateway configuration

## Option B: Provision via CLI

```bash
openclaw guild provision-agent <agent-name>
```

This:
1. Creates the agent record in the Supabase `agents` table
2. Creates a Supabase Auth account (`agent-<name>@platform.local`)
3. Creates owner memory grants
4. Adds credentials to `plugins.entries.guild.config.agents` in openclaw.json
5. Adds guild tools to the agent's `tools.sandbox.tools.allow` list

## Step 2: Create the Agent in OpenClaw

```bash
openclaw agents add <agent-name> \
  --model "<provider/model-id>" \
  --workspace "~/.openclaw/workspace-<agent-name>" \
  --non-interactive
```

## Step 3: Bind to Messaging Channel

```bash
# Examples for different platforms:
openclaw agents bind --agent <agent-name> --bind "discord:<channel-id>"
openclaw agents bind --agent <agent-name> --bind "slack:<channel-id>"
openclaw agents bind --agent <agent-name> --bind "telegram:<chat-id>"
```

Add the channel to the allowlist in `openclaw.json` if required by your channel config.

## Step 4: Configure Sandbox

Edit `openclaw.json` to add sandbox config. (AI agents: use `python3 -c 'import json; ...'` to avoid corrupting the JSON — never use sed/regex on this file.)

Adjust the values below to match your Docker network and proxy setup:

```jsonc
{
  "sandbox": {
    "mode": "all",
    "workspaceAccess": "rw",
    "scope": "agent",
    "docker": {
      "image": "<your-sandbox-image>",
      "network": "<your-docker-network>",
      "env": {
        // Optional — only if using an HTTP proxy (e.g., Envoy) for agent traffic:
        "HTTP_PROXY": "http://<agent-name>:x@<proxy-ip>:<proxy-port>",
        "HTTPS_PROXY": "http://<agent-name>:x@<proxy-ip>:<proxy-port>",
        "NO_PROXY": "host.docker.internal,localhost,<proxy-subnet>",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      }
    }
  }
}
```

## Step 5: Add Envoy Proxy Policy (Optional)

Skip this step if you're not using an Envoy forward proxy for per-agent network isolation. Envoy is not part of Guild — it's a separate component in your gateway infrastructure.

If you have Envoy, use the Admin UI → Network Policies page, or manually:

1. Create `~/.openclaw/gateway-docker/envoy/policies/<agent-name>.yaml`:
   ```yaml
   additional_domains:
     - "*.com"  # adjust per agent needs
   ```

2. Add to `agent_policies` in `envoy.yaml`
3. Compute Base64 auth: `echo -n "<agent-name>:x" | base64`
4. Add to `known_agents` in `envoy.yaml`

## Step 6: Set Up Workspace

Create minimal workspace files:

```bash
mkdir -p ~/.openclaw/workspace-<agent-name>
```

**AGENTS.md** — role description (Guild plugin injects memory/skill guidance automatically via `before_prompt_build` hook, so you don't need to document tool usage here):
```markdown
# <Agent Name>

<Role description>

## Startup

1. Check your memories and pending tasks
2. If you have work to do, do it. Otherwise reply HEARTBEAT_OK.
```

**SOUL.md, IDENTITY.md** — agent personality and identity.

## Step 7: Add Heartbeat (Optional)

In `openclaw.json`, add to the agent entry:

```jsonc
{
  "heartbeat": {
    "every": "60m",
    "prompt": "Read AGENTS.md for your role. Use guild_memory_read(namespace=\"todo\") to check pending tasks. If you have work to do, do it. If nothing needs attention, reply HEARTBEAT_OK."
  }
}
```

## Step 8: Restart and Verify

```bash
# Restart Envoy (if proxy policy changed)
cd ~/.openclaw/gateway-docker && docker compose restart envoy-proxy

# Restart gateway
docker compose restart openclaw-gateway

# Verify
openclaw guild doctor
```

Message the agent on its bound channel and verify it discovers its skills and memories.

---

## What You DON'T Need to Do

- No memory CLI to copy (deprecated — Guild plugin handles everything)
- No per-agent "Memory System" section in AGENTS.md — `before_prompt_build` hook injects tool guidance, onboarding, and memory summary automatically
- No `PLATFORM_JWT` / `AGENT_UUID` in sandbox env vars — credentials are in plugin config (gateway-side, never in containers)
- No `memory_search` / `memory_get` tool setup — `memory-core` is deactivated, Guild tools replace it

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Agent can't find guild_memory tools | Check `tools.sandbox.tools.allow` includes guild tools, or re-run `openclaw guild provision-agent` |
| Memory read returns auth error | Check agent credentials in `plugins.entries.guild.config.agents` |
| Skills return empty | Check Supabase connectivity and that skills exist with `status: published` |
| Agent doesn't see onboarding | Verify Guild plugin loaded: `docker compose logs openclaw-gateway \| grep guild` |
| CLI provision fails with auth error | Check `supabaseServiceKey` in plugin config is the service role JWT (starts with `eyJ`) |
| Credential rotation needed | Admin UI → Agents → Rotate Credentials button, or `POST /api/agents/rotate-credentials` |
