/**
 * before_compaction hook — flush important context to Supabase before
 * OpenClaw compresses the conversation history.
 *
 * Reads the session transcript (JSONL) and extracts:
 * - Active todo items / tasks the agent was working on
 * - Key decisions made during the session
 * - Important context that would be lost after compaction
 *
 * Saves extracted facts as agent memories in the "context" namespace
 * so they survive compaction and are available in future sessions.
 */

import type { PluginConfig, AgentCredentials } from "../config.js";
import { resolveAgentCredentials } from "../lib/agent-resolver.js";
import { supabaseGet } from "../supabase.js";
import { getAgentToken } from "../auth.js";
import { readFile } from "node:fs/promises";

interface CompactionEvent {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
}

interface AgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
}

/**
 * Extract assistant text content from a message object.
 * Messages can have various shapes depending on the provider.
 */
function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Parse session JSONL file into message objects.
 */
async function readSessionMessages(sessionFile: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await readFile(sessionFile, "utf-8");
    const messages: Array<Record<string, unknown>> = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * Extract a working-context summary from recent messages.
 * Focuses on assistant messages that mention tasks, decisions, or state.
 */
function extractWorkingContext(messages: Array<Record<string, unknown>>): string | null {
  // Get assistant messages from the session
  const assistantTexts: string[] = [];
  for (const msg of messages) {
    const role = msg.role as string | undefined;
    if (role === "assistant") {
      const text = extractText(msg);
      if (text.length > 20) assistantTexts.push(text);
    }
  }

  if (assistantTexts.length === 0) return null;

  // Take the last few assistant messages — they contain the most recent context
  const recent = assistantTexts.slice(-5);
  const combined = recent.join("\n---\n");

  // Extract key patterns: task mentions, decisions, current state
  const lines: string[] = [];

  // Look for todo/task patterns
  const taskPatterns = [
    /(?:working on|currently|task|todo|next step|in progress)[:\s]+(.{10,200})/gi,
    /(?:completed|finished|done|resolved)[:\s]+(.{10,200})/gi,
    /(?:decided|decision|chose|choosing)[:\s]+(.{10,200})/gi,
    /(?:blocked|waiting|need|requires)[:\s]+(.{10,200})/gi,
  ];

  for (const pattern of taskPatterns) {
    for (const match of combined.matchAll(pattern)) {
      const snippet = match[1].trim().replace(/\n/g, " ").slice(0, 200);
      if (snippet.length > 15) lines.push(snippet);
    }
  }

  // If no structured patterns found, take a summary of the last assistant message
  if (lines.length === 0) {
    const last = recent[recent.length - 1];
    if (last.length > 50) {
      // Take first 500 chars as a context snapshot
      lines.push(last.slice(0, 500).replace(/\n/g, " ").trim());
    }
  }

  if (lines.length === 0) return null;

  // Deduplicate
  const unique = [...new Set(lines)];
  return unique.join("\n• ");
}

/**
 * Save a memory to Supabase (upsert by namespace+key).
 */
async function saveMemory(
  creds: AgentCredentials,
  config: PluginConfig,
  namespace: string,
  key: string,
  value: string,
  source: string = "observed",
  tags: string[] = [],
): Promise<void> {
  // Check if exists
  const existing = await supabaseGet<Array<{ id: string }>>(creds, config, {
    table: "agent_memories",
    select: "id",
    filters: {
      namespace: `eq.${namespace}`,
      key: `eq.${key}`,
      status: "eq.active",
    },
    limit: 1,
  });

  const fields: Record<string, unknown> = {
    value,
    confidence: 0.7,
    source,
    tags,
    status: "active",
  };

  if (existing.length > 0) {
    // Update via PATCH
    const token = await getAgentToken(creds, config);
    const params = new URLSearchParams({ id: `eq.${existing[0].id}` });
    await fetch(`${config.supabaseUrl}/rest/v1/agent_memories?${params}`, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(fields),
    });
  } else {
    // Insert new
    const token = await getAgentToken(creds, config);
    await fetch(`${config.supabaseUrl}/rest/v1/agent_memories`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        agent_id: creds.platformUuid,
        namespace,
        key,
        ...fields,
      }),
    });
  }
}

/**
 * Create the before_compaction hook.
 */
export function createCompactionFlushHook(pluginConfig: PluginConfig) {
  return async (
    event: CompactionEvent,
    ctx: AgentContext,
  ): Promise<void> => {
    const creds = resolveAgentCredentials(ctx.agentId, pluginConfig);
    if (!creds) return;

    console.log(
      `[guild] before_compaction: agent="${ctx.agentId}" messages=${event.messageCount} ` +
      `compacting=${event.compactingCount ?? "?"} sessionFile=${event.sessionFile ?? "none"}`,
    );

    try {
      // Read messages from session file or event
      let messages = event.messages as Array<Record<string, unknown>> | undefined;
      if ((!messages || messages.length === 0) && event.sessionFile) {
        messages = await readSessionMessages(event.sessionFile);
      }
      if (!messages || messages.length === 0) {
        console.log("[guild] before_compaction: no messages to process");
        return;
      }

      // Extract working context
      const context = extractWorkingContext(messages);
      if (!context) {
        console.log("[guild] before_compaction: no extractable context");
        return;
      }

      // Save as a compaction snapshot
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      await saveMemory(
        creds,
        pluginConfig,
        "context",
        "pre-compaction-snapshot",
        `[${timestamp}] Session context before compaction (${event.messageCount} messages):\n• ${context}`,
        "observed",
        ["auto-compaction", "context-snapshot"],
      );

      console.log(`[guild] before_compaction: saved context snapshot for "${ctx.agentId}"`);
    } catch (err) {
      // Never block compaction
      console.warn(`[guild] before_compaction failed for "${ctx.agentId}": ${err}`);
    }
  };
}
