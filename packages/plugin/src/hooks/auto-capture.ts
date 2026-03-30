/**
 * agent_end hook — automatically detect and save user facts from the
 * conversation when a session ends.
 *
 * Scans user messages for personal/professional facts like:
 * - Role, title, team information
 * - Preferences and working style
 * - Project context and current work
 * - Technical expertise signals
 *
 * Saves detected facts as user memories via the guild_user_save pattern,
 * stored in the user_memories table so they're available across agents.
 */

import type { PluginConfig, AgentCredentials } from "../config.js";
import { resolveAgentCredentials } from "../lib/agent-resolver.js";
import { getAgentToken } from "../auth.js";
import { supabaseGet } from "../supabase.js";

interface AgentEndEvent {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
}

interface AgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
}

/** Fact extracted from a user message. */
interface ExtractedFact {
  namespace: string;
  key: string;
  value: string;
  tags: string[];
}

/**
 * Patterns that indicate user facts worth remembering.
 * Each pattern maps to a namespace and key prefix.
 */
const FACT_PATTERNS: Array<{
  pattern: RegExp;
  namespace: string;
  keyPrefix: string;
  tag: string;
}> = [
  // Role / title
  {
    pattern: /(?:i(?:'m| am) (?:a |the |an )?)([\w\s]+?(?:engineer|developer|designer|manager|lead|director|architect|analyst|scientist|admin|devops|sre|cto|ceo|vp|head)[\w\s]*?)(?:\.|,|$| at | for | on )/i,
    namespace: "profile",
    keyPrefix: "role",
    tag: "role",
  },
  // Team / company
  {
    pattern: /(?:i work (?:at|for|on|with) |my (?:team|company|org) (?:is |called ))([\w\s&.-]{2,60})(?:\.|,|$)/i,
    namespace: "profile",
    keyPrefix: "team",
    tag: "team",
  },
  // Current project / focus
  {
    pattern: /(?:i(?:'m| am) (?:currently |right now )?(?:working on|building|implementing|migrating|refactoring|debugging) )([\w\s-]{5,120})(?:\.|,|$)/i,
    namespace: "context",
    keyPrefix: "current-work",
    tag: "project",
  },
  // Preference: tool / language / framework
  {
    pattern: /(?:i (?:prefer|use|like|always use|usually use|stick with) )([\w\s.+-]{2,60})(?: (?:for|over|instead|because|when))/i,
    namespace: "preferences",
    keyPrefix: "tool-preference",
    tag: "preference",
  },
  // Timezone / location
  {
    pattern: /(?:i(?:'m| am) (?:in|based in|located in) )([\w\s,]{2,60})(?: (?:timezone|time zone|tz))?(?:\.|,|$)/i,
    namespace: "profile",
    keyPrefix: "location",
    tag: "location",
  },
];

/**
 * Extract user facts from user messages.
 */
function extractUserFacts(messages: Array<Record<string, unknown>>): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = typeof msg.content === "string"
      ? msg.content
      : typeof msg.text === "string"
        ? msg.text
        : "";
    if (text.length < 10) continue;

    for (const { pattern, namespace, keyPrefix, tag } of FACT_PATTERNS) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;

      const value = match[1].trim();
      if (value.length < 3 || value.length > 200) continue;

      // Deduplicate by key prefix
      const dedupeKey = `${namespace}:${keyPrefix}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      facts.push({
        namespace,
        key: keyPrefix,
        value,
        tags: ["auto-captured", tag],
      });
    }
  }

  return facts;
}

/**
 * Save a user memory to Supabase.
 */
async function saveUserMemory(
  creds: AgentCredentials,
  config: PluginConfig,
  userId: string,
  fact: ExtractedFact,
): Promise<void> {
  // Check if exists
  const existing = await supabaseGet<Array<{ id: string; value: string }>>(creds, config, {
    table: "user_memories",
    select: "id,value",
    filters: {
      user_id: `eq.${userId}`,
      namespace: `eq.${fact.namespace}`,
      key: `eq.${fact.key}`,
    },
    limit: 1,
  });

  // Don't overwrite a memory with similar content
  if (existing.length > 0) {
    const existingValue = existing[0].value?.toLowerCase() ?? "";
    const newValue = fact.value.toLowerCase();
    if (existingValue.includes(newValue) || newValue.includes(existingValue)) {
      return; // already captured this or something more detailed
    }
  }

  const token = await getAgentToken(creds, config);
  const body: Record<string, unknown> = {
    user_id: userId,
    namespace: fact.namespace,
    key: fact.key,
    value: fact.value,
    tags: fact.tags,
    written_by: creds.platformUuid,
    written_by_type: "agent",
  };

  if (existing.length > 0) {
    // Update
    const params = new URLSearchParams({ id: `eq.${existing[0].id}` });
    await fetch(`${config.supabaseUrl}/rest/v1/user_memories?${params}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        value: fact.value,
        tags: fact.tags,
        written_by: creds.platformUuid,
        written_by_type: "agent",
      }),
    });
  } else {
    // Insert
    await fetch(`${config.supabaseUrl}/rest/v1/user_memories`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
  }
}

/**
 * Find the primary user who has grants for this agent.
 * Returns the user_id or null if none found.
 */
async function resolveGrantedUser(
  creds: AgentCredentials,
  config: PluginConfig,
): Promise<string | null> {
  try {
    const grants = await supabaseGet<Array<{ user_id: string }>>(creds, config, {
      table: "user_agent_grants",
      select: "user_id",
      filters: { agent_id: `eq.${creds.platformUuid}` },
      limit: 1,
    });
    return grants.length > 0 ? grants[0].user_id : null;
  } catch {
    return null;
  }
}

/**
 * Check if a user has opted out of auto-capture.
 */
async function isAutoCaptureDisabled(
  creds: AgentCredentials,
  config: PluginConfig,
  userId: string,
): Promise<boolean> {
  try {
    const users = await supabaseGet<Array<{ auto_capture_enabled: boolean }>>(creds, config, {
      table: "users",
      select: "auto_capture_enabled",
      filters: { id: `eq.${userId}` },
      limit: 1,
    });
    if (users.length > 0 && users[0].auto_capture_enabled === false) {
      return true;
    }
    return false;
  } catch {
    return false; // default to capturing if we can't check
  }
}

/**
 * Create the agent_end hook.
 */
export function createAutoCaptureHook(pluginConfig: PluginConfig) {
  return async (
    event: AgentEndEvent,
    ctx: AgentContext,
  ): Promise<void> => {
    const creds = resolveAgentCredentials(ctx.agentId, pluginConfig);
    if (!creds) return;

    // Only process successful sessions with enough messages
    const messages = event.messages as Array<Record<string, unknown>> | undefined;
    if (!messages || messages.length < 4) return;
    if (!event.success) return;

    console.log(
      `[guild] agent_end auto-capture: agent="${ctx.agentId}" messages=${messages.length}`,
    );

    try {
      // Resolve the primary user granted to this agent
      const userId = await resolveGrantedUser(creds, pluginConfig);
      if (!userId) {
        console.log(`[guild] agent_end: no granted user for agent "${ctx.agentId}"`);
        return;
      }

      // Check if user has opted out of auto-capture
      const optedOut = await isAutoCaptureDisabled(creds, pluginConfig, userId);
      if (optedOut) {
        console.log(`[guild] agent_end: user ${userId} has auto-capture disabled, skipping`);
        return;
      }

      // Extract facts from user messages
      const facts = extractUserFacts(messages);
      if (facts.length === 0) {
        console.log("[guild] agent_end: no facts extracted");
        return;
      }

      console.log(`[guild] agent_end: extracted ${facts.length} fact(s) for user ${userId}`);

      // Save each fact
      for (const fact of facts) {
        try {
          await saveUserMemory(creds, pluginConfig, userId, fact);
          console.log(`[guild] agent_end: saved ${fact.namespace}/${fact.key} = "${fact.value}"`);
        } catch (err) {
          console.warn(`[guild] agent_end: failed to save ${fact.namespace}/${fact.key}: ${err}`);
        }
      }
    } catch (err) {
      // Never block session teardown
      console.warn(`[guild] agent_end auto-capture failed for "${ctx.agentId}": ${err}`);
    }
  };
}
