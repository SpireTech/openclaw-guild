/**
 * before_prompt_build hook — injects skill catalog, memory tool reference,
 * and guild onboarding instructions into the system prompt.
 *
 * Uses the plugin hook API (api.on) instead of internal hooks (api.registerHook)
 * because internal hooks registered by plugins don't reliably dispatch due to
 * gateway startup ordering (plugins load before the internal hook system).
 *
 * Returns `prependSystemContext` which is cached by providers for prompt caching.
 */

import type { PluginConfig, AgentCredentials } from "../config.js";
import { resolveAgentCredentials } from "../lib/agent-resolver.js";
import { resolveSkillCatalog, formatSkillCatalogXml } from "../lib/skill-resolver.js";
import { supabaseGet } from "../supabase.js";
import { GUILD_BOOTSTRAP_CONTENT } from "./guild-bootstrap.js";

interface PromptBuildEvent {
  prompt: string;
  messages: unknown[];
}

interface AgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
}

interface PromptBuildResult {
  prependSystemContext?: string;
}

/**
 * Create the before_prompt_build hook handler.
 */
export function createBootstrapHook(pluginConfig: PluginConfig) {
  // Cache per agent to avoid re-fetching on every turn
  const contextCache = new Map<string, { content: string; expiresAt: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  return async (
    _event: PromptBuildEvent,
    ctx: AgentContext,
  ): Promise<PromptBuildResult | void> => {
    const agentId = ctx.agentId;
    if (!agentId) return;

    // Check cache
    const cached = contextCache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return { prependSystemContext: cached.content };
    }

    const creds = resolveAgentCredentials(agentId, pluginConfig);
    if (!creds) return;

    try {
      const sections: string[] = [];

      // 1. Guild onboarding
      sections.push(GUILD_BOOTSTRAP_CONTENT);

      // 2. Skill catalog
      if (pluginConfig.features.skills) {
        const catalog = await resolveSkillCatalog(creds, pluginConfig);
        if (catalog.length > 0) {
          sections.push(formatSkillCatalogXml(catalog));
        }
      }

      // 3. Memory tool reference + current memory summary
      if (pluginConfig.features.memory) {
        sections.push(await buildMemoryDoc(creds, pluginConfig));

        // 4. User memory transparency — note if agent has stored memories about users
        const userMemoryNote = await buildUserMemoryNote(creds, pluginConfig);
        if (userMemoryNote) sections.push(userMemoryNote);
      }

      const content = sections.join("\n\n");

      // Cache it
      contextCache.set(agentId, {
        content,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      console.log(
        `[guild] bootstrap: injected ${content.length} chars for "${agentId}"`,
      );

      return { prependSystemContext: content };
    } catch (err) {
      console.warn(`[guild] bootstrap failed for "${agentId}": ${err}`);
      // Still inject the static onboarding even if Supabase is down
      return { prependSystemContext: GUILD_BOOTSTRAP_CONTENT };
    }
  };
}

const TOOL_REFERENCE = `# Org Memory

You have access to organizational memory and skills via the following tools. **Do NOT create or modify MEMORY.md, todo.md, or notes.md files.** Use these tools instead.

## Memory Tools

### guild_memory_read
Read your own memories. Filter by namespace, key, or tags.
\`\`\`
guild_memory_read(namespace="todo")
guild_memory_read(namespace="context", key="current-project")
guild_memory_read(tags=["urgent"])
\`\`\`

### guild_memory_save
Save or update a memory. Upserts by (namespace, key).
\`\`\`
guild_memory_save(namespace="context", key="current-project", value="Working on API refactor")
guild_memory_save(namespace="todo", key="fix-auth-bug", value="Auth tokens expiring early", tags=["bug","urgent"])
guild_memory_save(namespace="lessons", key="docker-networking", value="Always use host.docker.internal from containers", confidence=0.9, source="observed")
\`\`\`

**Namespaces:** context, todo, lessons, notes, decisions, observations (use whatever fits)

### guild_memory_archive
Soft-delete a memory (can be restored).
\`\`\`
guild_memory_archive(namespace="todo", key="fix-auth-bug")
\`\`\`

### guild_memory_search
Search across all memory tiers (agent, role, company) by keyword.
\`\`\`
guild_memory_search(query="docker networking")
guild_memory_search(query="budget", tiers=["company"])
\`\`\`

### guild_memory_team
Read shared team/role memories visible to you.
\`\`\`
guild_memory_team()
guild_memory_team(namespace="playbook")
\`\`\`

### guild_memory_company
Read company-wide memories shared across all agents.
\`\`\`
guild_memory_company()
guild_memory_company(namespace="playbook")
\`\`\`

## Skill Tools

### guild_skill_list
List all skills available to you (refreshed from database).
\`\`\`
guild_skill_list()
\`\`\`

### guild_skill_read
Load the full content of an guild skill by slug (see the guild_skills catalog in your context).
\`\`\`
guild_skill_read(slug="youtube-transcript")
\`\`\`

### guild_skill_save
Create a new skill or add a new version to an existing skill.
\`\`\`
guild_skill_save(name="P1 Escalation", slug="p1-escalation", scope="company", content="...")
guild_skill_save(skill_id="<uuid>", content="Updated content", change_note="Added step 3")
\`\`\`

## User Memory Tools

### guild_user_read
Read memories about the person you are currently talking to.
\`\`\`
guild_user_read()
guild_user_read(namespace="preferences")
guild_user_read(namespace="preferences", key="timezone")
\`\`\`

### guild_user_save
Save a memory about the current user (preferences, context, notes).
\`\`\`
guild_user_save(namespace="preferences", key="timezone", value="America/New_York")
guild_user_save(namespace="profile", key="role", value="Senior Engineer", tags=["auto-captured"])
\`\`\`
`;

async function buildMemoryDoc(
  creds: AgentCredentials,
  config: PluginConfig,
): Promise<string> {
  const lines: string[] = [TOOL_REFERENCE];

  try {
    const memories = await supabaseGet<Array<{ namespace: string; key: string }>>(
      creds, config, {
        table: "agent_memories",
        select: "namespace,key",
        filters: { status: "eq.active" },
        limit: 200,
      },
    );

    if (memories.length > 0) {
      const byNamespace = new Map<string, string[]>();
      for (const m of memories) {
        const keys = byNamespace.get(m.namespace) ?? [];
        keys.push(m.key);
        byNamespace.set(m.namespace, keys);
      }

      lines.push("## Your Current Memories");
      lines.push("");

      for (const [ns, keys] of byNamespace) {
        lines.push(`**${ns}** (${keys.length}): ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}`);
      }

      lines.push("");
      lines.push("Use `guild_memory_read(namespace=...)` to load specific memories.");
    }
  } catch {
    // Supabase may be down — tool reference is still useful without the summary
  }

  return lines.join("\n");
}

/**
 * Check if this agent has stored user memories and note it in context.
 * This makes agents transparent about what they know about users.
 */
async function buildUserMemoryNote(
  creds: AgentCredentials,
  config: PluginConfig,
): Promise<string | null> {
  try {
    const memories = await supabaseGet<Array<{ user_id: string }>>(creds, config, {
      table: "user_memories",
      select: "user_id",
      filters: {
        written_by: `eq.${creds.platformUuid}`,
        written_by_type: "eq.agent",
      },
      limit: 50,
    });

    if (memories.length === 0) return null;

    const userCount = new Set(memories.map(m => m.user_id)).size;
    return (
      `## User Memory Transparency\n\n` +
      `You have ${memories.length} stored memories about ${userCount} user(s). ` +
      `If a user asks what you know about them, use \`guild_user_read\` to show them. ` +
      `Users can ask you to delete specific memories.`
    );
  } catch {
    return null;
  }
}
